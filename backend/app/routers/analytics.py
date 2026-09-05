from datetime import UTC, datetime, timedelta
from decimal import Decimal
from typing import Annotated
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import and_, case, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.core.deps import CurrentCompanyId, CurrentUser
from app.database import get_db
from app.models import BookingAppointment, ChatMessage, ChatThread, Lead, LeadAuditEvent, Pipeline, PipelineStage, SalesKpiPlan, User, UserPipelineAssignment, UserRole
from app.schemas.analytics import (
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
    SourceAnalyticsItem,
    StageConversionItem,
)

router = APIRouter(prefix="/analytics", tags=["analytics"])

WON_STAGE_NAMES = frozenset({"Удачно"})


def _biz_tz() -> ZoneInfo:
    try:
        return ZoneInfo(settings.booking_timezone or "Asia/Dushanbe")
    except Exception:
        return ZoneInfo("Asia/Dushanbe")


def _sla_score(minutes: float | None) -> float:
    if minutes is None:
        return 50.0
    if minutes <= 5:
        return 100.0
    if minutes >= 60:
        return 0.0
    return round(max(0.0, 100.0 - (minutes - 5.0) * (100.0 / 55.0)), 1)


def _performance_score(
    *,
    plan_pct: float,
    win_pct: float,
    reply_pct: float,
    sla_minutes: float | None,
    has_plan: bool,
) -> float:
    sla = _sla_score(sla_minutes)
    if has_plan:
        return round(0.35 * min(plan_pct, 100.0) + 0.30 * win_pct + 0.25 * reply_pct + 0.10 * sla, 1)
    return round(0.45 * win_pct + 0.40 * reply_pct + 0.15 * sla, 1)


def _activity_score(*, reply_pct: float, outbound: int, messaged: int) -> float:
    volume = min(100.0, (outbound * 8.0) + (messaged * 4.0))
    return round(0.65 * reply_pct + 0.35 * volume, 1)


def _period_bounds(period: str, date_from: str | None, date_to: str | None) -> tuple[datetime, datetime]:
    """Границы периода в UTC, но календарный день/месяц — по timezone компании (Душанбе)."""
    tz = _biz_tz()
    now_local = datetime.now(tz)
    if period == "day":
        start_local = datetime(now_local.year, now_local.month, now_local.day, tzinfo=tz)
        end_local = start_local + timedelta(days=1)
        return start_local.astimezone(UTC), end_local.astimezone(UTC)
    if period == "month":
        start_local = datetime(now_local.year, now_local.month, 1, tzinfo=tz)
        if now_local.month == 12:
            end_local = datetime(now_local.year + 1, 1, 1, tzinfo=tz)
        else:
            end_local = datetime(now_local.year, now_local.month + 1, 1, tzinfo=tz)
        return start_local.astimezone(UTC), end_local.astimezone(UTC)
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
        start_local = d_from.replace(tzinfo=tz)
        end_local = (d_to + timedelta(days=1)).replace(tzinfo=tz)
        if end_local <= start_local:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Период задан неверно")
        return start_local.astimezone(UTC), end_local.astimezone(UTC)
    raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="period: day | month | custom")


def _lead_in_period(start: datetime, end: datetime):
    """Лид «за период»: создан или реактивирован (раздача / возврат из Архива)."""
    return or_(
        and_(Lead.created_at >= start, Lead.created_at < end),
        and_(
            Lead.reactivated_at.is_not(None),
            Lead.reactivated_at >= start,
            Lead.reactivated_at < end,
        ),
    )


def _assert_owner(current_user: CurrentUser) -> None:
    if current_user.role != UserRole.owner:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Только владелец")


def _safe_pct(num: float, den: float) -> float:
    if den <= 0:
        return 0.0
    return round((num / den) * 100, 2)


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

    for lead_id, status_id, source, refusal_reason, manager_id, _created_at in leads:
        sid = int(status_id) if status_id is not None else -1
        stage_counts[sid] = stage_counts.get(sid, 0) + 1
        src = (source or "Не указан").strip() or "Не указан"
        source_counts[src] = source_counts.get(src, 0) + 1
        source_lead_ids.setdefault(src, []).append(int(lead_id))
        if refusal_reason and refusal_reason.strip():
            key = refusal_reason.strip()
            loss_reasons[key] = loss_reasons.get(key, 0) + 1
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
        paid_total += paid_dec
        unpaid_total += unpaid_dec
        prev_sold, prev_paid = lead_money.get(lid, (Decimal("0"), Decimal("0")))
        lead_money[lid] = (prev_sold + sold_dec, prev_paid + paid_dec)

    # stage conversion and time-in-stage
    stage_items: list[StageConversionItem] = []
    ordered_stage_ids = [int(sid) for sid, _, _ in stage_rows]
    status_events = (
        await db.execute(
            select(LeadAuditEvent.lead_id, LeadAuditEvent.created_at)
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
    event_buckets: dict[int, list[datetime]] = {}
    for lead_id, ts in status_events:
        lid = int(lead_id)
        if lid in lead_ids_set:
            event_buckets.setdefault(lid, []).append(ts)

    avg_stage_hours = None
    if event_buckets:
        durations: list[float] = []
        for lid, timestamps in event_buckets.items():
            created_at = next((row[5] for row in leads if int(row[0]) == lid), None)
            if created_at is None:
                continue
            prev = created_at
            for ts in timestamps:
                if ts > prev:
                    durations.append((ts - prev).total_seconds() / 3600.0)
                    prev = ts
        if durations:
            avg_stage_hours = round(sum(durations) / len(durations), 2)

    for idx, sid in enumerate(ordered_stage_ids):
        sname, sorder = stage_map.get(sid, ("Стадия", idx))
        cur_count = stage_counts.get(sid, 0)
        next_count = stage_counts.get(ordered_stage_ids[idx + 1], 0) if idx + 1 < len(ordered_stage_ids) else 0
        conv = _safe_pct(float(next_count), float(cur_count)) if idx + 1 < len(ordered_stage_ids) and cur_count else None
        stage_items.append(
            StageConversionItem(
                stage_id=sid,
                stage_name=sname,
                order=sorder,
                leads_count=cur_count,
                conversion_to_next_pct=conv,
                avg_time_in_stage_hours=avg_stage_hours,
            )
        )

    # source analytics
    source_items: list[SourceAnalyticsItem] = []
    for src, cnt in sorted(source_counts.items(), key=lambda x: x[1], reverse=True):
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

    fact_rows = (
        await db.execute(
            select(Lead.manager_id, func.coalesce(func.sum(BookingAppointment.paid_amount), 0))
            .join(BookingAppointment, BookingAppointment.lead_id == Lead.id)
            .join(PipelineStage, PipelineStage.id == Lead.status_id, isouter=True)
            .where(
                Lead.company_id == company_id,
                _lead_in_period(start, end),
                PipelineStage.pipeline_id == pipeline_id if pipeline_id is not None else True,
            )
            .group_by(Lead.manager_id)
        )
    ).all()
    fact_map: dict[int, Decimal] = {int(mid): Decimal(str(amount or 0)) for mid, amount in fact_rows if mid is not None}

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
    audit_rows = (
        await db.execute(
            select(LeadAuditEvent.lead_id, LeadAuditEvent.action, LeadAuditEvent.created_at)
            .select_from(LeadAuditEvent)
            .join(Lead, Lead.id == LeadAuditEvent.lead_id)
            .join(PipelineStage, PipelineStage.id == Lead.status_id, isouter=True)
            .where(
                LeadAuditEvent.company_id == company_id,
                Lead.company_id == company_id,
                _lead_in_period(start, end),
                PipelineStage.pipeline_id == pipeline_id if pipeline_id is not None else True,
            )
            .order_by(LeadAuditEvent.created_at.asc())
        )
    ).all()
    first_resp_min: list[float] = []
    first_resp_by_mgr: dict[int | None, list[float]] = {}
    cycle_hours: list[float] = []
    lead_created_map = {int(row[0]): row[5] for row in leads}
    lead_manager_map = {int(row[0]): (int(row[4]) if row[4] is not None else None) for row in leads}
    leads_by_mgr: dict[int | None, int] = {}
    for row in leads:
        mid = int(row[4]) if row[4] is not None else None
        leads_by_mgr[mid] = leads_by_mgr.get(mid, 0) + 1
    first_opened: dict[int, datetime] = {}
    first_closed: dict[int, datetime] = {}
    closed_actions = {"integration_deal_closed", "protocol_finished", "lead_rejected", "service_rejected"}
    for lead_id, action, created_at in audit_rows:
        lid = int(lead_id)
        if lid not in lead_created_map:
            continue
        if action == "card_opened" and lid not in first_opened:
            first_opened[lid] = created_at
        if action in closed_actions and lid not in first_closed:
            first_closed[lid] = created_at
    for lid, opened_at in first_opened.items():
        created_at = lead_created_map.get(lid)
        if created_at and opened_at >= created_at:
            minutes = (opened_at - created_at).total_seconds() / 60.0
            first_resp_min.append(minutes)
            first_resp_by_mgr.setdefault(lead_manager_map.get(lid), []).append(minutes)
    for lid, closed_at in first_closed.items():
        created_at = lead_created_map.get(lid)
        if created_at and closed_at >= created_at:
            cycle_hours.append((closed_at - created_at).total_seconds() / 3600.0)

    avg_first_response = round(sum(first_resp_min) / len(first_resp_min), 2) if first_resp_min else None
    avg_cycle = round(sum(cycle_hours) / len(cycle_hours), 2) if cycle_hours else None
    won_leads = len([1 for _lid, action, _ts in audit_rows if action in {"integration_deal_closed", "protocol_finished"}])
    win_rate = _safe_pct(float(won_leads), float(total_leads))

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

    scored = [x.performance_score for x in manager_performance if x.manager_id is not None]
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
        alerts_list.append("Среднее время первого ответа выше 30 минут")
    if high_unpaid_share:
        alerts_list.append("Доля неоплаченного объема выше 35%")
    if low_stage_conversion:
        alerts_list.append("Средняя конверсия между стадиями ниже 20%")
    if performance_avg is not None and performance_avg < 40:
        alerts_list.append("Средняя успеваемость менеджеров ниже 40 баллов")
    if team_reply_rate is not None and team_messaged > 0 and team_reply_rate < 50:
        alerts_list.append("Команда отвечает меньше чем на 50% входящих диалогов")

    return AnalyticsOverviewRead(
        period_start=start.date().isoformat(),
        period_end=(end - timedelta(days=1)).date().isoformat(),
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
    _assert_owner(current_user)
    total = await db.scalar(
        select(func.coalesce(func.sum(BookingAppointment.service_amount), 0)).where(
            BookingAppointment.company_id == company_id,
            BookingAppointment.lead_id == customer_id,
        ),
    )
    total = total if total is not None else Decimal("0")
    return CustomerValueRead(customer_id=customer_id, value=Decimal(str(total)))
