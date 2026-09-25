from datetime import UTC, date, datetime, timedelta
from decimal import Decimal
import re
from typing import Annotated
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import and_, case, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.core.deps import CurrentCompanyId, CurrentUser
from app.database import get_db
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
    User,
    UserPipelineAssignment,
    UserRole,
)
from app.services.booking_directions import is_admin_only_booking_direction_name
from app.services.sales_kpi_weighted import (
    booking_debt_cutoff,
    course_debt_is_due,
    first_course_payment_at,
)
from app.schemas.analytics import (
    AgeCategoryAnalyticsItem,
    AnalyticsAlertsRead,
    AnalyticsOverviewRead,
    CustomerValueRead,
    DetailedAnalyticsRead,
    ExecutiveKpiRead,
    FullAnalyticsRead,
    LossReasonItem,
    ManagerDetailedAnalyticsItem,
    ManagerPerformanceItem,
    ManagerPlanFactItem,
    PipelineFullAnalyticsItem,
    ServicesAnalyticsExpertRow,
    ServicesAnalyticsRead,
    ServicesAnalyticsServiceRow,
    SourceAnalyticsItem,
    StageConversionItem,
)

router = APIRouter(prefix="/analytics", tags=["analytics"])

WON_STAGE_NAMES = frozenset({"Удачно"})
FUNNEL_PATH = ("Новый лид", "В обработке", "В ожидании", "Удачно")
SIDE_STAGE_NAMES = ("Отказ", "Архив")
_STAGE_CHANGE_RE = re.compile(r"Смена стадии:\s*(.*?)\s*->\s*([^;]+)")


def _source_label(raw: str | None) -> str:
    s = (raw or "").strip().lower()
    if not s or s in {"не указан", "none", "null"}:
        return ""
    if "instagram" in s or "инстаграм" in s or "инста" in s or s in {"ig", "insta"}:
        return "Инстаграм"
    if "telegram" in s or "телеграм" in s:
        return "Telegram"
    if "green" in s or "whatsapp" in s or "ватсап" in s or "вотсап" in s or s in {"wa", "green_api"}:
        return "WhatsApp"
    if "google" in s or "sheet" in s or "таблиц" in s:
        return "Google Таблица"
    if "онлайн" in s or s == "booking":
        return "Онлайн-запись"
    return (raw or "").strip()


def _biz_tz() -> ZoneInfo:
    try:
        return ZoneInfo(settings.booking_timezone or "Asia/Dushanbe")
    except Exception:
        return ZoneInfo("Asia/Dushanbe")


def _performance_score(
    *,
    plan_pct: float,
    win_pct: float,
    reply_pct: float,
    sla_minutes: float | None,
    has_plan: bool,
) -> float:
    # Балл из реальных долей: план, ответы в чате, доля «Удачно». SLA не тянем — он был от открытия карточки.
    del sla_minutes
    if has_plan:
        return round(0.50 * min(plan_pct, 100.0) + 0.30 * reply_pct + 0.20 * win_pct, 1)
    return round(0.60 * reply_pct + 0.40 * win_pct, 1)


def _activity_score(*, reply_pct: float, outbound: int, messaged: int) -> float:
    volume = min(100.0, (outbound * 8.0) + (messaged * 4.0))
    return round(0.65 * reply_pct + 0.35 * volume, 1)


def _period_bounds(period: str, date_from: str | None, date_to: str | None) -> tuple[datetime, datetime]:
    """
    Рабочие сутки компании: с 18:00 до 17:00 следующего дня (Asia/Dushanbe).
    «За день» — текущее такое окно относительно сейчас.
    """
    tz = _biz_tz()
    now_local = datetime.now(tz)

    def _as_utc(start_local: datetime, end_local: datetime) -> tuple[datetime, datetime]:
        if end_local <= start_local:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Период задан неверно")
        return start_local.astimezone(UTC), end_local.astimezone(UTC)

    if period == "day":
        # До 18:00 — окно вчера 18:00 → сегодня 17:00; с 18:00 — сегодня 18:00 → завтра 17:00.
        today0 = now_local.replace(hour=0, minute=0, second=0, microsecond=0)
        if now_local.hour >= 18:
            start_local = today0.replace(hour=18)
            end_local = (today0 + timedelta(days=1)).replace(hour=17)
        else:
            start_local = (today0 - timedelta(days=1)).replace(hour=18)
            end_local = today0.replace(hour=17)
        return _as_utc(start_local, end_local)

    if period == "month":
        first = datetime(now_local.year, now_local.month, 1, tzinfo=tz)
        start_local = (first - timedelta(days=1)).replace(hour=18, minute=0, second=0, microsecond=0)
        if now_local.month == 12:
            next_month = datetime(now_local.year + 1, 1, 1, tzinfo=tz)
        else:
            next_month = datetime(now_local.year, now_local.month + 1, 1, tzinfo=tz)
        last_day = next_month - timedelta(days=1)
        end_local = last_day.replace(hour=17, minute=0, second=0, microsecond=0)
        return _as_utc(start_local, end_local)

    if period == "custom":
        if not date_from or not date_to:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Укажите даты начала и окончания периода",
            )
        try:
            d_from = datetime.strptime(date_from, "%Y-%m-%d")
            d_to = datetime.strptime(date_to, "%Y-%m-%d")
        except ValueError:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Неверный формат дат")
        # Календарная дата = день окончания окна (…→ эта дата 17:00); старт = вчера 18:00 от date_from.
        start_day = d_from.replace(tzinfo=tz)
        end_day = d_to.replace(tzinfo=tz)
        start_local = (start_day - timedelta(days=1)).replace(hour=18, minute=0, second=0, microsecond=0)
        end_local = end_day.replace(hour=17, minute=0, second=0, microsecond=0)
        return _as_utc(start_local, end_local)

    raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="period: day | month | custom")


def _lead_in_period(start: datetime, end: datetime):
    """Только лиды, созданные в окне (не реактивация из архива)."""
    return and_(Lead.created_at >= start, Lead.created_at < end)


def _assert_owner(current_user: CurrentUser) -> None:
    if current_user.role != UserRole.owner:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Только владелец")


def _safe_pct(num: float, den: float) -> float:
    if den <= 0:
        return 0.0
    return round(min((num / den) * 100, 100.0), 2)


_AGE_CATEGORY_ORDER: tuple[str, ...] = (
    "До 1 года",
    "1–3 года",
    "3–7 лет",
    "7–12 лет",
    "12–18 лет",
    "18+ лет",
    "Не указано",
)


def _age_years_on(birth: date, on_day: date) -> int | None:
    if birth > on_day:
        return None
    years = on_day.year - birth.year
    if (on_day.month, on_day.day) < (birth.month, birth.day):
        years -= 1
    return max(years, 0)


def _age_category_label(birth: date | None, on_day: date) -> str:
    if birth is None:
        return "Не указано"
    years = _age_years_on(birth, on_day)
    if years is None:
        return "Не указано"
    if years < 1:
        return "До 1 года"
    if years < 3:
        return "1–3 года"
    if years < 7:
        return "3–7 лет"
    if years < 12:
        return "7–12 лет"
    if years < 18:
        return "12–18 лет"
    return "18+ лет"


def build_funnel_rows(counts_by_name: dict[str, int]) -> list[tuple[str, int, float | None]]:
    """Снимок воронки: «дошли дальше» = кто уже на следующих стадиях / кто дошёл сюда.

    Не делит соседние колонки друг на друга (это давало 4991%).
    «Удачно», «Отказ», «Архив» — исходы, без процента «в следующую».
    """
    rows: list[tuple[str, int, float | None]] = []
    for idx, name in enumerate(FUNNEL_PATH):
        cur = int(counts_by_name.get(name, 0))
        if cur <= 0:
            continue
        later = sum(int(counts_by_name.get(n, 0)) for n in FUNNEL_PATH[idx + 1 :])
        reached = cur + later
        conv = _safe_pct(float(later), float(reached)) if idx + 1 < len(FUNNEL_PATH) and reached > 0 else None
        if name == "Удачно":
            conv = None
        rows.append((name, cur, conv))
    known = set(FUNNEL_PATH) | set(SIDE_STAGE_NAMES)
    for name in SIDE_STAGE_NAMES:
        cur = int(counts_by_name.get(name, 0))
        if cur > 0:
            rows.append((name, cur, None))
    for name, cur in counts_by_name.items():
        if name in known or int(cur) <= 0:
            continue
        rows.append((name, int(cur), None))
    return rows


def average_hours_in_stage(events_by_lead: dict[int, list[tuple[datetime, str]]]) -> dict[str, float]:
    """Среднее время на стадии по закрытым интервалам «A -> B» до следующего перехода."""
    buckets: dict[str, list[float]] = {}
    for events in events_by_lead.values():
        parsed: list[tuple[datetime, str]] = []
        for ts, details in events:
            match = _STAGE_CHANGE_RE.search(details or "")
            if match is None:
                continue
            parsed.append((ts, match.group(2).strip()))
        parsed.sort(key=lambda x: x[0])
        for i in range(len(parsed) - 1):
            ts, stage_name = parsed[i]
            nxt = parsed[i + 1][0]
            if nxt < ts or not stage_name:
                continue
            buckets.setdefault(stage_name, []).append((nxt - ts).total_seconds() / 3600.0)
    return {name: round(sum(vals) / len(vals), 2) for name, vals in buckets.items() if vals}


async def _manager_message_reply_counts(
    db: AsyncSession,
    *,
    company_id: int,
    start: datetime,
    end: datetime,
    pipeline_id: int | None,
) -> tuple[dict[int | None, int], dict[int | None, int]]:
    """По менеджерам: сколько лидов написали (in) и скольким менеджер ответил (out) за период."""
    lead_filters = [
        Lead.company_id == company_id,
        _lead_in_period(start, end),
    ]
    if pipeline_id is not None:
        lead_filters.append(PipelineStage.pipeline_id == pipeline_id)

    msg_company = or_(ChatMessage.company_id == company_id, ChatMessage.company_id.is_(None))

    inbound_rows = (
        await db.execute(
            select(Lead.manager_id, func.count(func.distinct(Lead.id)))
            .select_from(ChatMessage)
            .join(ChatThread, ChatThread.id == ChatMessage.thread_id)
            .join(Lead, Lead.id == ChatThread.lead_id)
            .join(PipelineStage, PipelineStage.id == Lead.status_id, isouter=True)
            .where(
                *lead_filters,
                msg_company,
                ChatMessage.direction == "in",
                ChatMessage.created_at >= start,
                ChatMessage.created_at < end,
            )
            .group_by(Lead.manager_id)
        )
    ).all()
    outbound_rows = (
        await db.execute(
            select(Lead.manager_id, func.count(func.distinct(Lead.id)))
            .select_from(ChatMessage)
            .join(ChatThread, ChatThread.id == ChatMessage.thread_id)
            .join(Lead, Lead.id == ChatThread.lead_id)
            .join(PipelineStage, PipelineStage.id == Lead.status_id, isouter=True)
            .where(
                *lead_filters,
                msg_company,
                ChatMessage.direction == "out",
                Lead.manager_id.is_not(None),
                ChatMessage.author_user_id == Lead.manager_id,
                ChatMessage.created_at >= start,
                ChatMessage.created_at < end,
            )
            .group_by(Lead.manager_id)
        )
    ).all()
    messaged = {mid: int(cnt or 0) for mid, cnt in inbound_rows}
    replied = {mid: int(cnt or 0) for mid, cnt in outbound_rows}
    return messaged, replied


async def _won_counts_by_manager(
    db: AsyncSession,
    *,
    company_id: int,
    start: datetime,
    end: datetime,
    pipeline_id: int | None,
) -> dict[int | None, int]:
    q = (
        select(Lead.manager_id, func.count(Lead.id))
        .select_from(Lead)
        .join(PipelineStage, PipelineStage.id == Lead.status_id, isouter=True)
        .where(
            Lead.company_id == company_id,
            _lead_in_period(start, end),
            PipelineStage.name.in_(WON_STAGE_NAMES),
        )
        .group_by(Lead.manager_id)
    )
    if pipeline_id is not None:
        q = q.where(PipelineStage.pipeline_id == pipeline_id)
    rows = (await db.execute(q)).all()
    return {mid: int(cnt or 0) for mid, cnt in rows}


async def _outbound_message_counts(
    db: AsyncSession,
    *,
    company_id: int,
    start: datetime,
    end: datetime,
    pipeline_id: int | None,
) -> dict[int, int]:
    q = (
        select(ChatMessage.author_user_id, func.count(ChatMessage.id))
        .select_from(ChatMessage)
        .join(ChatThread, ChatThread.id == ChatMessage.thread_id)
        .join(Lead, Lead.id == ChatThread.lead_id)
        .join(PipelineStage, PipelineStage.id == Lead.status_id, isouter=True)
        .where(
            Lead.company_id == company_id,
            ChatMessage.direction == "out",
            ChatMessage.created_at >= start,
            ChatMessage.created_at < end,
            ChatMessage.author_user_id.is_not(None),
        )
        .group_by(ChatMessage.author_user_id)
    )
    if pipeline_id is not None:
        q = q.where(PipelineStage.pipeline_id == pipeline_id)
    rows = (await db.execute(q)).all()
    return {int(uid): int(cnt or 0) for uid, cnt in rows if uid is not None}


def _avg_or_none(values: list[float]) -> float | None:
    if not values:
        return None
    return round(sum(values) / len(values), 2)


async def _ensure_pipeline_scope(db: AsyncSession, company_id: int, pipeline_id: int | None) -> int | None:
    if pipeline_id is None:
        return None
    pipe = await db.get(Pipeline, pipeline_id)
    if pipe is None or pipe.company_id != company_id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Unknown pipeline_id")
    return pipeline_id


@router.get("/full", response_model=FullAnalyticsRead)
async def analytics_full(
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentUser,
    company_id: CurrentCompanyId,
    period: str = Query("day"),
    date_from: str | None = Query(default=None),
    date_to: str | None = Query(default=None),
    pipeline_id: int | None = Query(default=None, ge=1),
) -> FullAnalyticsRead:
    _assert_owner(current_user)
    pipeline_id = await _ensure_pipeline_scope(db, company_id, pipeline_id)
    start, end = _period_bounds(period, date_from, date_to)

    total_q = select(func.count(Lead.id)).select_from(Lead).join(PipelineStage, PipelineStage.id == Lead.status_id, isouter=True).where(
        Lead.company_id == company_id,
        _lead_in_period(start, end),
    )
    if pipeline_id is not None:
        total_q = total_q.where(PipelineStage.pipeline_id == pipeline_id)
    total_leads = int(await db.scalar(total_q) or 0)

    leads_with_manager_expr = case((Lead.manager_id.is_not(None), Lead.id), else_=None)
    rows = (
        await db.execute(
            select(
                Pipeline.id,
                Pipeline.name,
                func.count(func.distinct(Lead.id)),
                func.count(func.distinct(leads_with_manager_expr)),
                func.coalesce(func.sum(BookingAppointment.paid_amount), 0),
                func.coalesce(func.sum(BookingAppointment.service_amount - BookingAppointment.paid_amount), 0),
            )
            .select_from(Lead)
            .join(PipelineStage, PipelineStage.id == Lead.status_id, isouter=True)
            .join(Pipeline, Pipeline.id == PipelineStage.pipeline_id, isouter=True)
            .join(
                BookingAppointment,
                (BookingAppointment.lead_id == Lead.id) & (BookingAppointment.company_id == company_id),
                isouter=True,
            )
            .where(
                Lead.company_id == company_id,
                _lead_in_period(start, end),
                PipelineStage.pipeline_id == pipeline_id if pipeline_id is not None else True,
            )
            .group_by(Pipeline.id, Pipeline.name)
            .order_by(Pipeline.name.asc().nulls_last()),
        )
    ).all()

    by_pipeline: list[PipelineFullAnalyticsItem] = []
    total_received = Decimal("0")
    total_debt = Decimal("0")
    for pid, pname, leads_count, processed, received, debt in rows:
        rec = Decimal(str(received or 0))
        deb = Decimal(str(debt or 0))
        total_received += rec
        total_debt += deb
        by_pipeline.append(
            PipelineFullAnalyticsItem(
                pipeline_id=pid,
                pipeline_name=pname or "Без воронки",
                leads_count=int(leads_count or 0),
                processed_by_manager_count=int(processed or 0),
                received_amount=rec,
                debt_amount=deb,
            )
        )
    return FullAnalyticsRead(
        total_leads=total_leads,
        total_received_amount=total_received,
        total_debt_amount=total_debt,
        by_pipeline=by_pipeline,
    )


@router.get("/detailed", response_model=DetailedAnalyticsRead)
async def analytics_detailed(
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentUser,
    company_id: CurrentCompanyId,
    period: str = Query("day"),
    date_from: str | None = Query(default=None),
    date_to: str | None = Query(default=None),
    pipeline_id: int | None = Query(default=None, ge=1),
) -> DetailedAnalyticsRead:
    _assert_owner(current_user)
    pipeline_id = await _ensure_pipeline_scope(db, company_id, pipeline_id)
    start, end = _period_bounds(period, date_from, date_to)

    total_q = select(func.count(Lead.id)).select_from(Lead).join(PipelineStage, PipelineStage.id == Lead.status_id, isouter=True).where(
        Lead.company_id == company_id,
        _lead_in_period(start, end),
    )
    if pipeline_id is not None:
        total_q = total_q.where(PipelineStage.pipeline_id == pipeline_id)
    total_leads = int(await db.scalar(total_q) or 0)

    # Все активные менеджеры (и админы на воронке) — даже с 0 лидов за период.
    managers_q = (
        select(User.id, User.full_name, User.email)
        .where(
            User.company_id == company_id,
            User.is_active.is_(True),
            User.role.in_((UserRole.manager, UserRole.admin)),
        )
        .order_by(User.full_name.asc().nulls_last(), User.email.asc().nulls_last())
    )
    if pipeline_id is not None:
        managers_q = (
            select(User.id, User.full_name, User.email)
            .join(
                UserPipelineAssignment,
                (UserPipelineAssignment.user_id == User.id)
                & (UserPipelineAssignment.pipeline_id == pipeline_id)
                & (UserPipelineAssignment.company_id == company_id),
            )
            .where(
                User.company_id == company_id,
                User.is_active.is_(True),
                User.role.in_((UserRole.manager, UserRole.admin)),
            )
            .order_by(User.full_name.asc().nulls_last(), User.email.asc().nulls_last())
        )
    roster_rows = (await db.execute(managers_q)).all()
    roster: dict[int, tuple[str | None, str | None]] = {
        int(uid): (full_name, email) for uid, full_name, email in roster_rows if uid is not None
    }

    stats_rows = (
        await db.execute(
            select(
                Lead.manager_id,
                func.count(func.distinct(Lead.id)),
                func.coalesce(func.sum(BookingAppointment.service_amount), 0),
                func.coalesce(func.sum(BookingAppointment.service_amount - BookingAppointment.paid_amount), 0),
            )
            .select_from(Lead)
            .join(PipelineStage, PipelineStage.id == Lead.status_id, isouter=True)
            .join(
                BookingAppointment,
                (BookingAppointment.lead_id == Lead.id) & (BookingAppointment.company_id == company_id),
                isouter=True,
            )
            .where(
                Lead.company_id == company_id,
                _lead_in_period(start, end),
                PipelineStage.pipeline_id == pipeline_id if pipeline_id is not None else True,
            )
            .group_by(Lead.manager_id),
        )
    ).all()
    stats_by_mgr: dict[int | None, tuple[int, Decimal, Decimal]] = {}
    for mid, leads_count, sold, unpaid in stats_rows:
        stats_by_mgr[int(mid) if mid is not None else None] = (
            int(leads_count or 0),
            Decimal(str(sold or 0)),
            Decimal(str(unpaid or 0)),
        )

    messaged_map, replied_map = await _manager_message_reply_counts(
        db, company_id=company_id, start=start, end=end, pipeline_id=pipeline_id
    )
    won_map = await _won_counts_by_manager(
        db, company_id=company_id, start=start, end=end, pipeline_id=pipeline_id
    )
    outbound_map = await _outbound_message_counts(
        db, company_id=company_id, start=start, end=end, pipeline_id=pipeline_id
    )

    # Имена для менеджеров, у которых есть лиды, но их уже нет в активном ростере.
    extra_ids = {
        mid
        for mid in stats_by_mgr
        if mid is not None and mid not in roster
    }
    if extra_ids:
        extra_rows = (
            await db.execute(select(User.id, User.full_name, User.email).where(User.id.in_(extra_ids)))
        ).all()
        for uid, full_name, email in extra_rows:
            roster[int(uid)] = (full_name, email)

    by_manager: list[ManagerDetailedAnalyticsItem] = []
    total_sold = Decimal("0")
    total_unpaid = Decimal("0")

    ordered_ids: list[int | None] = sorted(
        roster.keys(),
        key=lambda uid: (
            (roster[uid][0] or roster[uid][1] or "").casefold(),
            uid,
        ),
    )
    if None in stats_by_mgr:
        ordered_ids.append(None)

    for uid in ordered_ids:
        leads_n, sold_dec, unpaid_dec = stats_by_mgr.get(uid, (0, Decimal("0"), Decimal("0")))
        total_sold += sold_dec
        total_unpaid += unpaid_dec
        messaged = messaged_map.get(uid, 0)
        replied = replied_map.get(uid, 0)
        reply_pct = _safe_pct(float(replied), float(messaged))
        won_n = won_map.get(uid, 0)
        win_pct = _safe_pct(float(won_n), float(leads_n)) if leads_n else 0.0
        outbound = outbound_map.get(uid, 0) if uid is not None else 0
        if uid is None:
            name = "Без менеджера"
        else:
            full_name, email = roster.get(uid, (None, None))
            name = full_name or email or f"Менеджер #{uid}"
        by_manager.append(
            ManagerDetailedAnalyticsItem(
                manager_id=uid,
                manager_name=name,
                leads_count=leads_n,
                sold_amount=sold_dec,
                unpaid_amount=unpaid_dec,
                clients_messaged_count=messaged,
                manager_replied_count=replied,
                reply_rate_pct=reply_pct,
                outbound_messages_count=outbound,
                win_rate_pct=win_pct,
                avg_first_response_minutes=None,
                performance_score=_performance_score(
                    plan_pct=0,
                    win_pct=win_pct,
                    reply_pct=reply_pct,
                    sla_minutes=None,
                    has_plan=False,
                ),
                activity_score=_activity_score(reply_pct=reply_pct, outbound=outbound, messaged=messaged),
            )
        )
    return DetailedAnalyticsRead(
        total_leads=total_leads,
        total_sold_amount=total_sold,
        total_unpaid_amount=total_unpaid,
        by_manager=by_manager,
    )


@router.get("/overview", response_model=AnalyticsOverviewRead)
async def analytics_overview(
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentUser,
    company_id: CurrentCompanyId,
    period: str = Query("day"),
    date_from: str | None = Query(default=None),
    date_to: str | None = Query(default=None),
    pipeline_id: int | None = Query(default=None, ge=1),
) -> AnalyticsOverviewRead:
    _assert_owner(current_user)
    pipeline_id = await _ensure_pipeline_scope(db, company_id, pipeline_id)
    start, end = _period_bounds(period, date_from, date_to)

    leads_q = (
        select(Lead.id, Lead.status_id, Lead.source, Lead.refusal_reason, Lead.manager_id, Lead.created_at)
        .select_from(Lead)
        .join(PipelineStage, PipelineStage.id == Lead.status_id, isouter=True)
        .where(
            Lead.company_id == company_id,
            _lead_in_period(start, end),
        )
    )
    if pipeline_id is not None:
        leads_q = leads_q.where(PipelineStage.pipeline_id == pipeline_id)
    leads = (await db.execute(leads_q)).all()
    lead_ids = [int(row[0]) for row in leads]
    lead_ids_set = set(lead_ids)
    total_leads = len(lead_ids)

    stage_rows = (
        await db.execute(
            select(PipelineStage.id, PipelineStage.name, PipelineStage.order)
            .where(
                PipelineStage.company_id == company_id,
                PipelineStage.pipeline_id == pipeline_id if pipeline_id is not None else True,
            )
            .order_by(PipelineStage.order.asc(), PipelineStage.id.asc())
        )
    ).all()
    stage_map = {int(sid): (str(name), int(order or 0)) for sid, name, order in stage_rows}
    stage_counts: dict[int, int] = {}
    source_counts: dict[str, int] = {}
    source_lead_ids: dict[str, list[int]] = {}
    loss_reasons: dict[str, int] = {}
    manager_ids: set[int] = set()

    thread_providers: dict[int, set[str]] = {}
    if lead_ids:
        thread_rows = (
            await db.execute(
                select(ChatThread.lead_id, ChatThread.provider).where(
                    ChatThread.company_id == company_id,
                    ChatThread.lead_id.in_(lead_ids),
                )
            )
        ).all()
        for lid, provider in thread_rows:
            thread_providers.setdefault(int(lid), set()).add(str(provider or "").strip().lower())

    for lead_id, status_id, source, refusal_reason, manager_id, _created_at in leads:
        sid = int(status_id) if status_id is not None else -1
        stage_counts[sid] = stage_counts.get(sid, 0) + 1
        label = _source_label(source)
        provs = thread_providers.get(int(lead_id), set())
        # Карточка могла остаться «WhatsApp», хотя единственный чат — Инстаграм.
        if provs and provs <= {"instagram"} and label in {"", "WhatsApp", "Google Таблица"}:
            label = "Инстаграм"
        elif not label:
            if "instagram" in provs:
                label = "Инстаграм"
            elif "telegram" in provs:
                label = "Telegram"
            elif "green_api" in provs:
                label = "WhatsApp"
            else:
                label = "Не указан"
        source_counts[label] = source_counts.get(label, 0) + 1
        source_lead_ids.setdefault(label, []).append(int(lead_id))
        if refusal_reason and refusal_reason.strip():
            key = refusal_reason.strip()
            loss_reasons[key] = loss_reasons.get(key, 0) + 1
        elif sid in stage_map and stage_map[sid][0] == "Отказ":
            loss_reasons["Причина не указана"] = loss_reasons.get("Причина не указана", 0) + 1
        if manager_id is not None:
            manager_ids.add(int(manager_id))

    appt_rows = (
        await db.execute(
            select(BookingAppointment.lead_id, BookingAppointment.service_amount, BookingAppointment.paid_amount)
            .select_from(BookingAppointment)
            .join(Lead, Lead.id == BookingAppointment.lead_id)
            .join(PipelineStage, PipelineStage.id == Lead.status_id, isouter=True)
            .where(
                BookingAppointment.company_id == company_id,
                Lead.company_id == company_id,
                _lead_in_period(start, end),
                PipelineStage.pipeline_id == pipeline_id if pipeline_id is not None else True,
            )
        )
    ).all()
    paid_total = Decimal("0")
    unpaid_total = Decimal("0")
    lead_money: dict[int, tuple[Decimal, Decimal]] = {}
    for lead_id, sold, paid in appt_rows:
        lid = int(lead_id) if lead_id is not None else -1
        sold_dec = Decimal(str(sold or 0))
        paid_dec = Decimal(str(paid or 0))
        unpaid_dec = sold_dec - paid_dec
        if unpaid_dec < 0:
            unpaid_dec = Decimal("0")
        paid_total += paid_dec
        unpaid_total += unpaid_dec
        prev_sold, prev_paid = lead_money.get(lid, (Decimal("0"), Decimal("0")))
        lead_money[lid] = (prev_sold + sold_dec, prev_paid + paid_dec)

    # Карточки руководства: деньги визитов этого срока и платежи курсов, не только новые лиды.
    visit_filters = [
        BookingAppointment.company_id == company_id,
        BookingAppointment.start_at >= start,
        BookingAppointment.start_at < end,
    ]
    if pipeline_id is not None:
        visit_filters.append(BookingAppointment.pipeline_id == pipeline_id)
    visit_paid, visit_debt = (
        await db.execute(
            select(
                func.coalesce(func.sum(BookingAppointment.paid_amount), 0),
                func.coalesce(
                    func.sum(
                        case(
                            (
                                BookingAppointment.service_amount > BookingAppointment.paid_amount,
                                BookingAppointment.service_amount - BookingAppointment.paid_amount,
                            ),
                            else_=0,
                        )
                    ),
                    0,
                ),
            ).where(*visit_filters)
        )
    ).one()
    course_filters = [
        SalesKpiManualSalePayment.company_id == company_id,
        SalesKpiManualSalePayment.paid_at >= start,
        SalesKpiManualSalePayment.paid_at < end,
    ]
    course_q = select(func.coalesce(func.sum(SalesKpiManualSalePayment.amount), 0)).where(*course_filters)
    if pipeline_id is not None:
        course_q = (
            select(func.coalesce(func.sum(SalesKpiManualSalePayment.amount), 0))
            .join(SalesKpiManualSale, SalesKpiManualSale.id == SalesKpiManualSalePayment.sale_id)
            .where(*course_filters, SalesKpiManualSale.pipeline_id == pipeline_id)
        )
    course_paid = (await db.execute(course_q)).scalar_one()
    paid_total = Decimal(str(visit_paid or 0)) + Decimal(str(course_paid or 0))
    unpaid_total = Decimal(str(visit_debt or 0))

    # Конверсия — снимок воронки по имени стадии (не «следующая колонка / эта»).
    counts_by_name: dict[str, int] = {}
    name_to_stage_id: dict[str, int] = {}
    for sid, (sname, _order) in stage_map.items():
        cnt = stage_counts.get(sid, 0)
        if cnt <= 0:
            continue
        counts_by_name[sname] = counts_by_name.get(sname, 0) + cnt
        name_to_stage_id.setdefault(sname, sid)

    status_events = (
        await db.execute(
            select(LeadAuditEvent.lead_id, LeadAuditEvent.created_at, LeadAuditEvent.details)
            .select_from(LeadAuditEvent)
            .join(Lead, Lead.id == LeadAuditEvent.lead_id)
            .join(PipelineStage, PipelineStage.id == Lead.status_id, isouter=True)
            .where(
                LeadAuditEvent.company_id == company_id,
                LeadAuditEvent.action == "status_changed",
                Lead.company_id == company_id,
                _lead_in_period(start, end),
                PipelineStage.pipeline_id == pipeline_id if pipeline_id is not None else True,
            )
            .order_by(LeadAuditEvent.created_at.asc())
        )
    ).all()
    events_by_lead: dict[int, list[tuple[datetime, str]]] = {}
    for lead_id, ts, details in status_events:
        lid = int(lead_id)
        if lid in lead_ids_set:
            events_by_lead.setdefault(lid, []).append((ts, str(details or "")))
    hours_by_name = average_hours_in_stage(events_by_lead)

    stage_items: list[StageConversionItem] = []
    for idx, (sname, cur_count, conv) in enumerate(build_funnel_rows(counts_by_name)):
        stage_items.append(
            StageConversionItem(
                stage_id=name_to_stage_id.get(sname, idx + 1),
                stage_name=sname,
                order=idx,
                leads_count=cur_count,
                conversion_to_next_pct=conv,
                avg_time_in_stage_hours=hours_by_name.get(sname),
            )
        )

    # source analytics
    source_items: list[SourceAnalyticsItem] = []
    for src, cnt in sorted(source_counts.items(), key=lambda x: (-x[1], x[0])):
        if cnt <= 0:
            continue
        sold = Decimal("0")
        paid = Decimal("0")
        for lid in source_lead_ids.get(src, []):
            lsold, lpaid = lead_money.get(lid, (Decimal("0"), Decimal("0")))
            sold += lsold
            paid += lpaid
        unpaid = sold - paid
        source_items.append(
            SourceAnalyticsItem(
                source=src,
                leads_count=cnt,
                sold_amount=sold,
                paid_amount=paid,
                unpaid_amount=unpaid,
                lead_share_pct=_safe_pct(float(cnt), float(total_leads)),
            )
        )

    # Возрастные категории по визитам онлайн-записи (дата рождения ребёнка).
    age_filters = [
        BookingAppointment.company_id == company_id,
        BookingAppointment.start_at >= start,
        BookingAppointment.start_at < end,
    ]
    if pipeline_id is not None:
        age_filters.append(BookingAppointment.pipeline_id == pipeline_id)
    age_rows = (
        await db.execute(
            select(BookingAppointment.patient_birth_date, BookingAppointment.start_at).where(*age_filters)
        )
    ).all()
    age_counts: dict[str, int] = {k: 0 for k in _AGE_CATEGORY_ORDER}
    for birth, start_at in age_rows:
        if start_at is None:
            on_day = date.today()
        elif getattr(start_at, "tzinfo", None) is not None:
            on_day = start_at.astimezone(UTC).date()
        else:
            on_day = start_at.date()
        label = _age_category_label(birth, on_day)
        age_counts[label] = age_counts.get(label, 0) + 1
    age_total = sum(age_counts.values())
    age_items = [
        AgeCategoryAnalyticsItem(
            category=cat,
            visits_count=cnt,
            share_pct=_safe_pct(float(cnt), float(age_total)),
        )
        for cat in _AGE_CATEGORY_ORDER
        if (cnt := age_counts.get(cat, 0)) > 0
    ]

    # loss reasons
    loss_total = sum(loss_reasons.values())
    loss_items = [
        LossReasonItem(reason=reason, count=count, share_pct=_safe_pct(float(count), float(loss_total)))
        for reason, count in sorted(loss_reasons.items(), key=lambda x: x[1], reverse=True)
    ]

    # plan vs fact by manager
    manager_name_rows = (
        await db.execute(select(User.id, User.full_name, User.email).where(User.id.in_(manager_ids) if manager_ids else User.id == -1))
    ).all()
    manager_name_map = {
        int(uid): (str(full_name or "").strip() or str(email or "").strip() or "Без менеджера")
        for uid, full_name, email in manager_name_rows
    }

    start_month = datetime(start.year, start.month, 1).date()
    end_marker = end - timedelta(days=1)
    end_month = datetime(end_marker.year, end_marker.month, 1).date()
    plan_rows = (
        await db.execute(
            select(SalesKpiPlan.manager_user_id, func.coalesce(func.sum(SalesKpiPlan.plan_amount), 0))
            .where(
                SalesKpiPlan.company_id == company_id,
                SalesKpiPlan.year_month >= start_month,
                SalesKpiPlan.year_month <= end_month,
            )
            .group_by(SalesKpiPlan.manager_user_id)
        )
    ).all()
    plan_map: dict[int, Decimal] = {int(mid): Decimal(str(amount or 0)) for mid, amount in plan_rows if mid is not None}

    visit_mgr = func.coalesce(BookingAppointment.responsible_manager_id, Lead.manager_id)
    fact_filters = [
        BookingAppointment.company_id == company_id,
        BookingAppointment.start_at >= start,
        BookingAppointment.start_at < end,
    ]
    if pipeline_id is not None:
        fact_filters.append(BookingAppointment.pipeline_id == pipeline_id)
    fact_rows = (
        await db.execute(
            select(visit_mgr, func.coalesce(func.sum(BookingAppointment.paid_amount), 0))
            .select_from(BookingAppointment)
            .join(Lead, Lead.id == BookingAppointment.lead_id, isouter=True)
            .where(*fact_filters)
            .group_by(visit_mgr)
        )
    ).all()
    fact_map: dict[int, Decimal] = {int(mid): Decimal(str(amount or 0)) for mid, amount in fact_rows if mid is not None}
    course_fact_q = (
        select(SalesKpiManualSale.manager_user_id, func.coalesce(func.sum(SalesKpiManualSalePayment.amount), 0))
        .join(SalesKpiManualSale, SalesKpiManualSale.id == SalesKpiManualSalePayment.sale_id)
        .where(
            SalesKpiManualSalePayment.company_id == company_id,
            SalesKpiManualSalePayment.paid_at >= start,
            SalesKpiManualSalePayment.paid_at < end,
            SalesKpiManualSale.pipeline_id == pipeline_id if pipeline_id is not None else True,
        )
        .group_by(SalesKpiManualSale.manager_user_id)
    )
    for mid, amount in (await db.execute(course_fact_q)).all():
        if mid is None:
            continue
        fact_map[int(mid)] = fact_map.get(int(mid), Decimal("0")) + Decimal(str(amount or 0))

    need_names = (set(plan_map) | set(fact_map)) - set(manager_name_map)
    if need_names:
        extra_rows = (
            await db.execute(select(User.id, User.full_name, User.email).where(User.id.in_(need_names)))
        ).all()
        for uid, full_name, email in extra_rows:
            manager_name_map[int(uid)] = (
                str(full_name or "").strip() or str(email or "").strip() or f"Менеджер #{uid}"
            )

    manager_ids_all = sorted(set(plan_map.keys()) | set(fact_map.keys()))
    manager_plan_fact: list[ManagerPlanFactItem] = []
    for mid in manager_ids_all:
        plan = plan_map.get(mid, Decimal("0"))
        fact = fact_map.get(mid, Decimal("0"))
        manager_plan_fact.append(
            ManagerPlanFactItem(
                manager_id=mid,
                manager_name=manager_name_map.get(mid, f"Менеджер #{mid}"),
                plan_amount=plan,
                fact_paid_amount=fact,
                plan_completion_pct=_safe_pct(float(fact), float(plan)),
            )
        )

    # response SLA & cycle time from audits
    cycle_hours: list[float] = []
    lead_created_map = {int(row[0]): row[5] for row in leads}
    lead_manager_map = {int(row[0]): (int(row[4]) if row[4] is not None else None) for row in leads}
    leads_by_mgr: dict[int | None, int] = {}
    for row in leads:
        mid = int(row[4]) if row[4] is not None else None
        leads_by_mgr[mid] = leads_by_mgr.get(mid, 0) + 1
    for lid, events in events_by_lead.items():
        created_at = lead_created_map.get(lid)
        if created_at is None:
            continue
        for ts, details in sorted(events, key=lambda x: x[0]):
            match = _STAGE_CHANGE_RE.search(details or "")
            if match is None:
                continue
            to_name = match.group(2).strip()
            if to_name in {"Удачно", "Отказ"} and ts >= created_at:
                cycle_hours.append((ts - created_at).total_seconds() / 3600.0)
                break

    reply_filters = [
        Lead.company_id == company_id,
        _lead_in_period(start, end),
        ChatMessage.created_at >= start,
        ChatMessage.created_at < end,
    ]
    if pipeline_id is not None:
        reply_filters.append(PipelineStage.pipeline_id == pipeline_id)
    inbound_first = (
        await db.execute(
            select(Lead.id, Lead.manager_id, func.min(ChatMessage.created_at))
            .select_from(ChatMessage)
            .join(ChatThread, ChatThread.id == ChatMessage.thread_id)
            .join(Lead, Lead.id == ChatThread.lead_id)
            .join(PipelineStage, PipelineStage.id == Lead.status_id, isouter=True)
            .where(*reply_filters, ChatMessage.direction == "in")
            .group_by(Lead.id, Lead.manager_id)
        )
    ).all()
    outbound_first = (
        await db.execute(
            select(Lead.id, func.min(ChatMessage.created_at))
            .select_from(ChatMessage)
            .join(ChatThread, ChatThread.id == ChatMessage.thread_id)
            .join(Lead, Lead.id == ChatThread.lead_id)
            .join(PipelineStage, PipelineStage.id == Lead.status_id, isouter=True)
            .where(
                *reply_filters,
                ChatMessage.direction == "out",
                Lead.manager_id.is_not(None),
                ChatMessage.author_user_id == Lead.manager_id,
            )
            .group_by(Lead.id)
        )
    ).all()
    out_at = {int(lid): ts for lid, ts in outbound_first}
    first_resp_min: list[float] = []
    first_resp_by_mgr: dict[int | None, list[float]] = {}
    for lid, manager_id, in_at in inbound_first:
        out_ts = out_at.get(int(lid))
        if out_ts is None or in_at is None or out_ts < in_at:
            continue
        minutes = (out_ts - in_at).total_seconds() / 60.0
        first_resp_min.append(minutes)
        mid = int(manager_id) if manager_id is not None else None
        first_resp_by_mgr.setdefault(mid, []).append(minutes)

    avg_first_response = round(sum(first_resp_min) / len(first_resp_min), 2) if first_resp_min else None
    avg_cycle = round(sum(cycle_hours) / len(cycle_hours), 2) if cycle_hours else None
    won_leads = int(counts_by_name.get("Удачно", 0))
    win_rate = _safe_pct(float(won_leads), float(total_leads)) if total_leads else 0.0

    messaged_map, replied_map = await _manager_message_reply_counts(
        db, company_id=company_id, start=start, end=end, pipeline_id=pipeline_id
    )
    won_by_mgr = await _won_counts_by_manager(
        db, company_id=company_id, start=start, end=end, pipeline_id=pipeline_id
    )
    outbound_map = await _outbound_message_counts(
        db, company_id=company_id, start=start, end=end, pipeline_id=pipeline_id
    )

    perf_ids = (
        set(leads_by_mgr.keys())
        | set(plan_map.keys())
        | set(fact_map.keys())
        | set(messaged_map.keys())
        | set(replied_map.keys())
        | set(won_by_mgr.keys())
        | {mid for mid in outbound_map.keys()}
    )
    missing_name_ids = {mid for mid in perf_ids if mid is not None and mid not in manager_name_map}
    if missing_name_ids:
        extra_names = (
            await db.execute(
                select(User.id, User.full_name, User.email).where(User.id.in_(missing_name_ids))
            )
        ).all()
        for uid, full_name, email in extra_names:
            manager_name_map[int(uid)] = (
                str(full_name or "").strip() or str(email or "").strip() or f"Менеджер #{uid}"
            )
    manager_performance: list[ManagerPerformanceItem] = []
    for mid in sorted(perf_ids, key=lambda x: (x is None, x or 0)):
        leads_n = leads_by_mgr.get(mid, 0)
        won_n = won_by_mgr.get(mid, 0)
        messaged = messaged_map.get(mid, 0)
        replied = replied_map.get(mid, 0)
        reply_pct = _safe_pct(float(replied), float(messaged))
        win_pct = _safe_pct(float(won_n), float(leads_n))
        plan_pct = next((x.plan_completion_pct for x in manager_plan_fact if x.manager_id == mid), 0.0)
        has_plan = any(x.manager_id == mid and x.plan_amount > 0 for x in manager_plan_fact)
        sla_min = _avg_or_none(first_resp_by_mgr.get(mid, []))
        outbound = outbound_map.get(mid, 0) if mid is not None else 0
        name = (
            manager_name_map.get(mid, "Без менеджера")
            if mid is not None
            else "Без менеджера"
        )
        if mid is not None and mid not in manager_name_map:
            name = f"Менеджер #{mid}"
        manager_performance.append(
            ManagerPerformanceItem(
                manager_id=mid,
                manager_name=name,
                leads_count=leads_n,
                won_leads=won_n,
                win_rate_pct=win_pct,
                plan_completion_pct=plan_pct,
                clients_messaged_count=messaged,
                manager_replied_count=replied,
                reply_rate_pct=reply_pct,
                outbound_messages_count=outbound,
                avg_first_response_minutes=sla_min,
                performance_score=_performance_score(
                    plan_pct=plan_pct,
                    win_pct=win_pct,
                    reply_pct=reply_pct,
                    sla_minutes=sla_min,
                    has_plan=has_plan,
                ),
                activity_score=_activity_score(reply_pct=reply_pct, outbound=outbound, messaged=messaged),
            )
        )
    manager_performance.sort(key=lambda x: (-x.performance_score, x.manager_name))

    scored = [
        x.performance_score
        for x in manager_performance
        if x.manager_id is not None and (x.leads_count > 0 or x.clients_messaged_count > 0)
    ]
    performance_avg = round(sum(scored) / len(scored), 1) if scored else None
    team_messaged = sum(x.clients_messaged_count for x in manager_performance)
    team_replied = sum(x.manager_replied_count for x in manager_performance)
    team_reply_rate = _safe_pct(float(team_replied), float(team_messaged)) if team_messaged else None

    unpaid_share = _safe_pct(float(unpaid_total), float(paid_total + unpaid_total))
    avg_stage_conv = 0.0
    conv_values = [x.conversion_to_next_pct for x in stage_items if x.conversion_to_next_pct is not None]
    if conv_values:
        avg_stage_conv = round(sum(conv_values) / len(conv_values), 2)
    alerts_list: list[str] = []
    low_first_response = avg_first_response is not None and avg_first_response > 30
    high_unpaid_share = unpaid_share > 35
    low_stage_conversion = avg_stage_conv > 0 and avg_stage_conv < 20
    if low_first_response:
        alerts_list.append("Среднее время ответа в чате выше 30 минут")
    if high_unpaid_share:
        alerts_list.append("Доля неоплаченного объема выше 35%")
    if low_stage_conversion:
        alerts_list.append("Средняя конверсия между стадиями ниже 20%")
    if performance_avg is not None and performance_avg < 40:
        alerts_list.append("Средняя успеваемость менеджеров ниже 40 баллов")
    if team_reply_rate is not None and team_messaged > 0 and team_reply_rate < 50:
        alerts_list.append("Команда отвечает меньше чем на 50% входящих диалогов")

    tz = _biz_tz()
    return AnalyticsOverviewRead(
        period_start=start.astimezone(tz).strftime("%Y-%m-%d %H:%M"),
        period_end=end.astimezone(tz).strftime("%Y-%m-%d %H:%M"),
        executive=ExecutiveKpiRead(
            leads_total=total_leads,
            won_leads=won_leads,
            win_rate_pct=win_rate,
            paid_amount=paid_total,
            unpaid_amount=unpaid_total,
            avg_first_response_minutes=avg_first_response,
            avg_lead_cycle_hours=avg_cycle,
            performance_score_avg=performance_avg,
            activity_reply_rate_pct=team_reply_rate,
        ),
        stage_conversion=stage_items,
        by_source=source_items,
        by_age_category=age_items,
        loss_reasons=loss_items,
        manager_plan_fact=manager_plan_fact,
        manager_performance=manager_performance,
        alerts=AnalyticsAlertsRead(
            low_first_response=low_first_response,
            high_unpaid_share=high_unpaid_share,
            low_stage_conversion=low_stage_conversion,
            summary=alerts_list,
        ),
    )


@router.get("/customer-value/{customer_id}", response_model=CustomerValueRead)
async def analytics_customer_value(
    customer_id: int,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentUser,
    company_id: CurrentCompanyId,
) -> CustomerValueRead:
    """Legacy: sum(service_amount) визитов. Не Paid LTV — см. /analytics/ltv/patient/{id}."""
    _assert_owner(current_user)
    total = await db.scalar(
        select(func.coalesce(func.sum(BookingAppointment.service_amount), 0)).where(
            BookingAppointment.company_id == company_id,
            BookingAppointment.lead_id == customer_id,
        ),
    )
    total = total if total is not None else Decimal("0")
    return CustomerValueRead(customer_id=customer_id, value=Decimal(str(total)))


@router.post("/ltv/sync")
async def analytics_ltv_sync(
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentUser,
    company_id: CurrentCompanyId,
) -> dict:
    """Идемпотентный sync Purchase/Payment ledger + journey (Phase 1–4). Owner only."""
    _assert_owner(current_user)
    from app.services.patient_ltv import sync_company_purchases
    from app.services.patient_journey import sync_journey_for_lead
    from app.models import PatientPurchase

    stats = await sync_company_purchases(db, company_id)
    lead_ids = (
        await db.execute(
            select(PatientPurchase.lead_id)
            .where(
                PatientPurchase.company_id == company_id,
                PatientPurchase.lead_id.is_not(None),
            )
            .distinct(),
        )
    ).scalars().all()
    journey_n = 0
    for lid in lead_ids:
        if lid is None:
            continue
        await sync_journey_for_lead(db, company_id=company_id, lead_id=int(lid))
        journey_n += 1
    await db.commit()
    return {"ok": True, **stats, "journeys_synced": journey_n}


@router.get("/ltv/cohort")
async def analytics_ltv_cohort(
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentUser,
    company_id: CurrentCompanyId,
    date_from: str = Query(..., description="YYYY-MM-DD cohort start"),
    date_to: str = Query(..., description="YYYY-MM-DD cohort end exclusive-ish calendar"),
) -> dict:
    """Cohort LTV по first_purchase_at (не revenue выбранного месяца)."""
    _assert_owner(current_user)
    from zoneinfo import ZoneInfo

    from app.config import settings
    from app.services.patient_ltv_analytics import build_ltv_cohort_report

    try:
        d0 = datetime.strptime(date_from, "%Y-%m-%d").date()
        d1 = datetime.strptime(date_to, "%Y-%m-%d").date()
    except ValueError as e:
        raise HTTPException(status_code=400, detail="date_from/date_to: YYYY-MM-DD") from e
    tz = ZoneInfo(settings.booking_timezone or "Asia/Dushanbe")
    start = datetime.combine(d0, datetime.min.time(), tzinfo=tz).astimezone(UTC)
    end = datetime.combine(d1, datetime.min.time(), tzinfo=tz).astimezone(UTC) + timedelta(days=1)
    return await build_ltv_cohort_report(db, company_id=company_id, cohort_from=start, cohort_to=end)


@router.get("/ltv/patient/{lead_id}")
async def analytics_ltv_patient(
    lead_id: int,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentUser,
    company_id: CurrentCompanyId,
) -> dict:
    """Paid LTV / Sales Value / outstanding по Lead (backend formula)."""
    _assert_owner(current_user)
    lead = await db.get(Lead, lead_id)
    if lead is None or lead.company_id != company_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Lead not found")
    from app.services.patient_ltv import load_lead_ltv, normalize_payment_row
    from app.services.patient_journey import sync_journey_for_lead
    from app.models import PatientJourney, PatientJourneyEpisode, PatientPurchase, PatientPurchasePayment

    await sync_journey_for_lead(db, company_id=company_id, lead_id=lead_id)
    snap = await load_lead_ltv(db, company_id=company_id, lead_id=lead_id)
    journey = (
        await db.execute(
            select(PatientJourney).where(
                PatientJourney.company_id == company_id,
                PatientJourney.lead_id == lead_id,
            ),
        )
    ).scalar_one_or_none()
    episodes = (
        await db.execute(
            select(PatientJourneyEpisode)
            .where(
                PatientJourneyEpisode.company_id == company_id,
                PatientJourneyEpisode.lead_id == lead_id,
            )
            .order_by(PatientJourneyEpisode.kind.asc(), PatientJourneyEpisode.sequence_no.asc()),
        )
    ).scalars().all()
    purchases = (
        await db.execute(
            select(PatientPurchase)
            .where(
                PatientPurchase.company_id == company_id,
                PatientPurchase.lead_id == lead_id,
            )
            .order_by(PatientPurchase.purchased_at.asc()),
        )
    ).scalars().all()
    purchase_ids = [int(p.id) for p in purchases]
    payments: list[PatientPurchasePayment] = []
    if purchase_ids:
        payments = (
            await db.execute(
                select(PatientPurchasePayment)
                .where(PatientPurchasePayment.purchase_id.in_(purchase_ids))
                .order_by(PatientPurchasePayment.paid_at.asc()),
            )
        ).scalars().all()
    return {
        "lead_id": snap.lead_id,
        "purchase_count": snap.purchase_count,
        "paid_ltv": snap.paid_ltv,
        "sales_value": snap.sales_value,
        "outstanding": snap.outstanding,
        "operational_debt": snap.operational_debt,
        "refunds_total": snap.refunds_total,
        "first_purchase_at": snap.first_purchase_at,
        "last_purchase_at": snap.last_purchase_at,
        "lifetime_days": snap.lifetime_days,
        "journey": {
            "course_15_status": journey.course_15_status if journey else "none",
            "course_15_completed_at": journey.course_15_completed_at if journey else None,
            "master_class_at": journey.master_class_at if journey else None,
            "branch": journey.branch if journey else "none",
            "branch_started_at": journey.branch_started_at if journey else None,
        },
        "episodes": [
            {
                "id": int(e.id),
                "kind": e.kind,
                "sequence_no": int(e.sequence_no),
                "status": e.status,
                "started_at": e.started_at,
                "purchase_id": e.purchase_id,
            }
            for e in episodes
        ],
        "purchases": [
            {
                "id": int(p.id),
                "source_type": p.source_type,
                "source_id": int(p.source_id),
                "product_kind": p.product_kind,
                "product_name": p.product_name,
                "service_amount": p.service_amount,
                "paid_amount": p.paid_amount,
                "status": p.status,
                "purchased_at": p.purchased_at,
            }
            for p in purchases
        ],
        "money_events": [
            {
                "id": int(pay.id),
                "purchase_id": int(pay.purchase_id),
                "source_type": pay.source_type,
                "source_id": int(pay.source_id),
                "amount": pay.amount,
                "is_refund": bool(pay.is_refund),
                "signed_amount": normalize_payment_row(pay).signed_amount,
                "event_type": normalize_payment_row(pay).event_type,
                "paid_at": pay.paid_at,
            }
            for pay in payments
        ],
    }


def _services_calendar_bounds(
    period: str,
    date_from: str | None,
    date_to: str | None,
) -> tuple[datetime, datetime, str | None, str | None]:
    """Календарные сутки в TZ клиники — для фильтра start_at записей."""
    tz = _biz_tz()
    now_local = datetime.now(tz)

    if period == "day":
        start_local = now_local.replace(hour=0, minute=0, second=0, microsecond=0)
        end_local = start_local + timedelta(days=1)
        d0 = start_local.date().isoformat()
        return start_local.astimezone(UTC), end_local.astimezone(UTC), d0, d0

    if period == "month":
        start_local = datetime(now_local.year, now_local.month, 1, tzinfo=tz)
        if now_local.month == 12:
            end_local = datetime(now_local.year + 1, 1, 1, tzinfo=tz)
        else:
            end_local = datetime(now_local.year, now_local.month + 1, 1, tzinfo=tz)
        last = (end_local - timedelta(days=1)).date().isoformat()
        return (
            start_local.astimezone(UTC),
            end_local.astimezone(UTC),
            start_local.date().isoformat(),
            last,
        )

    if period == "custom":
        if not date_from or not date_to:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Укажите даты начала и окончания периода",
            )
        try:
            d_from = datetime.strptime(date_from, "%Y-%m-%d").date()
            d_to = datetime.strptime(date_to, "%Y-%m-%d").date()
        except ValueError as e:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Неверный формат дат") from e
        if d_to < d_from:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Период задан неверно")
        start_local = datetime(d_from.year, d_from.month, d_from.day, tzinfo=tz)
        end_local = datetime(d_to.year, d_to.month, d_to.day, tzinfo=tz) + timedelta(days=1)
        return (
            start_local.astimezone(UTC),
            end_local.astimezone(UTC),
            d_from.isoformat(),
            d_to.isoformat(),
        )

    raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="period: day | month | custom")


@router.get("/services", response_model=ServicesAnalyticsRead)
async def analytics_services(
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentUser,
    company_id: CurrentCompanyId,
    period: str = Query("month"),
    date_from: str | None = Query(default=None),
    date_to: str | None = Query(default=None),
    pipeline_id: int = Query(..., ge=1),
) -> ServicesAnalyticsRead:
    """Аналитика по услугам: визиты записи + Курс/Протокол только из KPI (без визитов записи)."""
    _assert_owner(current_user)
    pipe = await db.get(Pipeline, pipeline_id)
    if pipe is None or pipe.company_id != company_id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Unknown pipeline_id")

    start, end, df, dt = _services_calendar_bounds(period, date_from, date_to)
    now = datetime.now(UTC)

    appt_rows = (
        await db.execute(
            select(
                BookingAppointment.specialist_id,
                BookingAppointment.service_amount,
                BookingAppointment.paid_amount,
                BookingAppointment.status,
                BookingAppointment.start_at,
                BookingSpecialist.full_name,
                BookingDirection.id,
                BookingDirection.name,
            )
            .join(BookingSpecialist, BookingSpecialist.id == BookingAppointment.specialist_id)
            .join(BookingDirection, BookingDirection.id == BookingAppointment.direction_id)
            .outerjoin(Lead, Lead.id == BookingAppointment.lead_id)
            .outerjoin(PipelineStage, PipelineStage.id == Lead.status_id)
            .where(
                BookingAppointment.company_id == company_id,
                BookingAppointment.start_at >= start,
                BookingAppointment.start_at < end,
                or_(
                    BookingAppointment.pipeline_id == pipeline_id,
                    PipelineStage.pipeline_id == pipeline_id,
                    BookingDirection.pipeline_id == pipeline_id,
                ),
            ),
        )
    ).all()

    expert_acc: dict[tuple[int, int], dict] = {}
    revenue_total = Decimal("0")
    creditor_total = Decimal("0")

    for sid_raw, sa_raw, pa_raw, status_raw, start_at, spec_name, dir_id, dir_name in appt_rows:
        # Курс / Протокол — пакеты KPI: визиты записи в эту аналитику не входят.
        if is_admin_only_booking_direction_name(str(dir_name) if dir_name else None):
            continue
        sid = int(sid_raw)
        did = int(dir_id) if dir_id is not None else 0
        sa = Decimal(str(sa_raw or 0))
        pa = Decimal(str(pa_raw or 0))
        st = (status_raw or "").strip()
        key = (sid, did)
        if key not in expert_acc:
            expert_acc[key] = {
                "specialist_id": sid,
                "specialist_name": str(spec_name or f"#{sid}"),
                "direction_id": did if did else None,
                "direction_name": str(dir_name) if dir_name else "—",
                "money_source": "booking",
                "appointments_total": 0,
                "appeared_count": 0,
                "booked_count": 0,
                "no_show_count": 0,
                "cancelled_count": 0,
                "revenue_paid": Decimal("0"),
                "paid_full_amount": Decimal("0"),
                "paid_no_show_amount": Decimal("0"),
                "debtor_amount": Decimal("0"),
                "creditor_amount": Decimal("0"),
            }
        bucket = expert_acc[key]
        if st == "cancelled":
            bucket["cancelled_count"] += 1
            continue
        bucket["appointments_total"] += 1
        if st == "no_show":
            bucket["no_show_count"] += 1
            if pa > 0:
                bucket["paid_no_show_amount"] += pa
                bucket["revenue_paid"] += pa
                revenue_total += pa
        else:
            bucket["revenue_paid"] += pa
            revenue_total += pa
            debt = max(sa - pa, Decimal("0"))
            if debt > 0:
                bucket["debtor_amount"] += debt
            if st == "completed":
                bucket["appeared_count"] += 1
                if sa <= 0 or pa + Decimal("0.01") >= sa:
                    bucket["paid_full_amount"] += pa
            elif st == "booked":
                bucket["booked_count"] += 1
                if start_at is not None and start_at.tzinfo is None:
                    start_at = start_at.replace(tzinfo=UTC)
                if start_at is not None and start_at > now and pa > 0:
                    bucket["creditor_amount"] += pa
                    creditor_total += pa

    # Дебиторка на конец периода: открытые визиты с start_at < end (без Курс/Протокол)
    open_debt_rows = (
        await db.execute(
            select(
                BookingAppointment.service_amount,
                BookingAppointment.paid_amount,
                BookingDirection.name,
            )
            .outerjoin(Lead, Lead.id == BookingAppointment.lead_id)
            .outerjoin(PipelineStage, PipelineStage.id == Lead.status_id)
            .outerjoin(BookingDirection, BookingDirection.id == BookingAppointment.direction_id)
            .where(
                BookingAppointment.company_id == company_id,
                BookingAppointment.start_at < end,
                BookingAppointment.service_amount > BookingAppointment.paid_amount,
                BookingAppointment.status.notin_(("no_show", "cancelled")),
                or_(
                    BookingAppointment.pipeline_id == pipeline_id,
                    PipelineStage.pipeline_id == pipeline_id,
                    BookingDirection.pipeline_id == pipeline_id,
                ),
            ),
        )
    ).all()
    debtor_total = Decimal("0")
    for sa_raw, pa_raw, dir_name in open_debt_rows:
        if is_admin_only_booking_direction_name(str(dir_name) if dir_name else None):
            continue
        debtor_total += max(Decimal(str(sa_raw or 0)) - Decimal(str(pa_raw or 0)), Decimal("0"))

    service_acc: dict[int, dict] = {}
    for row in expert_acc.values():
        did = int(row["direction_id"] or 0)
        if did not in service_acc:
            service_acc[did] = {
                "direction_id": row["direction_id"],
                "direction_name": str(row.get("direction_name") or "—"),
                "money_source": "booking",
                "appointments_total": 0,
                "appeared_count": 0,
                "no_show_count": 0,
                "booked_count": 0,
                "cancelled_count": 0,
                "revenue_paid": Decimal("0"),
                "paid_full_amount": Decimal("0"),
                "paid_no_show_amount": Decimal("0"),
                "debtor_amount": Decimal("0"),
                "creditor_amount": Decimal("0"),
            }
        s = service_acc[did]
        for k in (
            "appointments_total",
            "appeared_count",
            "no_show_count",
            "booked_count",
            "cancelled_count",
        ):
            s[k] += int(row[k])
        for k in (
            "revenue_paid",
            "paid_full_amount",
            "paid_no_show_amount",
            "debtor_amount",
            "creditor_amount",
        ):
            s[k] += Decimal(str(row[k]))

    # Оплаты курсов/протоколов KPI за период (по paid_at) — деньги в ту же таблицу услуг.
    kpi_pay_rows = (
        await db.execute(
            select(
                SalesKpiPlanItem.name,
                func.coalesce(func.sum(SalesKpiManualSalePayment.amount), 0),
            )
            .join(SalesKpiManualSale, SalesKpiManualSale.id == SalesKpiManualSalePayment.sale_id)
            .join(SalesKpiPlanItem, SalesKpiPlanItem.id == SalesKpiManualSale.plan_item_id)
            .where(
                SalesKpiManualSalePayment.company_id == company_id,
                SalesKpiManualSale.pipeline_id == pipeline_id,
                SalesKpiManualSalePayment.paid_at >= start,
                SalesKpiManualSalePayment.paid_at < end,
            )
            .group_by(SalesKpiPlanItem.name),
        )
    ).all()
    # Дебиторка KPI как во вкладке KPI: остаток active + через месяц после первой оплаты.
    manual_debt_sales = (
        await db.execute(
            select(SalesKpiManualSale, SalesKpiPlanItem.name)
            .join(SalesKpiPlanItem, SalesKpiPlanItem.id == SalesKpiManualSale.plan_item_id)
            .where(
                SalesKpiManualSale.company_id == company_id,
                SalesKpiManualSale.pipeline_id == pipeline_id,
                SalesKpiManualSale.sold_at < end,
                SalesKpiManualSale.status == "active",
                SalesKpiManualSale.service_amount > SalesKpiManualSale.paid_amount,
            ),
        )
    ).all()
    sale_ids = [int(s.id) for s, _ in manual_debt_sales]
    payments_by_sale: dict[int, list] = {i: [] for i in sale_ids}
    if sale_ids:
        pay_rows = (
            await db.execute(
                select(SalesKpiManualSalePayment)
                .where(SalesKpiManualSalePayment.sale_id.in_(sale_ids))
                .order_by(SalesKpiManualSalePayment.id.asc()),
            )
        ).scalars().all()
        for p in pay_rows:
            payments_by_sale.setdefault(int(p.sale_id), []).append(p)
    debt_cutoff = booking_debt_cutoff(end, now=now)
    kpi_debt_by_name: dict[str, Decimal] = {}
    kpi_debt_display: dict[str, str] = {}
    for sale, item_name in manual_debt_sales:
        first_at = first_course_payment_at(sale.sold_at, payments_by_sale.get(int(sale.id), []))
        if not course_debt_is_due(first_at, debt_cutoff):
            continue
        sa = Decimal(str(sale.service_amount or 0))
        pa = Decimal(str(sale.paid_amount or 0))
        debt = max(sa - pa, Decimal("0"))
        if debt <= 0:
            continue
        name = str(item_name or "").strip() or "Курс / протокол"
        key = name.casefold()
        kpi_debt_by_name[key] = kpi_debt_by_name.get(key, Decimal("0")) + debt
        kpi_debt_display[key] = name
    kpi_debt_rows = list(kpi_debt_by_name.items())
    kpi_course_paid_total = Decimal("0")
    # Индекс строк записи по имени направления (без регистра)
    by_name: dict[str, dict] = {}
    for row in service_acc.values():
        key = str(row.get("direction_name") or "").casefold()
        if key:
            by_name[key] = row

    next_kpi_key = -1
    for raw_name, amount_raw in kpi_pay_rows:
        name = str(raw_name or "").strip() or "Курс / протокол"
        paid = Decimal(str(amount_raw or 0))
        if paid <= 0:
            continue
        kpi_course_paid_total += paid
        key = name.casefold()
        debt = kpi_debt_by_name.get(key, Decimal("0"))
        # Курс/Протокол — только KPI-строка, без смешивания с визитами записи.
        force_kpi_only = is_admin_only_booking_direction_name(name)
        if key in by_name and not force_kpi_only:
            row = by_name[key]
            row["revenue_paid"] = Decimal(str(row["revenue_paid"])) + paid
            row["paid_full_amount"] = Decimal(str(row["paid_full_amount"])) + paid
            row["debtor_amount"] = Decimal(str(row["debtor_amount"])) + debt
            row["money_source"] = "mixed"
        else:
            if force_kpi_only and key in by_name:
                # на всякий случай не тащим старые счётчики записи
                by_name.pop(key, None)
            service_acc[next_kpi_key] = {
                "direction_id": None,
                "direction_name": name,
                "money_source": "kpi",
                "appointments_total": 0,
                "appeared_count": 0,
                "no_show_count": 0,
                "booked_count": 0,
                "cancelled_count": 0,
                "revenue_paid": paid,
                "paid_full_amount": paid,
                "paid_no_show_amount": Decimal("0"),
                "debtor_amount": debt,
                "creditor_amount": Decimal("0"),
            }
            by_name[key] = service_acc[next_kpi_key]
            next_kpi_key -= 1
        # долг уже учли при merge; убрать из map чтобы не дублировать при нулевых оплатах ниже
        kpi_debt_by_name.pop(key, None)

    # Дебиторка KPI без платежей в периоде — всё равно показать строку
    for key, debt in list(kpi_debt_by_name.items()):
        if debt <= 0:
            continue
        display = kpi_debt_display.get(key, key)
        force_kpi_only = is_admin_only_booking_direction_name(display)
        if key in by_name and not force_kpi_only:
            row = by_name[key]
            if row.get("money_source") == "booking":
                row["money_source"] = "mixed"
            row["debtor_amount"] = Decimal(str(row["debtor_amount"])) + debt
        else:
            service_acc[next_kpi_key] = {
                "direction_id": None,
                "direction_name": display,
                "money_source": "kpi",
                "appointments_total": 0,
                "appeared_count": 0,
                "no_show_count": 0,
                "booked_count": 0,
                "cancelled_count": 0,
                "revenue_paid": Decimal("0"),
                "paid_full_amount": Decimal("0"),
                "paid_no_show_amount": Decimal("0"),
                "debtor_amount": debt,
                "creditor_amount": Decimal("0"),
            }
            next_kpi_key -= 1

    revenue_total = revenue_total + kpi_course_paid_total
    debtor_total = debtor_total + sum(
        (Decimal(str(amount or 0)) for _, amount in kpi_debt_rows),
        Decimal("0"),
    )

    service_stats = [
        ServicesAnalyticsServiceRow(**row)
        for row in sorted(
            service_acc.values(),
            key=lambda x: (
                -float(x["revenue_paid"]),
                -int(x["appointments_total"]),
                str(x["direction_name"]),
            ),
        )
        if int(row["appointments_total"]) > 0
        or int(row["cancelled_count"]) > 0
        or Decimal(str(row["revenue_paid"])) > 0
        or Decimal(str(row["debtor_amount"])) > 0
    ]

    expert_roll: dict[int, dict] = {}
    for row in expert_acc.values():
        sid = int(row["specialist_id"])
        if sid not in expert_roll:
            expert_roll[sid] = {
                "specialist_id": sid,
                "specialist_name": row["specialist_name"],
                "kpi_service_name": None,
                "appointments_total": 0,
                "appeared_count": 0,
                "no_show_count": 0,
                "booked_count": 0,
                "cancelled_count": 0,
                "revenue_paid": Decimal("0"),
                "paid_full_amount": Decimal("0"),
                "paid_no_show_amount": Decimal("0"),
                "debtor_amount": Decimal("0"),
                "creditor_amount": Decimal("0"),
            }
        e = expert_roll[sid]
        for k in (
            "appointments_total",
            "appeared_count",
            "no_show_count",
            "booked_count",
            "cancelled_count",
        ):
            e[k] += int(row[k])
        for k in (
            "revenue_paid",
            "paid_full_amount",
            "paid_no_show_amount",
            "debtor_amount",
            "creditor_amount",
        ):
            e[k] += Decimal(str(row[k]))

    expert_stats = [
        ServicesAnalyticsExpertRow(**row)
        for row in sorted(
            expert_roll.values(),
            key=lambda x: (-int(x["appointments_total"]), str(x["specialist_name"])),
        )
    ]

    tz = _biz_tz()
    return ServicesAnalyticsRead(
        pipeline_id=pipe.id,
        pipeline_name=pipe.name,
        period=period,
        period_start=start.astimezone(tz).strftime("%Y-%m-%d %H:%M"),
        period_end=end.astimezone(tz).strftime("%Y-%m-%d %H:%M"),
        date_from=df,
        date_to=dt,
        revenue_total=revenue_total,
        debtor_total=debtor_total,
        creditor_total=creditor_total,
        kpi_course_paid_total=kpi_course_paid_total,
        service_stats=service_stats,
        expert_stats=expert_stats,
    )