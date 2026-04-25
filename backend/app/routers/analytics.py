from datetime import UTC, datetime, timedelta
from decimal import Decimal
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import and_, case, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import CurrentCompanyId, CurrentUser
from app.database import get_db
from app.models import BookingAppointment, Lead, LeadAuditEvent, Pipeline, PipelineStage, SalesKpiPlan, User, UserRole
from app.schemas.analytics import (
    AnalyticsAlertsRead,
    AnalyticsOverviewRead,
    CustomerValueRead,
    DetailedAnalyticsRead,
    ExecutiveKpiRead,
    FullAnalyticsRead,
    LossReasonItem,
    ManagerDetailedAnalyticsItem,
    ManagerPlanFactItem,
    PipelineFullAnalyticsItem,
    SourceAnalyticsItem,
    StageConversionItem,
)

router = APIRouter(prefix="/analytics", tags=["analytics"])


def _period_bounds(period: str, date_from: str | None, date_to: str | None) -> tuple[datetime, datetime]:
    now = datetime.now(UTC)
    if period == "day":
        start = datetime(now.year, now.month, now.day, tzinfo=UTC)
        return start, start + timedelta(days=1)
    if period == "month":
        start = datetime(now.year, now.month, 1, tzinfo=UTC)
        if now.month == 12:
            end = datetime(now.year + 1, 1, 1, tzinfo=UTC)
        else:
            end = datetime(now.year, now.month + 1, 1, tzinfo=UTC)
        return start, end
    if period == "custom":
        if not date_from or not date_to:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Укажите date_from и date_to")
        try:
            d_from = datetime.strptime(date_from, "%Y-%m-%d")
            d_to = datetime.strptime(date_to, "%Y-%m-%d")
        except ValueError:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Неверный формат дат")
        start = d_from.replace(tzinfo=UTC)
        end = (d_to + timedelta(days=1)).replace(tzinfo=UTC)
        if end <= start:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Период задан неверно")
        return start, end
    raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="period: day | month | custom")


def _assert_owner(current_user: CurrentUser) -> None:
    if current_user.role != UserRole.owner:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Только владелец")


def _safe_pct(num: float, den: float) -> float:
    if den <= 0:
        return 0.0
    return round((num / den) * 100, 2)


@router.get("/full", response_model=FullAnalyticsRead)
async def analytics_full(
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentUser,
    company_id: CurrentCompanyId,
    period: str = Query("day"),
    date_from: str | None = Query(default=None),
    date_to: str | None = Query(default=None),
) -> FullAnalyticsRead:
    _assert_owner(current_user)
    start, end = _period_bounds(period, date_from, date_to)

    total_leads = int(
        await db.scalar(
            select(func.count(Lead.id)).where(
                Lead.company_id == company_id,
                Lead.created_at >= start,
                Lead.created_at < end,
            ),
        )
        or 0
    )

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
                Lead.created_at >= start,
                Lead.created_at < end,
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
) -> DetailedAnalyticsRead:
    _assert_owner(current_user)
    start, end = _period_bounds(period, date_from, date_to)

    total_leads = int(
        await db.scalar(
            select(func.count(Lead.id)).where(
                Lead.company_id == company_id,
                Lead.created_at >= start,
                Lead.created_at < end,
            ),
        )
        or 0
    )

    rows = (
        await db.execute(
            select(
                User.id,
                User.full_name,
                User.email,
                func.count(func.distinct(Lead.id)),
                func.coalesce(func.sum(BookingAppointment.service_amount), 0),
                func.coalesce(func.sum(BookingAppointment.service_amount - BookingAppointment.paid_amount), 0),
            )
            .select_from(Lead)
            .join(User, User.id == Lead.manager_id, isouter=True)
            .join(
                BookingAppointment,
                (BookingAppointment.lead_id == Lead.id) & (BookingAppointment.company_id == company_id),
                isouter=True,
            )
            .where(
                Lead.company_id == company_id,
                Lead.created_at >= start,
                Lead.created_at < end,
            )
            .group_by(User.id, User.full_name, User.email)
            .order_by(User.full_name.asc().nulls_last(), User.email.asc().nulls_last()),
        )
    ).all()

    by_manager: list[ManagerDetailedAnalyticsItem] = []
    total_sold = Decimal("0")
    total_unpaid = Decimal("0")
    for uid, full_name, email, leads_count, sold, unpaid in rows:
        sold_dec = Decimal(str(sold or 0))
        unpaid_dec = Decimal(str(unpaid or 0))
        total_sold += sold_dec
        total_unpaid += unpaid_dec
        by_manager.append(
            ManagerDetailedAnalyticsItem(
                manager_id=uid,
                manager_name=(full_name or email or "Без менеджера"),
                leads_count=int(leads_count or 0),
                sold_amount=sold_dec,
                unpaid_amount=unpaid_dec,
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
) -> AnalyticsOverviewRead:
    _assert_owner(current_user)
    start, end = _period_bounds(period, date_from, date_to)

    leads = (
        await db.execute(
            select(Lead.id, Lead.status_id, Lead.source, Lead.refusal_reason, Lead.manager_id, Lead.created_at).where(
                Lead.company_id == company_id,
                Lead.created_at >= start,
                Lead.created_at < end,
            )
        )
    ).all()
    lead_ids = [int(row[0]) for row in leads]
    lead_ids_set = set(lead_ids)
    total_leads = len(lead_ids)

    stage_rows = (
        await db.execute(
            select(PipelineStage.id, PipelineStage.name, PipelineStage.order)
            .where(PipelineStage.company_id == company_id)
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
            .where(
                BookingAppointment.company_id == company_id,
                Lead.company_id == company_id,
                Lead.created_at >= start,
                Lead.created_at < end,
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
            .where(
                LeadAuditEvent.company_id == company_id,
                LeadAuditEvent.action == "status_changed",
                Lead.company_id == company_id,
                Lead.created_at >= start,
                Lead.created_at < end,
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
            .where(
                Lead.company_id == company_id,
                Lead.created_at >= start,
                Lead.created_at < end,
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
            .where(
                LeadAuditEvent.company_id == company_id,
                Lead.company_id == company_id,
                Lead.created_at >= start,
                Lead.created_at < end,
            )
            .order_by(LeadAuditEvent.created_at.asc())
        )
    ).all()
    first_resp_min: list[float] = []
    cycle_hours: list[float] = []
    lead_created_map = {int(row[0]): row[5] for row in leads}
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
            first_resp_min.append((opened_at - created_at).total_seconds() / 60.0)
    for lid, closed_at in first_closed.items():
        created_at = lead_created_map.get(lid)
        if created_at and closed_at >= created_at:
            cycle_hours.append((closed_at - created_at).total_seconds() / 3600.0)

    avg_first_response = round(sum(first_resp_min) / len(first_resp_min), 2) if first_resp_min else None
    avg_cycle = round(sum(cycle_hours) / len(cycle_hours), 2) if cycle_hours else None
    won_leads = len([1 for _lid, action, _ts in audit_rows if action in {"integration_deal_closed", "protocol_finished"}])
    win_rate = _safe_pct(float(won_leads), float(total_leads))

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
        ),
        stage_conversion=stage_items,
        by_source=source_items,
        loss_reasons=loss_items,
        manager_plan_fact=manager_plan_fact,
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
