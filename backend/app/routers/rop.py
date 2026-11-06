"""Кабинет РОП — дашборд, статистика, распределение, аналитика, отчёт, поиск."""

from __future__ import annotations

from collections import defaultdict
from datetime import UTC, date, datetime, time, timedelta
from decimal import Decimal
from typing import Annotated
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import and_, case, func, or_, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.core.deps import CurrentCompanyId, CurrentUser, get_db
from app.models import (
    BookingAppointment,
    BookingDirection,
    BookingSpecialist,
    ChatMessage,
    ChatThread,
    Lead,
    LeadAuditEvent,
    Pipeline,
    PipelineStage,
    SalesKpiManualSale,
    SalesKpiManualSalePayment,
    SalesKpiPlan,
    SalesKpiPlanItem,
    SalesKpiServicePlan,
    SalesKpiServicePrice,
    Task,
    TaskStatus,
    User,
    UserPipelineAssignment,
    UserPresenceDay,
    UserRole,
)
from app.schemas.rop import (
    RopAcceptsLeadsPatch,
    RopAnalyticsManagerSla,
    RopAnalyticsReport,
    RopBulkTransferBody,
    RopBulkTransferResult,
    RopDashboard,
    RopDayClose,
    RopDayCloseManager,
    RopLeadTransferBody,
    RopLeadTransferResult,
    RopLeadMatch,
    RopManagerPresence,
    RopManagerRow,
    RopManagersList,
    RopOutlookMonth,
    RopOutlookPace,
    RopOutlookPlanFact,
    RopOutlookReport,
    RopOutlookScenario,
    RopOutlookSignal,
    RopWeekPace,
    RopWeekPaceMetric,
    RopWeekPaceStep,
    RopReportCell,
    RopRevenueReport,
    RopRevenueShare,
    RopSearchPatient,
    RopSearchVisit,
    RopStageCount,
    RopStatsManager,
    RopStatsReport,
    RopStatsStage,
)
from app.services.audit import write_audit_event
from app.services.presence_time import online_seconds_so_far, presence_gap_seconds
from app.services.clinic_roles import can_access_rop
from app.services.lead_extra_phones import lead_has_contact_phone
from app.services.lead_sales_stages import ARCHIVE_STAGE_NAME, CLOSED_OUTCOME_STAGE_NAMES
from app.services.phone_match import phone_search_digit_variants
from app.services.rop_outlook import (
    build_summary,
    days_elapsed_in_month,
    days_remaining_in_month,
    month_label_ru,
    next_month_mid,
    pace_percent,
    pct_delta,
    project_scenarios,
    week_pace_bounds,
    week_span_label,
)
from app.services.rop_signals import (
    UNREPLIED_HOURS_DEFAULT,
    ManagerSignalInput,
    collect_signals,
    waiting_unreplied,
)
from app.services.sales_kpi_weighted import _norm_kpi_label, load_plan_items

# Не «активные» на дашборде: исход или архив.
_DASH_DONE_STAGES = CLOSED_OUTCOME_STAGE_NAMES | {ARCHIVE_STAGE_NAME}


# Ещё не исход: «обработал» — все, кто уже не в этих стадиях.
_STATS_OPEN_STAGES = frozenset({"Новый лид", "В обработке", "В работе"})
# Эти строки показываем всегда, даже с нулём, и в порядке воронки.
_STATS_ALWAYS_ROWS = _STATS_OPEN_STAGES | frozenset(
    {"Не ответили", "В ожидании", "Удачно", "Отказ"}
)

router = APIRouter(prefix="/rop", tags=["rop"])

ONLINE_WINDOW = timedelta(minutes=2)
PRESENCE_ROLES = frozenset(
    {
        UserRole.manager,
        UserRole.admin,
        UserRole.rop,
        UserRole.owner,
        UserRole.administrator,
        UserRole.curator,
        UserRole.expert,
        UserRole.super_owner,
        UserRole.finance_analyst,
        UserRole.accountant,
    }
)


def _assert_rop(user: User) -> None:
    if not can_access_rop(user.role):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Доступ только для РОП / владельца")


def _as_utc(ts: datetime) -> datetime:
    if ts.tzinfo is None:
        return ts.replace(tzinfo=UTC)
    return ts.astimezone(UTC)


def first_reply_minutes(
    messages: list[tuple[str, int | None, datetime]],
    manager_id: int,
) -> float | None:
    """Минуты от первого входящего до первого ответа этого менеджера.

    Сообщения уже по времени. Автосообщения без автора не считаются ответом.
    """
    inbound: datetime | None = None
    for direction, author, ts in messages:
        moment = _as_utc(ts)
        if direction == "in" and inbound is None:
            inbound = moment
            continue
        if inbound is None or direction != "out" or author is None or int(author) != manager_id:
            continue
        delta = (moment - inbound).total_seconds() / 60.0
        if delta >= 0:
            return delta
    return None


def _booking_tz() -> ZoneInfo:
    try:
        return ZoneInfo(settings.booking_timezone or "Asia/Dushanbe")
    except Exception:
        return ZoneInfo("Asia/Dushanbe")


def _day_bounds(day: date) -> tuple[datetime, datetime]:
    tz = _booking_tz()
    start = datetime.combine(day, time.min, tzinfo=tz).astimezone(UTC)
    end = start + timedelta(days=1)
    return start, end


def _today_local() -> date:
    return datetime.now(_booking_tz()).date()


def _display_name(u: User) -> str:
    return (u.full_name or "").strip() or u.email


def _norm_rop_service(value: str | None) -> str:
    """Нормализация имени услуги для сопоставления с планом KPI (Остиопат ≈ Остеопат)."""
    n = _norm_kpi_label(value)
    return n.replace("остиопат", "остеопат")


def _months_in_range(date_from: date, date_to: date) -> list[date]:
    """Первые числа месяцев, пересекающих [date_from, date_to]."""
    if date_to < date_from:
        return []
    out: list[date] = []
    y, m = date_from.year, date_from.month
    end_ym = (date_to.year, date_to.month)
    while (y, m) <= end_ym:
        out.append(date(y, m, 1))
        if m == 12:
            y, m = y + 1, 1
        else:
            m += 1
    return out


async def _kpi_plan_service_allowlist(
    db: AsyncSession,
    *,
    company_id: int,
    pipeline_id: int,
    date_from: date,
    date_to: date,
) -> tuple[set[str], set[int]]:
    """Имена услуг и id plan_item из weighted-плана за месяцы периода.

    Берутся имена показателей плана (не direction_id — там бывает устаревшая
    привязка). «Остиопат» и «Остеопат» считаются одним ключом.
    """
    names: set[str] = set()
    item_ids: set[int] = set()
    for ym in _months_in_range(date_from, date_to):
        items = await load_plan_items(db, company_id=company_id, pipeline_id=pipeline_id, ym=ym)
        for item in items:
            item_ids.add(int(item.id))
            key = _norm_rop_service(item.name)
            if key:
                names.add(key)
    if names:
        # Подтянуть реальные названия направлений клиники с тем же ключом (Остиопат и т.п.).
        for dname in (
            await db.execute(
                select(BookingDirection.name).where(BookingDirection.company_id == company_id)
            )
        ).scalars().all():
            key = _norm_rop_service(str(dname or ""))
            if key in names:
                # уже есть; direction name с тем же norm попадёт при фильтре
                pass
    return names, item_ids


def _is_online(last_seen: datetime | None, *, now: datetime | None = None) -> bool:
    if last_seen is None:
        return False
    n = now or datetime.now(UTC)
    ts = last_seen if last_seen.tzinfo else last_seen.replace(tzinfo=UTC)
    return (n - ts.astimezone(UTC)) <= ONLINE_WINDOW


async def _load_pipeline(db: AsyncSession, company_id: int, pipeline_id: int) -> Pipeline:
    pipe = await db.get(Pipeline, pipeline_id)
    if pipe is None or pipe.company_id != company_id:
        raise HTTPException(status_code=404, detail="Воронка не найдена")
    return pipe


async def _pipeline_manager_ids(db: AsyncSession, *, company_id: int, pipeline_id: int) -> list[int]:
    rows = (
        await db.execute(
            select(User.id)
            .join(UserPipelineAssignment, UserPipelineAssignment.user_id == User.id)
            .where(
                User.company_id == company_id,
                User.is_active.is_(True),
                User.role == UserRole.manager,
                UserPipelineAssignment.company_id == company_id,
                UserPipelineAssignment.pipeline_id == pipeline_id,
            )
            .order_by(User.id.asc())
        )
    ).scalars().all()
    ids = [int(x) for x in rows]
    if ids:
        return ids
    return list(
        (
            await db.execute(
                select(User.id)
                .where(
                    User.company_id == company_id,
                    User.is_active.is_(True),
                    User.role == UserRole.manager,
                )
                .order_by(User.id.asc())
            )
        ).scalars().all()
    )


async def _archive_stage_ids(db: AsyncSession, *, company_id: int, pipeline_id: int) -> set[int]:
    rows = (
        await db.execute(
            select(PipelineStage.id).where(
                PipelineStage.company_id == company_id,
                PipelineStage.pipeline_id == pipeline_id,
                PipelineStage.name == ARCHIVE_STAGE_NAME,
            )
        )
    ).scalars().all()
    return {int(x) for x in rows}


async def _visit_paid_by_manager(
    db: AsyncSession,
    *,
    company_id: int,
    manager_ids: list[int],
    start: datetime,
    end: datetime,
) -> dict[int, Decimal]:
    """Оплата визита: ответственный на записи, иначе менеджер карточки."""
    if not manager_ids:
        return {}
    mgr = func.coalesce(BookingAppointment.responsible_manager_id, Lead.manager_id)
    rows = (
        await db.execute(
            select(mgr, func.coalesce(func.sum(BookingAppointment.paid_amount), 0))
            .outerjoin(Lead, Lead.id == BookingAppointment.lead_id)
            .where(
                BookingAppointment.company_id == company_id,
                BookingAppointment.start_at >= start,
                BookingAppointment.start_at < end,
                BookingAppointment.status != "cancelled",
                or_(
                    BookingAppointment.responsible_manager_id.in_(manager_ids),
                    and_(
                        BookingAppointment.responsible_manager_id.is_(None),
                        Lead.manager_id.in_(manager_ids),
                    ),
                ),
            )
            .group_by(mgr)
        )
    ).all()
    return {int(mid): Decimal(str(amt or 0)) for mid, amt in rows if mid is not None}


async def _won_today_by_actor(
    db: AsyncSession,
    *,
    company_id: int,
    pipeline_id: int,
    manager_ids: list[int],
    start: datetime,
    end: datetime,
) -> dict[int, int]:
    """Лиды, которые менеджер сегодня сам перевёл в «Удачно»."""
    if not manager_ids:
        return {}
    rows = (
        await db.execute(
            select(LeadAuditEvent.user_id, func.count(func.distinct(Lead.id)))
            .join(Lead, Lead.id == LeadAuditEvent.lead_id)
            .join(PipelineStage, PipelineStage.id == Lead.status_id)
            .where(
                Lead.company_id == company_id,
                PipelineStage.pipeline_id == pipeline_id,
                LeadAuditEvent.user_id.in_(manager_ids),
                LeadAuditEvent.action == "status_changed",
                LeadAuditEvent.details.like("%-> Удачно%"),
                LeadAuditEvent.created_at >= start,
                LeadAuditEvent.created_at < end,
            )
            .group_by(LeadAuditEvent.user_id)
        )
    ).all()
    return {int(uid): int(cnt) for uid, cnt in rows if uid}


def _phone_digits_sql(column):
    expr = column
    for ch in ("+", " ", "-", "(", ")", ".", "\u00a0"):
        expr = func.replace(expr, ch, "")
    return expr


@router.post("/presence/heartbeat")
async def presence_heartbeat(
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentUser,
) -> dict[str, str]:
    if current_user.role not in PRESENCE_ROLES:
        return {"ok": "skipped"}
    user = await db.get(User, current_user.id)
    if user is None:
        raise HTTPException(status_code=404, detail="Пользователь не найден")
    now = datetime.now(UTC)
    gap = presence_gap_seconds(user.last_seen_at, now, window=ONLINE_WINDOW)
    user.last_seen_at = now
    if gap and user.company_id is not None:
        day = now.astimezone(_booking_tz()).date()
        row = (
            await db.execute(
                select(UserPresenceDay).where(
                    UserPresenceDay.user_id == int(user.id),
                    UserPresenceDay.day == day,
                )
            )
        ).scalars().first()
        if row is None:
            db.add(
                UserPresenceDay(
                    company_id=int(user.company_id),
                    user_id=int(user.id),
                    day=day,
                    seconds=gap,
                )
            )
        else:
            row.seconds = int(row.seconds or 0) + gap
    await db.flush()
    return {"ok": "true"}


@router.get("/dashboard", response_model=RopDashboard)
async def rop_dashboard(
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentUser,
    company_id: CurrentCompanyId,
    pipeline_id: int = Query(..., ge=1),
) -> RopDashboard:
    _assert_rop(current_user)
    pipe = await _load_pipeline(db, company_id, pipeline_id)
    day = _today_local()
    start, end = _day_bounds(day)
    now = datetime.now(UTC)
    manager_ids = await _pipeline_manager_ids(db, company_id=company_id, pipeline_id=pipeline_id)

    managers = (
        await db.execute(select(User).where(User.id.in_(manager_ids or [0])))
    ).scalars().all() if manager_ids else []
    by_id = {int(u.id): u for u in managers}

    active_q = (
        select(Lead.manager_id, func.count())
        .join(PipelineStage, PipelineStage.id == Lead.status_id)
        .where(
            Lead.company_id == company_id,
            PipelineStage.pipeline_id == pipeline_id,
            Lead.manager_id.in_(manager_ids or [0]),
            PipelineStage.name.notin_(tuple(_DASH_DONE_STAGES)),
            lead_has_contact_phone(),
        )
    )
    active_rows = (await db.execute(active_q.group_by(Lead.manager_id))).all()
    active_map = {int(mid): int(cnt) for mid, cnt in active_rows if mid}

    new_rows = (
        await db.execute(
            select(Lead.manager_id, func.count())
            .join(PipelineStage, PipelineStage.id == Lead.status_id)
            .where(
                Lead.company_id == company_id,
                PipelineStage.pipeline_id == pipeline_id,
                Lead.manager_id.in_(manager_ids or [0]),
                Lead.created_at >= start,
                Lead.created_at < end,
                lead_has_contact_phone(),
            )
            .group_by(Lead.manager_id)
        )
    ).all() if manager_ids else []
    new_map = {int(mid): int(cnt) for mid, cnt in new_rows if mid}

    book_map = await _won_today_by_actor(
        db,
        company_id=company_id,
        pipeline_id=pipeline_id,
        manager_ids=manager_ids,
        start=start,
        end=end,
    )

    rev_map = await _visit_paid_by_manager(
        db,
        company_id=company_id,
        manager_ids=manager_ids,
        start=start,
        end=end,
    )

    man_rows = (
        await db.execute(
            select(
                SalesKpiManualSale.manager_user_id,
                func.coalesce(func.sum(SalesKpiManualSalePayment.amount), 0),
            )
            .join(SalesKpiManualSalePayment, SalesKpiManualSalePayment.sale_id == SalesKpiManualSale.id)
            .where(
                SalesKpiManualSale.company_id == company_id,
                SalesKpiManualSale.pipeline_id == pipeline_id,
                SalesKpiManualSale.manager_user_id.in_(manager_ids or [0]),
                SalesKpiManualSalePayment.paid_at >= start,
                SalesKpiManualSalePayment.paid_at < end,
            )
            .group_by(SalesKpiManualSale.manager_user_id)
        )
    ).all() if manager_ids else []
    for mid, amt in man_rows:
        if mid is None:
            continue
        rev_map[int(mid)] = rev_map.get(int(mid), Decimal("0")) + Decimal(str(amt or 0))

    presence_rows = (
        await db.execute(
            select(UserPresenceDay.user_id, UserPresenceDay.seconds).where(
                UserPresenceDay.company_id == company_id,
                UserPresenceDay.day == day,
                UserPresenceDay.user_id.in_(manager_ids or [0]),
            )
        )
    ).all() if manager_ids else []
    presence_map = {int(uid): int(sec or 0) for uid, sec in presence_rows}

    items: list[RopManagerPresence] = []
    for mid in manager_ids:
        u = by_id.get(mid)
        if u is None:
            continue
        online = _is_online(u.last_seen_at, now=now)
        items.append(
            RopManagerPresence(
                user_id=mid,
                full_name=_display_name(u),
                email=u.email,
                is_online=online,
                last_seen_at=u.last_seen_at,
                accepts_new_leads=bool(u.accepts_new_leads),
                active_leads=active_map.get(mid, 0),
                new_leads_today=new_map.get(mid, 0),
                bookings_today=book_map.get(mid, 0),
                revenue_today=rev_map.get(mid, Decimal("0")),
                online_seconds_today=online_seconds_so_far(
                    stored=presence_map.get(mid, 0),
                    last_seen_at=u.last_seen_at,
                    now=now,
                    is_online=online,
                    window=ONLINE_WINDOW,
                ),
            )
        )
    items.sort(key=lambda x: (not x.is_online, x.full_name.lower()))
    return RopDashboard(
        pipeline_id=int(pipe.id),
        pipeline_name=pipe.name,
        date=day,
        online_count=sum(1 for x in items if x.is_online),
        managers=items,
    )


@router.get("/dashboard/day-close", response_model=RopDayClose)
async def rop_day_close(
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentUser,
    company_id: CurrentCompanyId,
    pipeline_id: int = Query(..., ge=1),
    day: date | None = Query(None, alias="date"),
) -> RopDayClose:
    _assert_rop(current_user)
    pipe = await _load_pipeline(db, company_id, pipeline_id)
    target = day or _today_local()
    start, end = _day_bounds(target)
    manager_ids = await _pipeline_manager_ids(db, company_id=company_id, pipeline_id=pipeline_id)
    archive_ids = await _archive_stage_ids(db, company_id=company_id, pipeline_id=pipeline_id)
    managers = (
        await db.execute(select(User).where(User.id.in_(manager_ids or [0])))
    ).scalars().all() if manager_ids else []
    by_id = {int(u.id): u for u in managers}

    stage_rows = (
        await db.execute(
            select(Lead.manager_id, Lead.status_id, PipelineStage.name, func.count())
            .join(PipelineStage, PipelineStage.id == Lead.status_id)
            .where(
                Lead.company_id == company_id,
                PipelineStage.pipeline_id == pipeline_id,
                Lead.manager_id.in_(manager_ids or [0]),
            )
            .group_by(Lead.manager_id, Lead.status_id, PipelineStage.name)
        )
    ).all() if manager_ids else []
    stages_map: dict[int, list[RopStageCount]] = defaultdict(list)
    for mid, sid, sname, cnt in stage_rows:
        if mid is None:
            continue
        stages_map[int(mid)].append(
            RopStageCount(stage_id=int(sid), stage_name=str(sname), count=int(cnt))
        )

    replied_map: dict[int, int] = {}
    if manager_ids:
        for mid, cnt in (
            await db.execute(
                select(Lead.manager_id, func.count(func.distinct(Lead.id)))
                .join(ChatThread, ChatThread.lead_id == Lead.id)
                .join(ChatMessage, ChatMessage.thread_id == ChatThread.id)
                .join(PipelineStage, PipelineStage.id == Lead.status_id)
                .where(
                    Lead.company_id == company_id,
                    PipelineStage.pipeline_id == pipeline_id,
                    Lead.manager_id.in_(manager_ids),
                    ChatMessage.direction == "out",
                    ChatMessage.created_at >= start,
                    ChatMessage.created_at < end,
                )
                .group_by(Lead.manager_id)
            )
        ).all():
            if mid is not None:
                replied_map[int(mid)] = int(cnt)
        for mid, cnt in (
            await db.execute(
                select(Lead.manager_id, func.count(func.distinct(Lead.id)))
                .join(LeadAuditEvent, LeadAuditEvent.lead_id == Lead.id)
                .join(PipelineStage, PipelineStage.id == Lead.status_id)
                .where(
                    Lead.company_id == company_id,
                    PipelineStage.pipeline_id == pipeline_id,
                    Lead.manager_id.in_(manager_ids),
                    LeadAuditEvent.action == "card_opened",
                    LeadAuditEvent.created_at >= start,
                    LeadAuditEvent.created_at < end,
                )
                .group_by(Lead.manager_id)
            )
        ).all():
            if mid is None:
                continue
            replied_map[int(mid)] = max(replied_map.get(int(mid), 0), int(cnt))

    book_map = await _won_today_by_actor(
        db,
        company_id=company_id,
        pipeline_id=pipeline_id,
        manager_ids=manager_ids,
        start=start,
        end=end,
    )
    rev_map = await _visit_paid_by_manager(
        db,
        company_id=company_id,
        manager_ids=manager_ids,
        start=start,
        end=end,
    )

    out: list[RopDayCloseManager] = []
    for mid in manager_ids:
        u = by_id.get(mid)
        if u is None:
            continue
        stages = stages_map.get(mid, [])
        unreplied = sum(
            sc.count for sc in stages if not archive_ids or sc.stage_id not in archive_ids
        )
        unreplied = max(0, unreplied - replied_map.get(mid, 0))
        out.append(
            RopDayCloseManager(
                user_id=mid,
                full_name=_display_name(u),
                replied_leads=replied_map.get(mid, 0),
                unreplied_active=unreplied,
                stages=sorted(stages, key=lambda s: s.stage_name),
                bookings_today=book_map.get(mid, 0),
                revenue_today=rev_map.get(mid, Decimal("0")),
            )
        )
    out.sort(key=lambda x: x.full_name.lower())
    return RopDayClose(
        pipeline_id=int(pipe.id),
        pipeline_name=pipe.name,
        date=target,
        managers=out,
    )


@router.get("/stats", response_model=RopStatsReport)
async def rop_stats(
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentUser,
    company_id: CurrentCompanyId,
    pipeline_id: int = Query(..., ge=1),
    date_from: date = Query(..., alias="from"),
    date_to: date = Query(..., alias="to"),
) -> RopStatsReport:
    _assert_rop(current_user)
    if date_to < date_from:
        raise HTTPException(status_code=400, detail="Период: to должен быть ≥ from")
    pipe = await _load_pipeline(db, company_id, pipeline_id)
    start, _ = _day_bounds(date_from)
    _, end = _day_bounds(date_to)
    manager_ids = await _pipeline_manager_ids(db, company_id=company_id, pipeline_id=pipeline_id)
    managers = (
        await db.execute(select(User).where(User.id.in_(manager_ids or [0])))
    ).scalars().all() if manager_ids else []
    by_id = {int(u.id): u for u in managers}

    in_map: dict[int, int] = {}
    stages_raw: dict[int, dict[int, int]] = defaultdict(dict)
    catalog = (
        await db.execute(
            select(PipelineStage.id, PipelineStage.name, PipelineStage.order)
            .where(
                PipelineStage.company_id == company_id,
                PipelineStage.pipeline_id == pipeline_id,
            )
            .order_by(PipelineStage.order.asc(), PipelineStage.id.asc())
        )
    ).all()
    if manager_ids:
        for mid, cnt in (
            await db.execute(
                select(Lead.manager_id, func.count())
                .join(PipelineStage, PipelineStage.id == Lead.status_id)
                .where(
                    Lead.company_id == company_id,
                    PipelineStage.pipeline_id == pipeline_id,
                    Lead.manager_id.in_(manager_ids),
                    Lead.created_at >= start,
                    Lead.created_at < end,
                )
                .group_by(Lead.manager_id)
            )
        ).all():
            if mid is not None:
                in_map[int(mid)] = int(cnt)
        for mid, sid, cnt in (
            await db.execute(
                select(Lead.manager_id, Lead.status_id, func.count())
                .join(PipelineStage, PipelineStage.id == Lead.status_id)
                .where(
                    Lead.company_id == company_id,
                    PipelineStage.pipeline_id == pipeline_id,
                    Lead.manager_id.in_(manager_ids),
                    Lead.created_at >= start,
                    Lead.created_at < end,
                )
                .group_by(Lead.manager_id, Lead.status_id)
            )
        ).all():
            if mid is None or sid is None:
                continue
            stages_raw[int(mid)][int(sid)] = int(cnt)

    out: list[RopStatsManager] = []
    for mid in manager_ids:
        u = by_id.get(mid)
        if u is None:
            continue
        leads_in = in_map.get(mid, 0)
        counts = stages_raw.get(mid, {})
        open_count = sum(
            counts.get(int(sid), 0)
            for sid, sname, _order in catalog
            if str(sname) in _STATS_OPEN_STAGES
        )
        processed = max(0, leads_in - open_count)
        conv = round(100.0 * processed / leads_in, 1) if leads_in else 0.0
        stages: list[RopStatsStage] = []
        for sid, sname, _order in catalog:
            cnt = counts.get(int(sid), 0)
            name = str(sname)
            if cnt == 0 and name not in _STATS_ALWAYS_ROWS:
                continue
            stages.append(
                RopStatsStage(
                    stage_id=int(sid),
                    stage_name=name,
                    count=cnt,
                    percent=round(100.0 * cnt / leads_in, 1) if leads_in else 0.0,
                )
            )
        out.append(
            RopStatsManager(
                user_id=mid,
                full_name=_display_name(u),
                leads_in=leads_in,
                processed=processed,
                conversion_percent=conv,
                stages=stages,
            )
        )
    out.sort(key=lambda x: -x.leads_in)
    return RopStatsReport(
        pipeline_id=int(pipe.id),
        pipeline_name=pipe.name,
        date_from=date_from,
        date_to=date_to,
        managers=out,
    )


@router.get("/managers", response_model=RopManagersList)
async def rop_managers(
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentUser,
    company_id: CurrentCompanyId,
    pipeline_id: int = Query(..., ge=1),
) -> RopManagersList:
    _assert_rop(current_user)
    await _load_pipeline(db, company_id, pipeline_id)
    manager_ids = await _pipeline_manager_ids(db, company_id=company_id, pipeline_id=pipeline_id)
    now = datetime.now(UTC)
    managers = (
        await db.execute(select(User).where(User.id.in_(manager_ids or [0])))
    ).scalars().all() if manager_ids else []
    count_map: dict[int, int] = {}
    if manager_ids:
        for mid, cnt in (
            await db.execute(
                select(Lead.manager_id, func.count())
                .join(PipelineStage, PipelineStage.id == Lead.status_id)
                .where(
                    Lead.company_id == company_id,
                    PipelineStage.pipeline_id == pipeline_id,
                    Lead.manager_id.in_(manager_ids),
                )
                .group_by(Lead.manager_id)
            )
        ).all():
            if mid is not None:
                count_map[int(mid)] = int(cnt)
    rows = [
        RopManagerRow(
            user_id=int(u.id),
            full_name=_display_name(u),
            email=u.email,
            accepts_new_leads=bool(u.accepts_new_leads),
            lead_count=count_map.get(int(u.id), 0),
            is_online=_is_online(u.last_seen_at, now=now),
            last_seen_at=u.last_seen_at,
        )
        for u in managers
    ]
    rows.sort(key=lambda x: x.full_name.lower())
    return RopManagersList(pipeline_id=pipeline_id, managers=rows)


@router.patch("/managers/{manager_id}/accepts-leads", response_model=RopManagerRow)
async def rop_patch_accepts_leads(
    manager_id: int,
    body: RopAcceptsLeadsPatch,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentUser,
    company_id: CurrentCompanyId,
    pipeline_id: int = Query(..., ge=1),
) -> RopManagerRow:
    _assert_rop(current_user)
    await _load_pipeline(db, company_id, pipeline_id)
    user = await db.get(User, manager_id)
    if user is None or user.company_id != company_id or user.role != UserRole.manager:
        raise HTTPException(status_code=404, detail="Менеджер не найден")
    user.accepts_new_leads = bool(body.accepts_new_leads)
    await write_audit_event(
        db,
        entity_type="user",
        entity_id=user.id,
        action="accepts_new_leads_updated",
        current_user=current_user,
        details=f"accepts_new_leads={user.accepts_new_leads}; by_rop={current_user.id}",
    )
    await db.flush()
    cnt = (
        await db.execute(
            select(func.count())
            .select_from(Lead)
            .join(PipelineStage, PipelineStage.id == Lead.status_id)
            .where(
                Lead.company_id == company_id,
                PipelineStage.pipeline_id == pipeline_id,
                Lead.manager_id == user.id,
            )
        )
    ).scalar_one()
    return RopManagerRow(
        user_id=int(user.id),
        full_name=_display_name(user),
        email=user.email,
        accepts_new_leads=bool(user.accepts_new_leads),
        lead_count=int(cnt or 0),
        is_online=_is_online(user.last_seen_at),
        last_seen_at=user.last_seen_at,
    )


@router.get("/leads/lookup", response_model=list[RopLeadMatch])
async def rop_lead_lookup(
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentUser,
    company_id: CurrentCompanyId,
    pipeline_id: int = Query(..., ge=1),
    q: str = Query(..., min_length=2, max_length=120),
) -> list[RopLeadMatch]:
    """Поиск лида воронки по ID, ФИО или телефону — для передачи менеджеру."""
    _assert_rop(current_user)
    await _load_pipeline(db, company_id, pipeline_id)
    raw = q.strip()
    digits = "".join(ch for ch in raw if ch.isdigit())
    clauses = []
    if raw.isdigit():
        try:
            clauses.append(Lead.id == int(raw))
        except ValueError:
            pass
    if len(digits) >= 4:
        tail = digits[-9:] if len(digits) >= 9 else digits
        clauses.append(_phone_digits_sql(Lead.phone).like(f"%{tail}%"))
    if not raw.isdigit():
        clauses.append(Lead.name.ilike(f"%{raw}%"))
    if not clauses:
        return []
    rows = (
        await db.execute(
            select(Lead, User)
            .join(PipelineStage, PipelineStage.id == Lead.status_id)
            .outerjoin(User, User.id == Lead.manager_id)
            .where(
                Lead.company_id == company_id,
                PipelineStage.pipeline_id == pipeline_id,
                or_(*clauses),
            )
            .order_by(Lead.id.desc())
            .limit(12)
        )
    ).all()
    out: list[RopLeadMatch] = []
    for lead, manager in rows:
        out.append(
            RopLeadMatch(
                lead_id=int(lead.id),
                name=str(lead.name or ""),
                phone=lead.phone,
                manager_id=int(lead.manager_id) if lead.manager_id is not None else None,
                manager_name=_display_name(manager) if manager is not None else None,
            )
        )
    return out


@router.post("/leads/transfer", response_model=RopLeadTransferResult)
async def rop_transfer_lead(
    body: RopLeadTransferBody,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentUser,
    company_id: CurrentCompanyId,
) -> RopLeadTransferResult:
    _assert_rop(current_user)
    lead = await db.get(Lead, body.lead_id)
    if lead is None or lead.company_id != company_id:
        raise HTTPException(status_code=404, detail="Лид не найден")
    target = await db.get(User, body.to_manager_id)
    if (
        target is None
        or target.company_id != company_id
        or target.role != UserRole.manager
        or not target.is_active
    ):
        raise HTTPException(status_code=400, detail="Получатель должен быть активным менеджером")
    from_id = int(lead.manager_id) if lead.manager_id is not None else None
    # Сначала закрепляем продавца на записях, потом меняем менеджера лида.
    from app.routers.leads import _freeze_booking_sellers_on_lead_reassign

    await _freeze_booking_sellers_on_lead_reassign(
        db,
        company_id=company_id,
        lead_id=int(lead.id),
        from_manager_id=from_id,
    )
    lead.manager_id = int(target.id)
    await write_audit_event(
        db,
        entity_type="lead",
        entity_id=lead.id,
        action="manager_reassigned",
        current_user=current_user,
        details=f"from_manager_id={from_id}, to_manager_id={target.id}, via=rop_transfer",
    )
    # Разовое исключение (#41470 Файзалиев): KPI-продажа тоже на нового менеджера.
    from app.services.phone_match import phone_digits
    from app.services.sales_kpi_weighted import (
        KPI_OWNER_FOLLOW_CRM_FIO_KEYS,
        KPI_OWNER_FOLLOW_CRM_LEAD_IDS,
        fio_key,
    )

    if int(lead.id) in KPI_OWNER_FOLLOW_CRM_LEAD_IDS:
        lead_fk = fio_key(str(lead.name or ""))
        lead_phone = phone_digits(lead.phone)
        name_hint = (lead_fk.split()[0] if lead_fk else "") or "файзалиев"
        sale_rows = (
            await db.execute(
                select(SalesKpiManualSale).where(
                    SalesKpiManualSale.company_id == company_id,
                    or_(
                        SalesKpiManualSale.lead_id == int(lead.id),
                        SalesKpiManualSale.client_name.ilike(f"%{name_hint}%"),
                    ),
                ),
            )
        ).scalars().all()
        now = datetime.now(UTC)
        for sale in sale_rows:
            match = int(sale.lead_id or 0) == int(lead.id)
            if not match:
                sfk = fio_key(str(sale.client_name or ""))
                match = bool(sfk) and (
                    sfk == lead_fk or sfk in KPI_OWNER_FOLLOW_CRM_FIO_KEYS
                )
            if not match and lead_phone:
                sp = phone_digits(sale.client_phone)
                match = bool(sp) and (
                    sp == lead_phone
                    or (len(sp) >= 9 and len(lead_phone) >= 9 and sp[-9:] == lead_phone[-9:])
                )
            if not match:
                continue
            sale.manager_user_id = int(target.id)
            sale.opened_manager_user_id = int(target.id)
            sale.lead_id = int(lead.id)
            sale.updated_at = now
    if from_id is not None:
        # Продажи / KPI не переносим — только открытые задачи (кроме исключения выше).
        await db.execute(
            update(Task)
            .where(
                Task.company_id == company_id,
                Task.related_lead_id == lead.id,
                Task.assigned_to == from_id,
                Task.status.in_([TaskStatus.pending, TaskStatus.in_progress]),
            )
            .values(assigned_to=int(target.id))
        )
    await db.flush()
    return RopLeadTransferResult(
        lead_id=int(lead.id),
        from_manager_id=from_id,
        to_manager_id=int(target.id),
    )


@router.post("/leads/transfer-bulk", response_model=RopBulkTransferResult)
async def rop_transfer_bulk(
    body: RopBulkTransferBody,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentUser,
    company_id: CurrentCompanyId,
) -> RopBulkTransferResult:
    _assert_rop(current_user)
    from app.routers.leads import LeadRedistributeBody, redistribute_manager_leads

    result = await redistribute_manager_leads(
        LeadRedistributeBody(from_manager_id=body.from_manager_id, to_manager_ids=body.to_manager_ids),
        db,
        current_user,
        company_id,
    )
    return RopBulkTransferResult(
        total=int(result.total),
        reassigned=int(result.reassigned),
        per_manager={int(k): int(v) for k, v in (result.per_manager or {}).items()},
    )


@router.get("/analytics", response_model=RopAnalyticsReport)
async def rop_analytics(
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentUser,
    company_id: CurrentCompanyId,
    pipeline_id: int = Query(..., ge=1),
    date_from: date = Query(..., alias="from"),
    date_to: date = Query(..., alias="to"),
) -> RopAnalyticsReport:
    _assert_rop(current_user)
    if date_to < date_from:
        raise HTTPException(status_code=400, detail="Период: to должен быть ≥ from")
    pipe = await _load_pipeline(db, company_id, pipeline_id)
    start, _ = _day_bounds(date_from)
    _, end = _day_bounds(date_to)
    manager_ids = await _pipeline_manager_ids(db, company_id=company_id, pipeline_id=pipeline_id)
    managers = (
        await db.execute(select(User).where(User.id.in_(manager_ids or [0])))
    ).scalars().all() if manager_ids else []
    by_id = {int(u.id): u for u in managers}

    leads = (
        await db.execute(
            select(Lead.id, Lead.manager_id)
            .join(PipelineStage, PipelineStage.id == Lead.status_id)
            .where(
                Lead.company_id == company_id,
                PipelineStage.pipeline_id == pipeline_id,
                Lead.manager_id.in_(manager_ids or [0]),
                Lead.created_at >= start,
                Lead.created_at < end,
            )
        )
    ).all() if manager_ids else []
    lead_ids = [int(r[0]) for r in leads]
    mgr_of = {int(r[0]): int(r[1]) for r in leads if r[1] is not None}

    by_lead: dict[int, list[tuple[str, int | None, datetime]]] = defaultdict(list)
    if lead_ids:
        for lid, direction, author, ts in (
            await db.execute(
                select(
                    ChatThread.lead_id,
                    ChatMessage.direction,
                    ChatMessage.author_user_id,
                    ChatMessage.created_at,
                )
                .join(ChatThread, ChatThread.id == ChatMessage.thread_id)
                .where(ChatThread.lead_id.in_(lead_ids))
                .order_by(ChatMessage.created_at.asc(), ChatMessage.id.asc())
            )
        ).all():
            if lid is None or ts is None:
                continue
            by_lead[int(lid)].append((str(direction or ""), int(author) if author is not None else None, ts))

    sla_by_mgr: dict[int, list[float]] = defaultdict(list)
    leads_cnt: dict[int, int] = defaultdict(int)
    for lid, mid in mgr_of.items():
        leads_cnt[mid] += 1
        mins = first_reply_minutes(by_lead.get(lid, []), mid)
        if mins is not None:
            sla_by_mgr[mid].append(mins)

    all_mins = [m for vals in sla_by_mgr.values() for m in vals]
    avg_all = round(sum(all_mins) / len(all_mins), 2) if all_mins else None
    managers_sla = [
        RopAnalyticsManagerSla(
            user_id=mid,
            full_name=_display_name(by_id[mid]) if mid in by_id else f"#{mid}",
            avg_first_response_minutes=(
                round(sum(sla_by_mgr[mid]) / len(sla_by_mgr[mid]), 2) if sla_by_mgr.get(mid) else None
            ),
            leads_count=leads_cnt.get(mid, 0),
        )
        for mid in manager_ids
        if mid in by_id
    ]

    amounts: list[tuple[int, str, Decimal, Decimal, Decimal, int, int]] = []
    if manager_ids:
        allowed_names, allowed_plan_ids = await _kpi_plan_service_allowlist(
            db,
            company_id=company_id,
            pipeline_id=pipeline_id,
            date_from=date_from,
            date_to=date_to,
        )
        full_paid = and_(
            BookingAppointment.service_amount > 0,
            BookingAppointment.paid_amount >= BookingAppointment.service_amount,
        )
        if allowed_names:
            for mid, svc, paid, sold, full_amt, sold_n, full_n in (
                await db.execute(
                    select(
                        func.coalesce(BookingAppointment.responsible_manager_id, Lead.manager_id),
                        BookingDirection.name,
                        func.coalesce(func.sum(BookingAppointment.paid_amount), 0),
                        func.coalesce(func.sum(BookingAppointment.service_amount), 0),
                        func.coalesce(
                            func.sum(case((full_paid, BookingAppointment.paid_amount), else_=0)),
                            0,
                        ),
                        func.count(),
                        func.coalesce(func.sum(case((full_paid, 1), else_=0)), 0),
                    )
                    .outerjoin(Lead, Lead.id == BookingAppointment.lead_id)
                    .join(BookingDirection, BookingDirection.id == BookingAppointment.direction_id)
                    .where(
                        BookingAppointment.company_id == company_id,
                        BookingAppointment.start_at >= start,
                        BookingAppointment.start_at < end,
                        BookingAppointment.status != "cancelled",
                        or_(
                            BookingAppointment.paid_amount > 0,
                            BookingAppointment.service_amount > 0,
                        ),
                        or_(
                            BookingAppointment.responsible_manager_id.in_(manager_ids),
                            and_(
                                BookingAppointment.responsible_manager_id.is_(None),
                                Lead.manager_id.in_(manager_ids),
                            ),
                        ),
                    )
                    .group_by(
                        func.coalesce(BookingAppointment.responsible_manager_id, Lead.manager_id),
                        BookingDirection.name,
                    )
                )
            ).all():
                if mid is None:
                    continue
                svc_name = str(svc or "Услуга")
                if _norm_rop_service(svc_name) not in allowed_names:
                    continue
                amounts.append(
                    (
                        int(mid),
                        svc_name,
                        Decimal(str(paid or 0)),
                        Decimal(str(sold or 0)),
                        Decimal(str(full_amt or 0)),
                        int(sold_n or 0),
                        int(full_n or 0),
                    )
                )

        if allowed_plan_ids:
            man_rev = (
                await db.execute(
                    select(
                        SalesKpiManualSale.manager_user_id,
                        SalesKpiManualSale.plan_item_id,
                        func.coalesce(func.sum(SalesKpiManualSalePayment.amount), 0),
                    )
                    .join(SalesKpiManualSalePayment, SalesKpiManualSalePayment.sale_id == SalesKpiManualSale.id)
                    .where(
                        SalesKpiManualSale.company_id == company_id,
                        SalesKpiManualSale.pipeline_id == pipeline_id,
                        SalesKpiManualSale.manager_user_id.in_(manager_ids),
                        SalesKpiManualSale.plan_item_id.in_(allowed_plan_ids),
                        SalesKpiManualSalePayment.paid_at >= start,
                        SalesKpiManualSalePayment.paid_at < end,
                    )
                    .group_by(SalesKpiManualSale.manager_user_id, SalesKpiManualSale.plan_item_id)
                )
            ).all()
            plan_names: dict[int, str] = {}
            pids = {int(r[1]) for r in man_rev if r[1] is not None}
            if pids:
                for pid, pname in (
                    await db.execute(
                        select(SalesKpiPlanItem.id, SalesKpiPlanItem.name).where(SalesKpiPlanItem.id.in_(pids))
                    )
                ).all():
                    plan_names[int(pid)] = str(pname)
            for mid, pid, amt in man_rev:
                if mid is None:
                    continue
                money = Decimal(str(amt or 0))
                amounts.append(
                    (int(mid), plan_names.get(int(pid), "Курс/протокол"), money, money, money, 0, 0)
                )

    total = sum((row[2] for row in amounts), Decimal("0"))
    shares = [
        RopRevenueShare(
            manager_id=mid,
            manager_name=_display_name(by_id[mid]) if mid in by_id else f"#{mid}",
            service_name=svc,
            amount=paid,
            percent_of_total=round(float(paid) * 100.0 / float(total), 1) if total else 0.0,
            sold_amount=sold,
            paid_amount=paid,
            full_paid_amount=full_amt,
            sold_count=sold_n,
            full_paid_count=full_n,
        )
        for mid, svc, paid, sold, full_amt, sold_n, full_n in amounts
        if paid > 0 or sold > 0
    ]
    shares.sort(key=lambda x: -float(x.amount))

    return RopAnalyticsReport(
        pipeline_id=int(pipe.id),
        pipeline_name=pipe.name,
        date_from=date_from,
        date_to=date_to,
        avg_first_response_minutes=avg_all,
        managers_sla=managers_sla,
        revenue_shares=shares,
        revenue_total=total,
    )


@router.get("/report", response_model=RopRevenueReport)
async def rop_report(
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentUser,
    company_id: CurrentCompanyId,
    pipeline_id: int = Query(..., ge=1),
    date_from: date = Query(..., alias="from"),
    date_to: date = Query(..., alias="to"),
) -> RopRevenueReport:
    analytics = await rop_analytics(db, current_user, company_id, pipeline_id, date_from, date_to)
    rows = [
        RopReportCell(
            manager_id=s.manager_id,
            manager_name=s.manager_name,
            service_name=s.service_name,
            amount=s.amount,
            sold_amount=s.sold_amount,
            paid_amount=s.paid_amount,
            full_paid_amount=s.full_paid_amount,
            sold_count=s.sold_count,
            full_paid_count=s.full_paid_count,
        )
        for s in analytics.revenue_shares
    ]
    return RopRevenueReport(
        pipeline_id=analytics.pipeline_id,
        pipeline_name=analytics.pipeline_name,
        date_from=date_from,
        date_to=date_to,
        rows=rows,
        total=analytics.revenue_total,
        sold_total=sum((r.sold_amount for r in rows), Decimal("0")),
        full_paid_total=sum((r.full_paid_amount for r in rows), Decimal("0")),
    )


def _parse_year_month(value: str | None, *, today: date) -> date:
    if not value:
        return date(today.year, today.month, 1)
    raw = value.strip()
    try:
        y_s, m_s = raw.split("-", 1)
        y, m = int(y_s), int(m_s)
        if m < 1 or m > 12:
            raise ValueError
        return date(y, m, 1)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail="year_month: ожидается YYYY-MM") from exc


def _prev_month_start(month_start: date) -> date:
    if month_start.month == 1:
        return date(month_start.year - 1, 12, 1)
    return date(month_start.year, month_start.month - 1, 1)


def _next_month_start(month_start: date) -> date:
    if month_start.month == 12:
        return date(month_start.year + 1, 1, 1)
    return date(month_start.year, month_start.month + 1, 1)


def _month_last_day(month_start: date) -> date:
    return _next_month_start(month_start) - timedelta(days=1)


_HOT_STAGES = frozenset({"Новый лид", "В обработке"})


async def _outlook_plan_by_manager(
    db: AsyncSession,
    *,
    company_id: int,
    pipeline_id: int,
    ym: date,
    manager_ids: list[int],
) -> dict[int, Decimal]:
    """План KPI на месяц: qty×цена из матрицы услуг, иначе legacy SalesKpiPlan."""
    if not manager_ids:
        return {}
    prices = {
        int(did): Decimal(str(price or 0))
        for did, price in (
            await db.execute(
                select(SalesKpiServicePrice.direction_id, SalesKpiServicePrice.unit_price).where(
                    SalesKpiServicePrice.company_id == company_id,
                    SalesKpiServicePrice.pipeline_id == pipeline_id,
                    SalesKpiServicePrice.year_month == ym,
                )
            )
        ).all()
    }
    plan_map: dict[int, Decimal] = defaultdict(lambda: Decimal("0"))
    if prices:
        for mid, did, qty in (
            await db.execute(
                select(
                    SalesKpiServicePlan.manager_user_id,
                    SalesKpiServicePlan.direction_id,
                    SalesKpiServicePlan.plan_qty,
                ).where(
                    SalesKpiServicePlan.company_id == company_id,
                    SalesKpiServicePlan.pipeline_id == pipeline_id,
                    SalesKpiServicePlan.year_month == ym,
                    SalesKpiServicePlan.manager_user_id.in_(manager_ids),
                )
            )
        ).all():
            if mid is None or did is None:
                continue
            unit = prices.get(int(did), Decimal("0"))
            plan_map[int(mid)] += (Decimal(int(qty or 0)) * unit).quantize(Decimal("0.01"))
    if any(v > 0 for v in plan_map.values()):
        return dict(plan_map)

    legacy = (
        await db.execute(
            select(SalesKpiPlan.manager_user_id, func.coalesce(func.sum(SalesKpiPlan.plan_amount), 0)).where(
                SalesKpiPlan.company_id == company_id,
                SalesKpiPlan.pipeline_id == pipeline_id,
                SalesKpiPlan.year_month == ym,
                SalesKpiPlan.manager_user_id.in_(manager_ids),
            ).group_by(SalesKpiPlan.manager_user_id)
        )
    ).all()
    return {int(mid): Decimal(str(amt or 0)) for mid, amt in legacy if mid is not None}


async def _outlook_signals(
    db: AsyncSession,
    *,
    company_id: int,
    pipeline_id: int,
    manager_ids: list[int],
    by_id: dict[int, User],
) -> list[RopOutlookSignal]:
    if not manager_ids:
        return []
    now = datetime.now(UTC)
    threshold_h = float(UNREPLIED_HOURS_DEFAULT)

    active_rows = (
        await db.execute(
            select(Lead.manager_id, PipelineStage.name, func.count())
            .join(PipelineStage, PipelineStage.id == Lead.status_id)
            .where(
                Lead.company_id == company_id,
                PipelineStage.pipeline_id == pipeline_id,
                Lead.manager_id.in_(manager_ids),
                PipelineStage.name.notin_(tuple(_DASH_DONE_STAGES)),
                lead_has_contact_phone(),
            )
            .group_by(Lead.manager_id, PipelineStage.name)
        )
    ).all()
    active_map: dict[int, int] = defaultdict(int)
    hot_map: dict[int, int] = defaultdict(int)
    for mid, sname, cnt in active_rows:
        if mid is None:
            continue
        mid_i, n = int(mid), int(cnt)
        active_map[mid_i] += n
        if str(sname) in _HOT_STAGES:
            hot_map[mid_i] += n

    open_leads = (
        await db.execute(
            select(Lead.id, Lead.manager_id, Lead.created_at)
            .join(PipelineStage, PipelineStage.id == Lead.status_id)
            .where(
                Lead.company_id == company_id,
                PipelineStage.pipeline_id == pipeline_id,
                Lead.manager_id.in_(manager_ids),
                PipelineStage.name.notin_(tuple(_DASH_DONE_STAGES)),
                lead_has_contact_phone(),
            )
        )
    ).all()
    lead_meta = {int(lid): (int(mid), created) for lid, mid, created in open_leads if mid is not None}
    lead_ids = list(lead_meta.keys())
    msgs_by_lead: dict[int, list[tuple[str, datetime]]] = defaultdict(list)
    if lead_ids:
        for lid, direction, ts in (
            await db.execute(
                select(ChatThread.lead_id, ChatMessage.direction, ChatMessage.created_at)
                .join(ChatMessage, ChatMessage.thread_id == ChatThread.id)
                .where(ChatThread.lead_id.in_(lead_ids))
                .order_by(ChatMessage.created_at.asc(), ChatMessage.id.asc())
            )
        ).all():
            if lid is None or ts is None:
                continue
            msgs_by_lead[int(lid)].append((str(direction or ""), ts))

    unreplied_map: dict[int, int] = defaultdict(int)
    for lid, (mid, created) in lead_meta.items():
        if waiting_unreplied(
            messages=msgs_by_lead.get(lid, []),
            now=now,
            threshold_hours=threshold_h,
            lead_created_at=created,
        ):
            unreplied_map[mid] += 1

    inputs: list[ManagerSignalInput] = []
    for mid in manager_ids:
        u = by_id.get(mid)
        if u is None:
            continue
        inputs.append(
            ManagerSignalInput(
                manager_id=mid,
                manager_name=_display_name(u),
                is_online=_is_online(u.last_seen_at, now=now),
                active_leads=active_map.get(mid, 0),
                hot_leads=hot_map.get(mid, 0),
                unreplied_count=unreplied_map.get(mid, 0),
            )
        )
    return [
        RopOutlookSignal(
            kind=s.kind,
            severity=s.severity,
            title=s.title,
            detail=s.detail,
            count=s.count,
            manager_id=s.manager_id,
            manager_name=s.manager_name,
        )
        for s in collect_signals(inputs, unreplied_hours=UNREPLIED_HOURS_DEFAULT)
    ]


async def _build_week_pace(
    db: AsyncSession,
    current_user: User,
    company_id: int,
    pipeline_id: int,
    today: date,
) -> RopWeekPace:
    """Кольца темпа: факт с понедельника против тех же дней прошлой недели."""
    cur_from, cur_to, prev_from, prev_to = week_pace_bounds(today)
    cur_start, _ = _day_bounds(cur_from)
    _, cur_end = _day_bounds(cur_to)
    prev_start, _ = _day_bounds(prev_from)
    _, prev_end = _day_bounds(prev_to)

    cur_rev = (
        await rop_analytics(db, current_user, company_id, pipeline_id, cur_from, cur_to)
    ).revenue_total
    prev_rev = (
        await rop_analytics(db, current_user, company_id, pipeline_id, prev_from, prev_to)
    ).revenue_total

    async def _new_leads(start: datetime, end: datetime) -> int:
        value = await db.scalar(
            select(func.count(Lead.id))
            .join(PipelineStage, PipelineStage.id == Lead.status_id)
            .where(
                Lead.company_id == company_id,
                PipelineStage.pipeline_id == pipeline_id,
                PipelineStage.name != ARCHIVE_STAGE_NAME,
                Lead.created_at >= start,
                Lead.created_at < end,
            )
        )
        return int(value or 0)

    async def _won(start: datetime, end: datetime) -> int:
        value = await db.scalar(
            select(func.count(func.distinct(Lead.id)))
            .join(LeadAuditEvent, LeadAuditEvent.lead_id == Lead.id)
            .join(PipelineStage, PipelineStage.id == Lead.status_id)
            .where(
                Lead.company_id == company_id,
                PipelineStage.pipeline_id == pipeline_id,
                LeadAuditEvent.action == "status_changed",
                LeadAuditEvent.details.like("%-> Удачно%"),
                LeadAuditEvent.created_at >= start,
                LeadAuditEvent.created_at < end,
            )
        )
        return int(value or 0)

    async def _bookings(start: datetime, end: datetime) -> int:
        value = await db.scalar(
            select(func.count(BookingAppointment.id))
            .outerjoin(Lead, Lead.id == BookingAppointment.lead_id)
            .outerjoin(PipelineStage, PipelineStage.id == Lead.status_id)
            .where(
                BookingAppointment.company_id == company_id,
                BookingAppointment.created_at >= start,
                BookingAppointment.created_at < end,
                BookingAppointment.status != "cancelled",
                or_(
                    BookingAppointment.pipeline_id == pipeline_id,
                    PipelineStage.pipeline_id == pipeline_id,
                ),
            )
        )
        return int(value or 0)

    leads_now = await _new_leads(cur_start, cur_end)
    leads_was = await _new_leads(prev_start, prev_end)
    won_now = await _won(cur_start, cur_end)
    won_was = await _won(prev_start, prev_end)
    book_now = await _bookings(cur_start, cur_end)
    book_was = await _bookings(prev_start, prev_end)

    fresh = (
        await db.execute(
            select(Lead.id, PipelineStage.name)
            .join(PipelineStage, PipelineStage.id == Lead.status_id)
            .where(
                Lead.company_id == company_id,
                PipelineStage.pipeline_id == pipeline_id,
                PipelineStage.name != ARCHIVE_STAGE_NAME,
                Lead.created_at >= cur_start,
                Lead.created_at < cur_end,
            )
        )
    ).all()
    fresh_ids = [int(lid) for lid, _name in fresh]
    open_n = sum(1 for _lid, name in fresh if str(name or "") in _STATS_OPEN_STAGES)
    booked_n = 0
    came_n = 0
    if fresh_ids:
        booked_n = int(
            await db.scalar(
                select(func.count(func.distinct(BookingAppointment.lead_id))).where(
                    BookingAppointment.lead_id.in_(fresh_ids),
                    BookingAppointment.status != "cancelled",
                )
            )
            or 0
        )
        came_n = int(
            await db.scalar(
                select(func.count(func.distinct(BookingAppointment.lead_id))).where(
                    BookingAppointment.lead_id.in_(fresh_ids),
                    BookingAppointment.status == "completed",
                )
            )
            or 0
        )

    def metric(key: str, label: str, current: Decimal, previous: Decimal, note: str) -> RopWeekPaceMetric:
        return RopWeekPaceMetric(
            key=key,
            label=label,
            current=current,
            previous=previous,
            percent=pace_percent(current, previous),
            note=note,
        )

    return RopWeekPace(
        date_from=cur_from,
        date_to=cur_to,
        compare_from=prev_from,
        compare_to=prev_to,
        label=week_span_label(cur_from, cur_to),
        compare_label=week_span_label(prev_from, prev_to),
        metrics=[
            metric(
                "revenue",
                "Выручка недели",
                Decimal(str(cur_rev or 0)),
                Decimal(str(prev_rev or 0)),
                "оплаты записи и курсов за эти дни",
            ),
            metric(
                "leads",
                "Новые лиды",
                Decimal(leads_now),
                Decimal(leads_was),
                "карточки, созданные за эти дни. Архив не входит",
            ),
            metric(
                "won",
                "Удачно",
                Decimal(won_now),
                Decimal(won_was),
                "переводы в «Удачно», в том числе владельцем",
            ),
            metric(
                "bookings",
                "Записи",
                Decimal(book_now),
                Decimal(book_was),
                "новые визиты в онлайн-записи",
            ),
            RopWeekPaceMetric(
                key="calls",
                label="Разговоры 30+ мин",
                note="в CRM нет длины звонка",
                tracked=False,
            ),
        ],
        funnel=[
            RopWeekPaceStep(label="Новые лиды", value=leads_now, note="созданы за эти дни"),
            RopWeekPaceStep(label="В обработке", value=open_n, note="ещё без исхода"),
            RopWeekPaceStep(label="Запись", value=booked_n, note="есть визит"),
            RopWeekPaceStep(label="Пришёл", value=came_n, note="визит со статусом «Пришёл»"),
        ],
    )


@router.get("/outlook", response_model=RopOutlookReport)
async def rop_outlook(
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentUser,
    company_id: CurrentCompanyId,
    pipeline_id: int = Query(..., ge=1),
    year_month: str | None = Query(None, description="YYYY-MM, по умолчанию текущий месяц"),
) -> RopOutlookReport:
    """Сравнение с прошлым месяцем и сценарии до конца месяца (темп × дни)."""
    _assert_rop(current_user)
    today = _today_local()
    month_start = _parse_year_month(year_month, today=today)
    if month_start > date(today.year, today.month, 1):
        raise HTTPException(status_code=400, detail="Нельзя строить прогноз на будущий месяц")

    pipe = await _load_pipeline(db, company_id, pipeline_id)
    prev_start = _prev_month_start(month_start)
    cur_end = min(today, _month_last_day(month_start)) if month_start.year == today.year and month_start.month == today.month else _month_last_day(month_start)
    prev_end = _month_last_day(prev_start)

    cur_analytics = await rop_analytics(db, current_user, company_id, pipeline_id, month_start, cur_end)
    prev_analytics = await rop_analytics(db, current_user, company_id, pipeline_id, prev_start, prev_end)

    def _month_from_analytics(analytics: RopAnalyticsReport, *, start: date, end: date) -> RopOutlookMonth:
        sold = sum(int(s.sold_count or 0) for s in analytics.revenue_shares)
        full = sum(int(s.full_paid_count or 0) for s in analytics.revenue_shares)
        leads = sum(int(m.leads_count or 0) for m in analytics.managers_sla)
        conv = round(100.0 * full / sold, 1) if sold else 0.0
        return RopOutlookMonth(
            year_month=f"{start.year:04d}-{start.month:02d}",
            label=month_label_ru(start),
            leads=leads,
            revenue=analytics.revenue_total,
            sold_count=sold,
            full_paid_count=full,
            conversion_percent=conv,
        )

    current = _month_from_analytics(cur_analytics, start=month_start, end=cur_end)
    previous = _month_from_analytics(prev_analytics, start=prev_start, end=prev_end)
    current.leads_delta_pct = pct_delta(current.leads, previous.leads)
    current.revenue_delta_pct = pct_delta(current.revenue, previous.revenue)
    current.conversion_delta_pp = (
        round(current.conversion_percent - previous.conversion_percent, 1)
        if previous.sold_count or current.sold_count
        else None
    )

    elapsed = days_elapsed_in_month(today if cur_end >= today else cur_end, month_start)
    remaining = days_remaining_in_month(today if cur_end >= today else cur_end, month_start)
    # Закрытый месяц: темп по полным дням, remaining = 0 → сценарии = факт.
    if remaining == 0 and elapsed == 0:
        elapsed = max(1, (_month_last_day(month_start) - month_start).days + 1)

    scen = project_scenarios(
        leads_so_far=current.leads,
        revenue_so_far=current.revenue,
        elapsed_days=elapsed,
        remaining_days=remaining,
        prev_leads=previous.leads,
        prev_revenue=previous.revenue,
    )
    scenarios = [
        RopOutlookScenario(key=key, label=scen[key].label, leads=scen[key].leads, revenue=scen[key].revenue)
        for key in ("worst", "mid", "best")
    ]

    nxt_start = _next_month_start(month_start)
    nxt_days = (_month_last_day(nxt_start) - nxt_start).days + 1
    nxt = next_month_mid(
        revenue_so_far=current.revenue,
        leads_so_far=current.leads,
        elapsed_days=elapsed,
        next_month_days=nxt_days,
    )
    next_scenario = RopOutlookScenario(key="next_mid", label=nxt.label, leads=nxt.leads, revenue=nxt.revenue)

    pace_days = max(1, elapsed)
    pace = RopOutlookPace(
        leads_per_day=round(current.leads / pace_days, 2),
        revenue_per_day=Decimal(str(round(float(current.revenue) / pace_days, 2))),
        elapsed_days=elapsed,
        remaining_days=remaining,
    )
    summary = build_summary(
        revenue_delta_pct=current.revenue_delta_pct,
        mid_revenue=scen["mid"].revenue,
        current_revenue=current.revenue,
    )

    manager_ids = await _pipeline_manager_ids(db, company_id=company_id, pipeline_id=pipeline_id)
    managers = (
        await db.execute(select(User).where(User.id.in_(manager_ids or [0])))
    ).scalars().all() if manager_ids else []
    by_id = {int(u.id): u for u in managers}

    fact_map: dict[int, Decimal] = defaultdict(lambda: Decimal("0"))
    for share in cur_analytics.revenue_shares:
        fact_map[int(share.manager_id)] += Decimal(str(share.amount or 0))

    plan_map = await _outlook_plan_by_manager(
        db,
        company_id=company_id,
        pipeline_id=pipeline_id,
        ym=month_start,
        manager_ids=manager_ids,
    )
    plan_fact_ids = sorted(set(plan_map.keys()) | set(fact_map.keys()), key=lambda mid: _display_name(by_id[mid]).lower() if mid in by_id else str(mid))
    plan_fact: list[RopOutlookPlanFact] = []
    for mid in plan_fact_ids:
        plan_amt = plan_map.get(mid, Decimal("0"))
        fact_amt = fact_map.get(mid, Decimal("0"))
        if plan_amt <= 0 and fact_amt <= 0:
            continue
        progress = round(float(fact_amt) * 100.0 / float(plan_amt), 1) if plan_amt > 0 else 0.0
        plan_fact.append(
            RopOutlookPlanFact(
                manager_id=mid,
                manager_name=_display_name(by_id[mid]) if mid in by_id else f"#{mid}",
                plan_amount=plan_amt,
                fact_amount=fact_amt,
                progress_percent=progress,
            )
        )
    plan_total = sum((r.plan_amount for r in plan_fact), Decimal("0"))
    fact_total = sum((r.fact_amount for r in plan_fact), Decimal("0"))

    signals = await _outlook_signals(
        db,
        company_id=company_id,
        pipeline_id=pipeline_id,
        manager_ids=manager_ids,
        by_id=by_id,
    )
    week = await _build_week_pace(
        db,
        current_user,
        company_id,
        pipeline_id,
        today,
    )

    return RopOutlookReport(
        as_of=today,
        pipeline_id=int(pipe.id),
        pipeline_name=pipe.name,
        current=current,
        previous=previous,
        pace=pace,
        scenarios=scenarios,
        next_month=next_scenario,
        summary=summary,
        signals=signals,
        plan_fact=plan_fact,
        plan_total=plan_total,
        fact_total=fact_total,
        week=week,
    )


@router.get("/search", response_model=list[RopSearchPatient])
async def rop_search(
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentUser,
    company_id: CurrentCompanyId,
    q: str = Query(..., min_length=2, max_length=120),
    limit: int = Query(20, ge=1, le=50),
) -> list[RopSearchPatient]:
    """Поиск пациента по ФИО / телефону — история визитов из онлайн-записи."""
    _assert_rop(current_user)
    term = q.strip()
    if not term:
        return []
    like = f"%{term}%"
    digits = "".join(ch for ch in term if ch.isdigit())
    digit_variants = phone_search_digit_variants(term)
    match_conds = [
        BookingAppointment.patient_name.ilike(like),
        BookingAppointment.patient_phone.ilike(like),
    ]
    # Телефон любой страны: +992 / +7 / +1 / 8… — по цифрам без маски.
    if digit_variants:
        phone_digits_expr = func.regexp_replace(
            func.coalesce(BookingAppointment.patient_phone, ""),
            r"\D",
            "",
            "g",
        )
        for variant in digit_variants:
            match_conds.append(phone_digits_expr.like(f"%{variant}%"))
    if digits and term.isdigit() and len(digits) <= 10:
        num = int(digits)
        match_conds.append(BookingAppointment.lead_id == num)
        match_conds.append(BookingAppointment.id == num)

    # Лид CRM по имени/телефону → его записи тоже в выдачу.
    lead_match = [
        Lead.name.ilike(like),
        Lead.phone.ilike(like),
    ]
    if digit_variants:
        lead_phone_digits = func.regexp_replace(func.coalesce(Lead.phone, ""), r"\D", "", "g")
        for variant in digit_variants:
            lead_match.append(lead_phone_digits.like(f"%{variant}%"))
    lead_ids = (
        await db.execute(
            select(Lead.id)
            .where(Lead.company_id == company_id, or_(*lead_match))
            .order_by(Lead.id.desc())
            .limit(40)
        )
    ).scalars().all()
    if lead_ids:
        match_conds.append(BookingAppointment.lead_id.in_([int(x) for x in lead_ids]))

    rows = (
        await db.execute(
            select(
                BookingAppointment.id,
                BookingAppointment.patient_name,
                BookingAppointment.patient_phone,
                BookingAppointment.start_at,
                BookingAppointment.status,
                BookingAppointment.service_title,
                BookingAppointment.service_amount,
                BookingAppointment.paid_amount,
                BookingAppointment.responsible_manager_id,
                BookingSpecialist.full_name,
            )
            .select_from(BookingAppointment)
            .outerjoin(BookingSpecialist, BookingAppointment.specialist_id == BookingSpecialist.id)
            .where(
                BookingAppointment.company_id == company_id,
                or_(*match_conds),
            )
            .order_by(BookingAppointment.start_at.desc(), BookingAppointment.id.desc())
            .limit(limit * 25)
        )
    ).all()

    mgr_ids = {int(r[8]) for r in rows if r[8] is not None}
    mgr_names: dict[int, str] = {}
    if mgr_ids:
        for u in (await db.execute(select(User).where(User.id.in_(mgr_ids)))).scalars().all():
            mgr_names[int(u.id)] = _display_name(u)

    grouped: dict[tuple[str, str], RopSearchPatient] = {}
    for (
        appt_id,
        patient_name,
        patient_phone,
        start_at,
        status_value,
        service_title,
        service_amount,
        paid_amount,
        resp_mid,
        specialist_name,
    ) in rows:
        name = (patient_name or "").strip() or "Клиент"
        phone = (patient_phone or "").strip() or "—"
        key = (name.casefold(), phone)
        item = grouped.get(key)
        if item is None:
            if len(grouped) >= limit:
                continue
            item = RopSearchPatient(
                patient_name=name,
                patient_phone=phone,
                total_visits=0,
                visits=[],
            )
            grouped[key] = item
        item.total_visits += 1
        if item.first_visit_at is None or start_at < item.first_visit_at:
            item.first_visit_at = start_at
        if item.last_visit_at is None or start_at > item.last_visit_at:
            item.last_visit_at = start_at
        mid = int(resp_mid) if resp_mid is not None else None
        item.visits.append(
            RopSearchVisit(
                appointment_id=int(appt_id),
                start_at=start_at,
                specialist_name=specialist_name,
                status=str(status_value or ""),
                service_title=service_title,
                service_amount=float(service_amount or 0),
                paid_amount=float(paid_amount or 0),
                responsible_manager_id=mid,
                responsible_manager_name=mgr_names.get(mid) if mid else None,
            )
        )

    return list(grouped.values())[:limit]
