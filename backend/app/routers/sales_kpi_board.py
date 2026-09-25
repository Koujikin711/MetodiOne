"""Взвешенный KPI: план владельца, отчёт ПРОДАЖИ, курсы/протоколы, дебиторка."""

from __future__ import annotations

import asyncio
from datetime import UTC, date, datetime
from decimal import Decimal
import calendar
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import and_, delete, exists, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import CurrentCompanyId, CurrentUser
from app.database import AsyncSessionLocal, get_db
from app.models import (
    BookingAppointment,
    BookingDirection,
    BookingSpecialist,
    FinanceOsvRow,
    Lead,
    ManagerDeskSale,
    Pipeline,
    PipelineStage,
    SalesKpiManualSale,
    SalesKpiManualSalePayment,
    SalesKpiPlanItem,
    SalesKpiPlanItemSpecialist,
    SalesKpiServicePrice,
    SalesKpiWeightedSettings,
    User,
    UserPipelineAssignment,
    UserRole,
)
from app.services.crm_space import company_is_sales_mode
from app.schemas.sales_kpi import (
    SalesKpiBoardLine,
    SalesKpiBoardManager,
    SalesKpiCompanyExpertStat,
    SalesKpiCompanyPlanLine,
    SalesKpiCompanyReport,
    SalesKpiCompanyServiceStat,
    SalesKpiDebtorRow,
    SalesKpiDebtorsReport,
    SalesKpiDirectionMeta,
    SalesKpiManualSaleCreate,
    SalesKpiManualSaleLinkLeadPatch,
    SalesKpiManualSaleOut,
    SalesKpiManualSalePaymentOut,
    SalesKpiManualSalePaymentPatch,
    SalesKpiManualPaymentJournalRow,
    SalesKpiManualSaleSoldAtPatch,
    SalesKpiManualSaleStatusPatch,
    SalesKpiPlanItemOut,
    SalesKpiLeadSearchItem,
    SalesKpiLeadSearchOut,
    SalesKpiSalesReport,
    SalesKpiSpecialistMeta,
    SalesKpiWeightedPlanOut,
    SalesKpiWeightedPlanPut,
)
from app.services.sales_kpi_weighted import (
    MANUAL_SALE_MIN_PAID_RATIO,
    _norm_kpi_label,
    build_manager_lines,
    completion_ratio,
    contribution,
    ensure_plan_carried_forward,
    load_bonus_fund,
    load_desk_sale_facts_full_paid,
    load_direction_facts_full_paid,
    load_kpi_unit_prices_by_label,
    load_managers,
    load_manual_facts,
    load_plan_item_specialists,
    load_plan_items,
    load_specialist_facts_company_full_paid,
    load_specialist_facts_full_paid,
    month_bounds,
    paid_at_from_input,
    booking_debt_cutoff,
    course_debt_is_due,
    first_course_payment_at,
    parse_year_month,
    shift_year_month,
    sum_specialist_facts_company,
)

router = APIRouter(prefix="/sales-kpi", tags=["sales-kpi"])


def _assert_kpi_access(current_user: CurrentUser) -> None:
    from app.services.clinic_roles import can_access_company_report, can_access_debtors, can_access_kpi

    if current_user.role in (UserRole.expert, UserRole.finance_analyst):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Раздел KPI недоступен для этой роли")
    if can_access_kpi(current_user.role) or can_access_company_report(current_user.role) or can_access_debtors(current_user.role):
        return
    raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Нет доступа к KPI")


def _assert_owner(current_user: CurrentUser) -> None:
    if current_user.role not in (UserRole.owner, UserRole.super_owner, UserRole.rop):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Только владелец компании")


def _assert_admin_or_owner(current_user: CurrentUser) -> None:
    if current_user.role not in (
        UserRole.owner,
        UserRole.super_owner,
        UserRole.admin,
        UserRole.administrator,
        UserRole.rop,
    ):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Только владелец или админ")


def _assert_debtors_access(current_user: CurrentUser) -> None:
    from app.services.clinic_roles import can_access_debtors

    if can_access_debtors(current_user.role):
        return
    raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Дебиторка недоступна")


def _assert_company_report_access(current_user: CurrentUser) -> None:
    from app.services.clinic_roles import can_access_company_report

    if can_access_company_report(current_user.role):
        return
    raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Отчёт компании недоступен")


async def _load_pipeline(db: AsyncSession, company_id: int, pipeline_id: int) -> Pipeline:
    pipe = await db.get(Pipeline, pipeline_id)
    if pipe is None or pipe.company_id != company_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Воронка не найдена")
    return pipe


async def _is_user_assigned_pipeline(db: AsyncSession, company_id: int, user_id: int, pipeline_id: int) -> bool:
    from sqlalchemy import func

    n = await db.scalar(
        select(func.count(UserPipelineAssignment.id)).where(
            UserPipelineAssignment.company_id == company_id,
            UserPipelineAssignment.user_id == user_id,
            UserPipelineAssignment.pipeline_id == pipeline_id,
        ),
    )
    return int(n or 0) > 0


async def _load_directions_meta(
    db: AsyncSession,
    company_id: int,
    pipeline_id: int,
    ym,
) -> list[SalesKpiDirectionMeta]:
    all_dir_rows = (
        await db.execute(
            select(BookingDirection.id, BookingDirection.name)
            .where(
                BookingDirection.company_id == company_id,
                BookingDirection.is_active.is_(True),
                BookingDirection.pipeline_id == pipeline_id,
            )
            .order_by(BookingDirection.name.asc()),
        )
    ).all()
    prices = (
        await db.execute(
            select(SalesKpiServicePrice.direction_id, SalesKpiServicePrice.unit_price).where(
                SalesKpiServicePrice.company_id == company_id,
                SalesKpiServicePrice.pipeline_id == pipeline_id,
                SalesKpiServicePrice.year_month == ym,
            ),
        )
    ).all()
    price_map = {int(direction_id): Decimal(str(unit_price or 0)) for direction_id, unit_price in prices}
    return [
        SalesKpiDirectionMeta(
            direction_id=int(direction_id),
            direction_name=str(direction_name),
            unit_price=price_map.get(int(direction_id), Decimal("0")),
        )
        for direction_id, direction_name in all_dir_rows
    ]


def _item_out(item: SalesKpiPlanItem, specialist_ids: list[int] | None = None) -> SalesKpiPlanItemOut:
    return SalesKpiPlanItemOut(
        id=int(item.id),
        name=item.name,
        plan_qty=int(item.plan_qty or 0),
        weight_percent=Decimal(str(item.weight_percent or 0)),
        source_type=item.source_type,
        direction_id=int(item.direction_id) if item.direction_id is not None else None,
        specialist_ids=list(specialist_ids or []),
        sort_order=int(item.sort_order or 0),
    )


async def _load_specialists_meta(
    db: AsyncSession,
    company_id: int,
    pipeline_id: int,
) -> list[SalesKpiSpecialistMeta]:
    rows = (
        await db.execute(
            select(BookingSpecialist, BookingDirection.name)
            .join(BookingDirection, BookingDirection.id == BookingSpecialist.direction_id)
            .where(
                BookingSpecialist.company_id == company_id,
                BookingDirection.pipeline_id == pipeline_id,
            )
            .order_by(BookingSpecialist.sort_order.asc(), BookingSpecialist.full_name.asc()),
        )
    ).all()
    return [
        SalesKpiSpecialistMeta(
            id=int(s.id),
            full_name=s.full_name,
            direction_id=int(s.direction_id),
            direction_name=str(dname) if dname else None,
            is_active=bool(s.is_active),
        )
        for s, dname in rows
    ]


async def _replace_item_specialists(
    db: AsyncSession,
    *,
    plan_item_id: int,
    specialist_ids: list[int],
) -> None:
    await db.execute(
        delete(SalesKpiPlanItemSpecialist).where(SalesKpiPlanItemSpecialist.plan_item_id == plan_item_id),
    )
    for sid in sorted({int(x) for x in specialist_ids if int(x) > 0}):
        db.add(SalesKpiPlanItemSpecialist(plan_item_id=plan_item_id, specialist_id=sid))


def _date_noon(value: date | None) -> datetime | None:
    if value is None:
        return None
    return datetime(value.year, value.month, value.day, 12, 0, tzinfo=UTC)


def _payment_paid_at(value: datetime | None) -> datetime:
    when = value or datetime.now(UTC)
    if when.tzinfo is None:
        when = when.replace(tzinfo=UTC)
    return when


def _manual_counts_in_kpi(service_amount: Decimal, first_paid_amount: Decimal, status: str) -> bool:
    """В KPI/бонус идёт только первый платёж (≥25% стоимости). Доплаты — только дебиторка."""
    if status != "active":
        return False
    if service_amount <= 0:
        return False
    return first_paid_amount >= (service_amount * MANUAL_SALE_MIN_PAID_RATIO)


def _paid_at_from_input(raw: date | datetime | None, *, fallback: datetime | None = None) -> datetime:
    return paid_at_from_input(raw, fallback=fallback)


def _booking_debt_cutoff(month_end: datetime, *, now: datetime | None = None) -> datetime:
    return booking_debt_cutoff(month_end, now=now)


def _parse_booking_refund_appointment_id(external_key: str | None) -> int | None:
    """external_key вида booking_refund:{appointment_id}:{uuid}."""
    key = (external_key or "").strip()
    if not key.startswith("booking_refund:"):
        return None
    parts = key.split(":")
    if len(parts) < 2:
        return None
    try:
        return int(parts[1])
    except ValueError:
        return None


def _booking_open_debt(service_amount: Decimal, paid_amount: Decimal, refunded: Decimal) -> Decimal:
    """Остаток долга по визиту: возврат не превращается в дебиторку.

    Канон — ``patient_ltv.obligation_open_debt`` (REFUND ≠ AUTOMATIC DEBT).
    """
    from app.services.patient_ltv import obligation_open_debt

    return obligation_open_debt(service_amount, paid_amount, refunded)


async def _booking_refund_totals_by_appointment(
    db: AsyncSession,
    company_id: int,
    appointment_ids: list[int] | set[int],
) -> dict[int, Decimal]:
    ids = {int(i) for i in appointment_ids if i is not None}
    if not ids:
        return {}
    rows = (
        await db.execute(
            select(FinanceOsvRow.expense, FinanceOsvRow.external_key).where(
                FinanceOsvRow.company_id == company_id,
                FinanceOsvRow.source == "booking_refund",
            )
        )
    ).all()
    out: dict[int, Decimal] = {}
    for exp, ext in rows:
        aid = _parse_booking_refund_appointment_id(ext)
        if aid is None or aid not in ids:
            continue
        amt = abs(Decimal(str(exp or 0)))
        if amt <= 0:
            continue
        out[aid] = out.get(aid, Decimal("0")) + amt
    return out


def _payment_out(
    row: SalesKpiManualSalePayment,
    *,
    recorded_by_name: str | None = None,
) -> SalesKpiManualSalePaymentOut:
    return SalesKpiManualSalePaymentOut(
        id=int(row.id),
        amount=Decimal(str(row.amount or 0)),
        is_first=bool(row.is_first),
        note=row.note,
        paid_at=row.paid_at,
        recorded_by_name=recorded_by_name,
    )


def _manual_sale_out(
    sale: SalesKpiManualSale,
    *,
    plan_item_name: str,
    manager_name: str,
    payments: list[SalesKpiManualSalePayment] | None = None,
) -> SalesKpiManualSaleOut:
    sa = Decimal(str(sale.service_amount or 0))
    pa = Decimal(str(sale.paid_amount or 0))
    first = Decimal(str(getattr(sale, "first_paid_amount", None) or pa or 0))
    stream_raw = getattr(sale, "stream_no", None)
    group_raw = getattr(sale, "group_no", None)
    pay_rows = payments if payments is not None else []
    return SalesKpiManualSaleOut(
        id=int(sale.id),
        pipeline_id=int(sale.pipeline_id),
        plan_item_id=int(sale.plan_item_id),
        plan_item_name=plan_item_name,
        manager_user_id=int(sale.manager_user_id),
        manager_name=manager_name,
        client_name=sale.client_name,
        client_phone=sale.client_phone,
        lead_id=int(sale.lead_id) if getattr(sale, "lead_id", None) is not None else None,
        stream_no=int(stream_raw) if stream_raw is not None else None,
        group_no=int(group_raw) if group_raw is not None else None,
        service_amount=sa,
        paid_amount=pa,
        first_paid_amount=first,
        debt_amount=max(sa - pa, Decimal("0")),
        sold_at=sale.sold_at,
        status=sale.status,
        returned_at=sale.returned_at,
        note=sale.note,
        status_reason=getattr(sale, "status_reason", None),
        counts_in_kpi=_manual_counts_in_kpi(sa, first, sale.status),
        payments=[_payment_out(p) for p in pay_rows],
    )


async def _load_sale_payments(
    db: AsyncSession,
    sale_ids: list[int],
) -> dict[int, list[SalesKpiManualSalePayment]]:
    if not sale_ids:
        return {}
    rows = (
        await db.execute(
            select(SalesKpiManualSalePayment)
            .where(SalesKpiManualSalePayment.sale_id.in_(sale_ids))
            .order_by(SalesKpiManualSalePayment.id.asc()),
        )
    ).scalars().all()
    out: dict[int, list[SalesKpiManualSalePayment]] = {int(i): [] for i in sale_ids}
    for row in rows:
        out.setdefault(int(row.sale_id), []).append(row)
    return out


async def _build_sales_report(
    db: AsyncSession,
    *,
    company_id: int,
    pipe: Pipeline,
    ym,
    only_manager_id: int | None = None,
) -> SalesKpiSalesReport:
    items = await load_plan_items(db, company_id=company_id, pipeline_id=pipe.id, ym=ym)
    item_specialists = await load_plan_item_specialists(db, plan_item_ids=[int(i.id) for i in items])
    bonus_fund = await load_bonus_fund(db, company_id=company_id, pipeline_id=pipe.id, ym=ym)
    managers = await load_managers(db, company_id=company_id, pipeline_id=pipe.id)
    if only_manager_id is not None:
        managers = [m for m in managers if m[0] == only_manager_id]
    direction_facts = await load_direction_facts_full_paid(
        db, company_id=company_id, pipeline_id=pipe.id, ym=ym,
    )
    specialist_facts = await load_specialist_facts_full_paid(
        db, company_id=company_id, pipeline_id=pipe.id, ym=ym,
    )
    manual_facts = await load_manual_facts(db, company_id=company_id, pipeline_id=pipe.id, ym=ym)
    desk_facts = await load_desk_sale_facts_full_paid(
        db,
        company_id=company_id,
        pipeline_id=pipe.id,
        ym=ym,
        plan_items=items,
    )
    unit_prices = await load_kpi_unit_prices_by_label(
        db, company_id=company_id, pipeline_id=pipe.id, ym=ym,
    )

    board: list[SalesKpiBoardManager] = []
    for mid, mname in managers:
        raw = build_manager_lines(
            manager_id=mid,
            manager_name=mname,
            items=items,
            direction_facts=direction_facts,
            specialist_facts=specialist_facts,
            item_specialists=item_specialists,
            manual_facts=manual_facts,
            desk_facts=desk_facts,
            bonus_fund=bonus_fund,
            unit_price_by_label=unit_prices,
        )
        board.append(
            SalesKpiBoardManager(
                manager_id=raw["manager_id"],
                manager_name=raw["manager_name"],
                lines=[SalesKpiBoardLine(**line) for line in raw["lines"]],
                total_contribution=raw["total_contribution"],
                bonus=raw["bonus"],
                bonus_fund=raw["bonus_fund"],
            ),
        )

    return SalesKpiSalesReport(
        pipeline_id=pipe.id,
        pipeline_name=pipe.name,
        year_month=ym.isoformat()[:7],
        bonus_fund=bonus_fund,
        items=[_item_out(i, item_specialists.get(int(i.id), [])) for i in items],
        managers=board,
    )


@router.get("/weighted-plan", response_model=SalesKpiWeightedPlanOut)
async def get_weighted_plan(
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentUser,
    company_id: CurrentCompanyId,
    pipeline_id: int = Query(..., ge=1),
    year_month: str = Query(..., description="YYYY-MM"),
) -> SalesKpiWeightedPlanOut:
    _assert_kpi_access(current_user)
    pipe = await _load_pipeline(db, company_id, pipeline_id)
    try:
        ym = parse_year_month(year_month)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e

    if current_user.role in (UserRole.manager, UserRole.admin):
        if not await _is_user_assigned_pipeline(db, company_id, current_user.id, pipeline_id):
            raise HTTPException(status_code=403, detail="Вы не назначены на эту воронку")

    # Пустой месяц ← копируем последний сохранённый план (показатели, веса, эксперты, фонд).
    items, _carried = await ensure_plan_carried_forward(
        db,
        company_id=company_id,
        pipeline_id=pipeline_id,
        ym=ym,
    )
    item_specialists = await load_plan_item_specialists(db, plan_item_ids=[int(i.id) for i in items])
    bonus_fund = await load_bonus_fund(db, company_id=company_id, pipeline_id=pipeline_id, ym=ym)
    directions = await _load_directions_meta(db, company_id, pipeline_id, ym)
    specialists = await _load_specialists_meta(db, company_id, pipeline_id)
    managers = await load_managers(db, company_id=company_id, pipeline_id=pipeline_id)
    return SalesKpiWeightedPlanOut(
        pipeline_id=pipe.id,
        pipeline_name=pipe.name,
        year_month=ym.isoformat()[:7],
        bonus_fund=bonus_fund,
        items=[_item_out(i, item_specialists.get(int(i.id), [])) for i in items],
        directions=directions,
        specialists=specialists,
        managers=[{"id": mid, "name": name} for mid, name in managers],
    )


@router.put("/weighted-plan", status_code=status.HTTP_204_NO_CONTENT)
async def put_weighted_plan(
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentUser,
    company_id: CurrentCompanyId,
    body: SalesKpiWeightedPlanPut,
) -> None:
    _assert_kpi_access(current_user)
    _assert_owner(current_user)
    await _load_pipeline(db, company_id, body.pipeline_id)
    try:
        ym = parse_year_month(body.year_month)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e

    sales_space = await company_is_sales_mode(db, company_id)
    specialists_meta = await _load_specialists_meta(db, company_id, body.pipeline_id)
    allowed_specialist_ids = {s.id for s in specialists_meta}
    seen_specialists: dict[int, str] = {}

    for raw in body.items:
        st = (raw.source_type or "manual").strip().lower()
        if sales_space:
            # В продажах факт KPI — из окна «Продажи» / manual; онлайн-запись не обязательна.
            st = "manual"
            raw.source_type = "manual"
            raw.direction_id = None
            raw.specialist_ids = []
        if st not in ("direction", "manual"):
            raise HTTPException(status_code=400, detail=f"Неверный source_type: {raw.source_type}")
        if st == "direction":
            sids = [int(x) for x in (raw.specialist_ids or []) if int(x) > 0]
            if not sids and not raw.direction_id:
                raise HTTPException(
                    status_code=400,
                    detail=f"Для «{raw.name}» привяжите хотя бы одного эксперта онлайн-записи (или направление)",
                )
            for sid in sids:
                if sid not in allowed_specialist_ids:
                    raise HTTPException(status_code=400, detail=f"Эксперт #{sid} не найден в этой воронке")
                if sid in seen_specialists:
                    raise HTTPException(
                        status_code=400,
                        detail=f"Эксперт уже привязан к «{seen_specialists[sid]}» — один эксперт = одна услуга KPI",
                    )
                seen_specialists[sid] = raw.name.strip()
            if raw.direction_id:
                d = await db.get(BookingDirection, raw.direction_id)
                if d is None or d.company_id != company_id or d.pipeline_id != body.pipeline_id:
                    raise HTTPException(status_code=400, detail=f"Направление не найдено: {raw.direction_id}")

    settings = (
        await db.execute(
            select(SalesKpiWeightedSettings).where(
                SalesKpiWeightedSettings.company_id == company_id,
                SalesKpiWeightedSettings.pipeline_id == body.pipeline_id,
                SalesKpiWeightedSettings.year_month == ym,
            ),
        )
    ).scalar_one_or_none()
    if settings is None:
        db.add(
            SalesKpiWeightedSettings(
                company_id=company_id,
                pipeline_id=body.pipeline_id,
                year_month=ym,
                bonus_fund=body.bonus_fund,
            ),
        )
    else:
        settings.bonus_fund = body.bonus_fund

    existing_items = await load_plan_items(db, company_id=company_id, pipeline_id=body.pipeline_id, ym=ym)
    kept_names = {(x.name or "").strip() for x in body.items}
    for old in existing_items:
        if old.name.strip() not in kept_names:
            sale_n = await db.scalar(
                select(SalesKpiManualSale.id).where(SalesKpiManualSale.plan_item_id == old.id).limit(1),
            )
            if sale_n is not None:
                raise HTTPException(
                    status_code=400,
                    detail=f"Нельзя удалить продукт «{old.name}»: есть продажи. Сначала оформите возвраты/удалите продажи.",
                )
            await db.delete(old)

    await db.flush()
    current = {
        i.name.strip(): i
        for i in await load_plan_items(db, company_id=company_id, pipeline_id=body.pipeline_id, ym=ym)
    }
    for idx, raw in enumerate(body.items):
        name = raw.name.strip()
        st = (raw.source_type or "manual").strip().lower()
        sids = [int(x) for x in (raw.specialist_ids or []) if int(x) > 0] if st == "direction" else []
        # Если эксперты выбраны, направление подставим с первого эксперта (для цен записи).
        direction_id = raw.direction_id if st == "direction" else None
        if st == "direction" and sids and not direction_id:
            spec = await db.get(BookingSpecialist, sids[0])
            if spec is not None:
                direction_id = int(spec.direction_id)
        row = current.get(name)
        if row is None:
            row = SalesKpiPlanItem(
                company_id=company_id,
                pipeline_id=body.pipeline_id,
                year_month=ym,
                name=name,
                plan_qty=raw.plan_qty,
                weight_percent=raw.weight_percent,
                source_type=st,
                direction_id=direction_id,
                sort_order=raw.sort_order if raw.sort_order else idx,
            )
            db.add(row)
            await db.flush()
        else:
            row.plan_qty = raw.plan_qty
            row.weight_percent = raw.weight_percent
            row.source_type = st
            row.direction_id = direction_id
            row.sort_order = raw.sort_order if raw.sort_order else idx
            await db.flush()
        await _replace_item_specialists(db, plan_item_id=int(row.id), specialist_ids=sids)

    await db.execute(
        delete(SalesKpiServicePrice).where(
            SalesKpiServicePrice.company_id == company_id,
            SalesKpiServicePrice.pipeline_id == body.pipeline_id,
            SalesKpiServicePrice.year_month == ym,
        ),
    )
    for p in body.prices:
        if p.unit_price <= 0:
            continue
        d = await db.get(BookingDirection, p.direction_id)
        if d is None or d.company_id != company_id:
            raise HTTPException(status_code=400, detail=f"Неизвестное направление: {p.direction_id}")
        db.add(
            SalesKpiServicePrice(
                company_id=company_id,
                pipeline_id=body.pipeline_id,
                year_month=ym,
                direction_id=p.direction_id,
                unit_price=p.unit_price,
            ),
        )

    await db.commit()


@router.get("/sales-report", response_model=SalesKpiSalesReport)
async def sales_report(
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentUser,
    company_id: CurrentCompanyId,
    pipeline_id: int = Query(..., ge=1),
    year_month: str = Query(..., description="YYYY-MM"),
) -> SalesKpiSalesReport:
    _assert_kpi_access(current_user)
    pipe = await _load_pipeline(db, company_id, pipeline_id)
    try:
        ym = parse_year_month(year_month)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e

    only_manager: int | None = None
    if current_user.role == UserRole.manager:
        if not await _is_user_assigned_pipeline(db, company_id, current_user.id, pipeline_id):
            raise HTTPException(status_code=403, detail="Вы не назначены на эту воронку")
        only_manager = current_user.id
    elif current_user.role == UserRole.admin:
        if not await _is_user_assigned_pipeline(db, company_id, current_user.id, pipeline_id):
            raise HTTPException(status_code=403, detail="Вы не назначены на эту воронку")

    return await _build_sales_report(
        db,
        company_id=company_id,
        pipe=pipe,
        ym=ym,
        only_manager_id=only_manager,
    )


@router.get("/managers", response_model=list[dict])
async def list_kpi_managers(
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentUser,
    company_id: CurrentCompanyId,
    pipeline_id: int = Query(..., ge=1),
) -> list[dict]:
    _assert_kpi_access(current_user)
    await _load_pipeline(db, company_id, pipeline_id)
    managers = await load_managers(db, company_id=company_id, pipeline_id=pipeline_id)
    return [{"id": mid, "name": name} for mid, name in managers]


@router.get("/manual-sales", response_model=list[SalesKpiManualSaleOut])
async def list_manual_sales(
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentUser,
    company_id: CurrentCompanyId,
    pipeline_id: int = Query(..., ge=1),
    year_month: str = Query(..., description="YYYY-MM"),
) -> list[SalesKpiManualSaleOut]:
    _assert_kpi_access(current_user)
    _assert_admin_or_owner(current_user)
    await _load_pipeline(db, company_id, pipeline_id)
    try:
        ym = parse_year_month(year_month)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    start, end = month_bounds(ym)
    # Окно лечения 3 месяца: июнь при просмотре сентября → sold_at >= June 1.
    horizon_start, _ = month_bounds(shift_year_month(ym, -3))

    rows = (
        await db.execute(
            select(SalesKpiManualSale, SalesKpiPlanItem.name, User.full_name, User.email)
            .join(SalesKpiPlanItem, SalesKpiPlanItem.id == SalesKpiManualSale.plan_item_id)
            .join(User, User.id == SalesKpiManualSale.manager_user_id)
            .where(
                SalesKpiManualSale.company_id == company_id,
                SalesKpiManualSale.pipeline_id == pipeline_id,
                SalesKpiManualSale.sold_at < end,
                or_(
                    # В выбранном месяце — все записи (в т.ч. возврат / отказ / завершён).
                    and_(
                        SalesKpiManualSale.sold_at >= start,
                        SalesKpiManualSale.sold_at < end,
                    ),
                    # Активные курсы тянутся, пока есть долг или не прошли 3 месяца лечения.
                    and_(
                        SalesKpiManualSale.status == "active",
                        or_(
                            SalesKpiManualSale.paid_amount < SalesKpiManualSale.service_amount,
                            SalesKpiManualSale.sold_at >= horizon_start,
                        ),
                    ),
                ),
            )
            .order_by(SalesKpiManualSale.sold_at.desc(), SalesKpiManualSale.id.desc()),
        )
    ).all()

    sale_ids = [int(sale.id) for sale, *_ in rows]
    payments_by_sale = await _load_sale_payments(db, sale_ids)
    out: list[SalesKpiManualSaleOut] = []
    for sale, item_name, full_name, email in rows:
        out.append(
            _manual_sale_out(
                sale,
                plan_item_name=str(item_name),
                manager_name=str(full_name or email or f"#{sale.manager_user_id}"),
                payments=payments_by_sale.get(int(sale.id), []),
            ),
        )
    return out


@router.get("/manual-sales/payments", response_model=list[SalesKpiManualPaymentJournalRow])
async def manual_payment_journal(
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentUser,
    company_id: CurrentCompanyId,
    pipeline_id: int = Query(..., ge=1),
    q: str = Query(default="", max_length=120),
) -> list[SalesKpiManualPaymentJournalRow]:
    """Журнал оплат курсов и протоколов: когда, кто внёс, сколько."""
    _assert_kpi_access(current_user)
    _assert_admin_or_owner(current_user)
    await _load_pipeline(db, company_id, pipeline_id)
    rows = (
        await db.execute(
            select(SalesKpiManualSale, SalesKpiPlanItem.name, User.full_name, User.email)
            .join(SalesKpiPlanItem, SalesKpiPlanItem.id == SalesKpiManualSale.plan_item_id)
            .join(User, User.id == SalesKpiManualSale.manager_user_id)
            .where(
                SalesKpiManualSale.company_id == company_id,
                SalesKpiManualSale.pipeline_id == pipeline_id,
            )
            .order_by(SalesKpiManualSale.sold_at.desc(), SalesKpiManualSale.id.desc()),
        )
    ).all()
    sale_ids = [int(sale.id) for sale, *_ in rows]
    payments_by_sale = await _load_sale_payments(db, sale_ids)
    actor_ids: set[int] = set()
    for sale, *_ in rows:
        if sale.created_by_user_id:
            actor_ids.add(int(sale.created_by_user_id))
        for pay in payments_by_sale.get(int(sale.id), []):
            if pay.created_by_user_id:
                actor_ids.add(int(pay.created_by_user_id))
    actors: dict[int, str] = {}
    if actor_ids:
        urows = (
            await db.execute(select(User.id, User.full_name, User.email).where(User.id.in_(list(actor_ids))))
        ).all()
        for uid, full_name, email in urows:
            actors[int(uid)] = str(full_name or email or f"#{uid}")

    journal: list[SalesKpiManualPaymentJournalRow] = []
    for sale, item_name, mgr_name, mgr_email in rows:
        manager = str(mgr_name or mgr_email or f"#{sale.manager_user_id}")
        pays = payments_by_sale.get(int(sale.id), [])
        covered = Decimal("0")
        for pay in pays:
            covered += Decimal(str(pay.amount or 0))
            who = actors.get(int(pay.created_by_user_id)) if pay.created_by_user_id else None
            journal.append(
                SalesKpiManualPaymentJournalRow(
                    sale_id=int(sale.id),
                    payment_id=int(pay.id),
                    paid_at=pay.paid_at,
                    client_name=sale.client_name,
                    client_phone=sale.client_phone,
                    plan_item_name=str(item_name),
                    amount=Decimal(str(pay.amount or 0)),
                    is_first=bool(pay.is_first),
                    note=pay.note,
                    manager_name=manager,
                    recorded_by_name=who,
                ),
            )
        gap = Decimal(str(sale.paid_amount or 0)) - covered
        if gap > 0 and sale.sold_at is not None:
            who_id = int(sale.created_by_user_id) if sale.created_by_user_id else None
            journal.append(
                SalesKpiManualPaymentJournalRow(
                    sale_id=int(sale.id),
                    payment_id=None,
                    paid_at=sale.sold_at,
                    client_name=sale.client_name,
                    client_phone=sale.client_phone,
                    plan_item_name=str(item_name),
                    amount=gap,
                    is_first=True,
                    note="Первый платёж",
                    manager_name=manager,
                    recorded_by_name=actors.get(who_id) if who_id else None,
                ),
            )
    journal.sort(key=lambda r: r.paid_at, reverse=True)
    needle = " ".join((q or "").lower().split())
    if needle:
        journal = [
            row
            for row in journal
            if needle in " ".join(
                [
                    row.client_name,
                    row.client_phone,
                    row.plan_item_name,
                    row.manager_name,
                    row.recorded_by_name or "",
                    row.note or "",
                    f"{row.amount}",
                ],
            ).lower()
        ]
    return journal


@router.get("/leads/search", response_model=SalesKpiLeadSearchOut)
async def search_leads_for_manual_sale(
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentUser,
    company_id: CurrentCompanyId,
    q: str = Query(..., min_length=1, max_length=120, description="ФИО / телефон / Lead ID"),
    limit: int = Query(20, ge=1, le=40),
) -> SalesKpiLeadSearchOut:
    """Lead picker search for new KPI sales. Multiple Leads per phone → all shown, no auto-select."""
    _assert_kpi_access(current_user)
    _assert_admin_or_owner(current_user)
    from app.services.kpi_lead_search import search_leads_for_kpi_sale

    items_raw = await search_leads_for_kpi_sale(db, company_id=company_id, q=q, limit=limit)
    items = [SalesKpiLeadSearchItem(**row) for row in items_raw]
    return SalesKpiLeadSearchOut(
        q=q.strip(),
        count=len(items),
        note=(
            "Каждый Lead — отдельный кандидат. Один телефон может относиться к нескольким "
            "детям — выберите явно. Без auto-select и без phone merge."
        ),
        items=items,
    )


@router.post("/manual-sales", response_model=SalesKpiManualSaleOut, status_code=status.HTTP_201_CREATED)
async def create_manual_sale(
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentUser,
    company_id: CurrentCompanyId,
    body: SalesKpiManualSaleCreate,
) -> SalesKpiManualSaleOut:
    _assert_kpi_access(current_user)
    _assert_admin_or_owner(current_user)
    await _load_pipeline(db, company_id, body.pipeline_id)

    item = await db.get(SalesKpiPlanItem, body.plan_item_id)
    if item is None or item.company_id != company_id or item.pipeline_id != body.pipeline_id:
        raise HTTPException(status_code=400, detail="Продукт плана не найден")
    if item.source_type != "manual":
        raise HTTPException(status_code=400, detail="Этот продукт берётся из онлайн-записи, не из формы курса/протокола")

    manager = await db.get(User, body.manager_user_id)
    if manager is None or manager.company_id != company_id or manager.role != UserRole.manager:
        raise HTTPException(status_code=400, detail="Укажите менеджера компании")
    if not await _is_user_assigned_pipeline(db, company_id, body.manager_user_id, body.pipeline_id):
        raise HTTPException(status_code=400, detail="Менеджер не назначен на воронку")

    if body.paid_amount > body.service_amount:
        raise HTTPException(status_code=400, detail="Оплата не может быть больше стоимости")
    second_paid = Decimal(str(body.second_paid_amount or 0))
    first_paid = Decimal(str(body.paid_amount or 0))
    if first_paid + second_paid > body.service_amount:
        raise HTTPException(status_code=400, detail="Сумма платежей не может быть больше стоимости")

    from app.services.audit import write_audit_event
    from app.services.kpi_lead_search import resolve_kpi_sale_lead_id

    # lead_id=None → unresolved (explicit); never infer from phone.
    link_lead_id = await resolve_kpi_sale_lead_id(db, company_id=company_id, lead_id=body.lead_id)

    total_paid = first_paid + second_paid
    first_at = _paid_at_from_input(body.first_paid_at if body.first_paid_at is not None else body.sold_at)
    second_at = _paid_at_from_input(body.second_paid_at)

    sale = SalesKpiManualSale(
        company_id=company_id,
        pipeline_id=body.pipeline_id,
        plan_item_id=body.plan_item_id,
        manager_user_id=body.manager_user_id,
        client_name=body.client_name.strip(),
        client_phone=body.client_phone.strip(),
        lead_id=link_lead_id,
        stream_no=int(body.stream_no),
        group_no=int(body.group_no),
        service_amount=body.service_amount,
        paid_amount=total_paid,
        first_paid_amount=first_paid,
        sold_at=first_at,
        status="active",
        note=body.note,
        created_by_user_id=current_user.id,
    )
    db.add(sale)
    await db.flush()
    payments: list[SalesKpiManualSalePayment] = []
    if first_paid > 0:
        pay = SalesKpiManualSalePayment(
            company_id=company_id,
            sale_id=int(sale.id),
            amount=first_paid,
            is_first=True,
            note="Первый платёж",
            paid_at=first_at,
            created_by_user_id=current_user.id,
        )
        db.add(pay)
        payments.append(pay)
    if second_paid > 0:
        pay2 = SalesKpiManualSalePayment(
            company_id=company_id,
            sale_id=int(sale.id),
            amount=second_paid,
            is_first=False,
            note="Второй платёж",
            paid_at=second_at,
            created_by_user_id=current_user.id,
        )
        db.add(pay2)
        payments.append(pay2)

    await write_audit_event(
        db,
        entity_type="kpi_manual_sale",
        entity_id=int(sale.id),
        action="create",
        current_user=current_user,
        details=(
            f"lead_id={link_lead_id!r}; client={sale.client_name!r}; "
            f"phone={sale.client_phone!r}; service={sale.service_amount}; paid={total_paid}"
        ),
    )
    await db.commit()
    await db.refresh(sale)
    for p in payments:
        await db.refresh(p)

    return _manual_sale_out(
        sale,
        plan_item_name=item.name,
        manager_name=str(manager.full_name or manager.email or f"#{manager.id}"),
        payments=payments,
    )


@router.patch("/manual-sales/{sale_id}/payment", response_model=SalesKpiManualSaleOut)
async def patch_manual_sale_payment(
    sale_id: int,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentUser,
    company_id: CurrentCompanyId,
    body: SalesKpiManualSalePaymentPatch,
) -> SalesKpiManualSaleOut:
    _assert_kpi_access(current_user)
    _assert_admin_or_owner(current_user)
    sale = await db.get(SalesKpiManualSale, sale_id)
    if sale is None or sale.company_id != company_id:
        raise HTTPException(status_code=404, detail="Продажа не найдена")
    if sale.status == "returned":
        raise HTTPException(status_code=400, detail="По возвращённой продаже нельзя менять оплату")
    if sale.status != "active":
        raise HTTPException(status_code=400, detail="Доплата только по активной продаже")

    add_amount = Decimal(str(body.add_amount))
    service_amount = Decimal(str(sale.service_amount or 0))
    current_paid = Decimal(str(sale.paid_amount or 0))
    new_paid = current_paid + add_amount
    if new_paid > service_amount:
        raise HTTPException(
            status_code=400,
            detail=f"Доплата превышает долг: остаток {service_amount - current_paid}",
        )

    sale.paid_amount = new_paid
    # first_paid_amount не трогаем — KPI/бонус только по первому платежу
    if getattr(sale, "first_paid_amount", None) is None:
        sale.first_paid_amount = current_paid
    sale.updated_at = datetime.now(UTC)
    if body.note is not None and body.note.strip():
        sale.note = body.note.strip()

    pay_at = _paid_at_from_input(body.paid_at)
    pay = SalesKpiManualSalePayment(
        company_id=company_id,
        sale_id=int(sale.id),
        amount=add_amount,
        is_first=False,
        note=(body.note.strip() if body.note else None) or "Доплата",
        paid_at=pay_at,
        created_by_user_id=current_user.id,
    )
    db.add(pay)
    await db.commit()
    await db.refresh(sale)
    await db.refresh(pay)

    payments = (await _load_sale_payments(db, [int(sale.id)])).get(int(sale.id), [])
    item = await db.get(SalesKpiPlanItem, sale.plan_item_id)
    manager = await db.get(User, sale.manager_user_id)
    return _manual_sale_out(
        sale,
        plan_item_name=item.name if item else "",
        manager_name=str(
            (manager.full_name if manager else None)
            or (manager.email if manager else None)
            or f"#{sale.manager_user_id}"
        ),
        payments=payments,
    )


@router.patch("/manual-sales/{sale_id}/sold-at", response_model=SalesKpiManualSaleOut)
async def patch_manual_sale_sold_at(
    sale_id: int,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentUser,
    company_id: CurrentCompanyId,
    body: SalesKpiManualSaleSoldAtPatch,
) -> SalesKpiManualSaleOut:
    """Дата продажи. Первый платёж без строк журнала попадает в месяц sold_at."""
    _assert_kpi_access(current_user)
    _assert_admin_or_owner(current_user)
    sale = await db.get(SalesKpiManualSale, sale_id)
    if sale is None or sale.company_id != company_id:
        raise HTTPException(status_code=404, detail="Продажа не найдена")
    sale.sold_at = _paid_at_from_input(body.sold_at)
    sale.updated_at = datetime.now(UTC)
    await db.commit()
    await db.refresh(sale)
    payments = (await _load_sale_payments(db, [int(sale.id)])).get(int(sale.id), [])
    item = await db.get(SalesKpiPlanItem, sale.plan_item_id)
    manager = await db.get(User, sale.manager_user_id)
    return _manual_sale_out(
        sale,
        plan_item_name=item.name if item else "",
        manager_name=str(
            (manager.full_name if manager else None)
            or (manager.email if manager else None)
            or f"#{sale.manager_user_id}"
        ),
        payments=payments,
    )


@router.patch("/manual-sales/{sale_id}/link-lead", response_model=SalesKpiManualSaleOut)
async def link_manual_sale_lead(
    sale_id: int,
    body: SalesKpiManualSaleLinkLeadPatch,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentUser,
    company_id: CurrentCompanyId,
) -> SalesKpiManualSaleOut:
    """Owner: явная ручная привязка KPI-продажи к Lead. Без phone auto-merge."""
    _assert_kpi_access(current_user)
    if current_user.role not in (UserRole.owner, UserRole.super_owner):
        raise HTTPException(status_code=403, detail="Только владелец может привязать Lead")
    sale = await db.get(SalesKpiManualSale, sale_id)
    if sale is None or sale.company_id != company_id:
        raise HTTPException(status_code=404, detail="Продажа не найдена")
    lead = await db.get(Lead, int(body.lead_id))
    if lead is None or lead.company_id != company_id:
        raise HTTPException(status_code=400, detail="Lead не найден в компании")
    from app.services.audit import write_audit_event
    from app.services.kpi_lead_search import resolve_kpi_sale_lead_id

    before_lead = sale.lead_id
    sale.lead_id = await resolve_kpi_sale_lead_id(db, company_id=company_id, lead_id=int(body.lead_id))
    sale.updated_at = datetime.now(UTC)
    await write_audit_event(
        db,
        entity_type="kpi_manual_sale",
        entity_id=int(sale.id),
        action="link_lead",
        current_user=current_user,
        details=f"lead_id: {before_lead!r} → {int(lead.id)}; client={sale.client_name!r}",
    )
    await db.commit()
    await db.refresh(sale)
    payments = (await _load_sale_payments(db, [int(sale.id)])).get(int(sale.id), [])
    item = await db.get(SalesKpiPlanItem, sale.plan_item_id)
    manager = await db.get(User, sale.manager_user_id)
    return _manual_sale_out(
        sale,
        plan_item_name=item.name if item else "",
        manager_name=str(
            (manager.full_name if manager else None)
            or (manager.email if manager else None)
            or f"#{sale.manager_user_id}"
        ),
        payments=payments,
    )


@router.post("/manual-sales/{sale_id}/return", response_model=SalesKpiManualSaleOut)
async def return_manual_sale(
    sale_id: int,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentUser,
    company_id: CurrentCompanyId,
) -> SalesKpiManualSaleOut:
    _assert_kpi_access(current_user)
    _assert_admin_or_owner(current_user)
    sale = await db.get(SalesKpiManualSale, sale_id)
    if sale is None or sale.company_id != company_id:
        raise HTTPException(status_code=404, detail="Продажа не найдена")
    if sale.status == "returned":
        raise HTTPException(status_code=400, detail="Уже возврат")

    sale.status = "returned"
    sale.returned_at = datetime.now(UTC)
    sale.updated_at = sale.returned_at
    await db.commit()
    await db.refresh(sale)

    item = await db.get(SalesKpiPlanItem, sale.plan_item_id)
    manager = await db.get(User, sale.manager_user_id)
    out = _manual_sale_out(
        sale,
        plan_item_name=item.name if item else "",
        manager_name=str(
            (manager.full_name if manager else None)
            or (manager.email if manager else None)
            or f"#{sale.manager_user_id}"
        ),
    )
    out.counts_in_kpi = False
    return out


@router.patch("/manual-sales/{sale_id}/status", response_model=SalesKpiManualSaleOut)
async def patch_manual_sale_status(
    sale_id: int,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentUser,
    company_id: CurrentCompanyId,
    body: SalesKpiManualSaleStatusPatch,
) -> SalesKpiManualSaleOut:
    """Отказ или завершение курса/протокола с обязательной причиной."""
    _assert_kpi_access(current_user)
    _assert_admin_or_owner(current_user)
    sale = await db.get(SalesKpiManualSale, sale_id)
    if sale is None or sale.company_id != company_id:
        raise HTTPException(status_code=404, detail="Продажа не найдена")
    if sale.status in ("returned", "refused", "completed"):
        raise HTTPException(status_code=400, detail=f"Уже закрыто: {sale.status}")

    reason = (body.reason or "").strip()
    if not reason:
        raise HTTPException(status_code=400, detail="Укажите причину")

    sale.status = body.status
    sale.status_reason = reason
    sale.updated_at = datetime.now(UTC)
    if not (sale.note or "").strip():
        sale.note = reason
    await db.commit()
    await db.refresh(sale)

    item = await db.get(SalesKpiPlanItem, sale.plan_item_id)
    manager = await db.get(User, sale.manager_user_id)
    return _manual_sale_out(
        sale,
        plan_item_name=item.name if item else "",
        manager_name=str(
            (manager.full_name if manager else None)
            or (manager.email if manager else None)
            or f"#{sale.manager_user_id}"
        ),
    )


@router.get("/debtors", response_model=SalesKpiDebtorsReport)
async def debtors_report(
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentUser,
    company_id: CurrentCompanyId,
    pipeline_id: int = Query(..., ge=1),
    year_month: str = Query(..., description="YYYY-MM"),
) -> SalesKpiDebtorsReport:
    _assert_kpi_access(current_user)
    _assert_debtors_access(current_user)
    pipe = await _load_pipeline(db, company_id, pipeline_id)
    try:
        ym = parse_year_month(year_month)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    start, end = month_bounds(ym)

    rows_out: list[SalesKpiDebtorRow] = []
    sales_mode = await company_is_sales_mode(db, company_id)

    booking_q: list = []
    desk_q: list = []
    if sales_mode:
        # Открытые долги на конец выбранного месяца (включая прошлые месяцы).
        desk_q = (
            await db.execute(
                select(ManagerDeskSale).where(
                    ManagerDeskSale.company_id == company_id,
                    ManagerDeskSale.status == "active",
                    ManagerDeskSale.sold_at < end,
                    ManagerDeskSale.service_amount > ManagerDeskSale.paid_amount,
                    or_(
                        ManagerDeskSale.pipeline_id == pipeline_id,
                        ManagerDeskSale.pipeline_id.is_(None),
                    ),
                ).order_by(ManagerDeskSale.sold_at.desc()),
            )
        ).scalars().all()
    else:
        # Дебиторка записи: только прошедшие визиты со статусом «Пришёл».
        # Неявка / отмена / будущие «Запись» — не долг.
        debt_cutoff = _booking_debt_cutoff(end)
        booking_q = (
            await db.execute(
                select(BookingAppointment, BookingDirection.name, Lead.manager_id)
                .join(BookingDirection, BookingDirection.id == BookingAppointment.direction_id)
                .join(Lead, Lead.id == BookingAppointment.lead_id, isouter=True)
                .join(PipelineStage, PipelineStage.id == Lead.status_id, isouter=True)
                .where(
                    BookingAppointment.company_id == company_id,
                    BookingAppointment.start_at < debt_cutoff,
                    BookingAppointment.service_amount > BookingAppointment.paid_amount,
                    BookingAppointment.status == "completed",
                    or_(
                        BookingAppointment.pipeline_id == pipeline_id,
                        PipelineStage.pipeline_id == pipeline_id,
                        BookingDirection.pipeline_id == pipeline_id,
                    ),
                )
                .order_by(BookingAppointment.start_at.desc()),
            )
        ).all()

    manager_ids = set()
    for appt, _dname, lead_mgr in booking_q:
        mid = appt.responsible_manager_id or lead_mgr
        if mid:
            manager_ids.add(int(mid))
    for sale in desk_q:
        manager_ids.add(int(sale.manager_user_id))

    manual_q = (
        await db.execute(
            select(SalesKpiManualSale, SalesKpiPlanItem.name)
            .join(SalesKpiPlanItem, SalesKpiPlanItem.id == SalesKpiManualSale.plan_item_id)
            .where(
                SalesKpiManualSale.company_id == company_id,
                SalesKpiManualSale.pipeline_id == pipeline_id,
                SalesKpiManualSale.sold_at < end,
                SalesKpiManualSale.status == "active",
                SalesKpiManualSale.service_amount > SalesKpiManualSale.paid_amount,
            )
            .order_by(SalesKpiManualSale.sold_at.desc()),
        )
    ).all()
    for sale, _ in manual_q:
        manager_ids.add(int(sale.manager_user_id))

    name_map: dict[int, str] = {}
    if manager_ids:
        urows = (
            await db.execute(select(User.id, User.full_name, User.email).where(User.id.in_(list(manager_ids))))
        ).all()
        for uid, full_name, email in urows:
            name_map[int(uid)] = str(full_name or email or f"#{uid}")

    booking_refunds = await _booking_refund_totals_by_appointment(
        db,
        company_id,
        [int(appt.id) for appt, _dname, _lead_mgr in booking_q],
    )
    for appt, dname, lead_mgr in booking_q:
        sa = Decimal(str(appt.service_amount or 0))
        pa = Decimal(str(appt.paid_amount or 0))
        refunded = booking_refunds.get(int(appt.id), Decimal("0"))
        debt = _booking_open_debt(sa, pa, refunded)
        if debt <= 0:
            continue
        mid = int(appt.responsible_manager_id or lead_mgr) if (appt.responsible_manager_id or lead_mgr) else None
        rows_out.append(
            SalesKpiDebtorRow(
                source="booking",
                source_id=int(appt.id),
                sold_at=appt.start_at,
                client_name=appt.patient_name,
                client_phone=appt.patient_phone,
                indicator_name=str(dname),
                manager_id=mid,
                manager_name=name_map.get(mid) if mid else None,
                service_amount=sa,
                paid_amount=pa,
                debt_amount=debt,
                status="debt",
            ),
        )

    for sale in desk_q:
        sa = Decimal(str(sale.service_amount or 0))
        pa = Decimal(str(sale.paid_amount or 0))
        mid = int(sale.manager_user_id)
        rows_out.append(
            SalesKpiDebtorRow(
                source="booking",
                source_id=int(sale.id),
                sold_at=sale.sold_at,
                client_name=sale.client_name,
                client_phone=sale.client_phone,
                indicator_name=sale.activity_sphere or "Продажа",
                manager_id=mid,
                manager_name=name_map.get(mid),
                service_amount=sa,
                paid_amount=pa,
                debt_amount=max(sa - pa, Decimal("0")),
                status="debt",
            ),
        )

    sale_ids_for_debt: list[int] = []
    manual_pairs: list[tuple] = []
    for sale, item_name in manual_q:
        payments = []  # filled below
        sale_ids_for_debt.append(int(sale.id))
        manual_pairs.append((sale, str(item_name)))

    payments_by_sale = await _load_sale_payments(db, sale_ids_for_debt)
    debt_cutoff = _booking_debt_cutoff(end)
    for sale, item_name in manual_pairs:
        payments = payments_by_sale.get(int(sale.id), [])
        first_at = first_course_payment_at(sale.sold_at, payments)
        if not course_debt_is_due(first_at, debt_cutoff):
            continue
        sa = Decimal(str(sale.service_amount or 0))
        pa = Decimal(str(sale.paid_amount or 0))
        mid = int(sale.manager_user_id)
        rows_out.append(
            SalesKpiDebtorRow(
                source="manual",
                source_id=int(sale.id),
                sold_at=sale.sold_at,
                client_name=sale.client_name,
                client_phone=sale.client_phone,
                indicator_name=str(item_name),
                manager_id=mid,
                manager_name=name_map.get(mid),
                service_amount=sa,
                paid_amount=pa,
                debt_amount=max(sa - pa, Decimal("0")),
                status="debt",
            ),
        )

    total = sum((r.debt_amount for r in rows_out), Decimal("0"))
    from app.services.clinic_roles import debtors_course_protocol_only, is_course_or_protocol_indicator

    if debtors_course_protocol_only(current_user.role):
        rows_out = [r for r in rows_out if is_course_or_protocol_indicator(r.indicator_name)]
        total = sum((r.debt_amount for r in rows_out), Decimal("0"))
    return SalesKpiDebtorsReport(
        pipeline_id=pipe.id,
        pipeline_name=pipe.name,
        year_month=ym.isoformat()[:7],
        rows=rows_out,
        total_debt=total,
    )


@router.get("/company-report", response_model=SalesKpiCompanyReport)
async def company_report(
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentUser,
    company_id: CurrentCompanyId,
    pipeline_id: int = Query(..., ge=1),
    year_month: str = Query(..., description="YYYY-MM"),
) -> SalesKpiCompanyReport:
    """Сводный отчёт компании — владелец и бухгалтер."""
    _assert_kpi_access(current_user)
    _assert_company_report_access(current_user)
    pipe = await _load_pipeline(db, company_id, pipeline_id)
    try:
        ym = parse_year_month(year_month)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e

    start, end = month_bounds(ym)
    now = datetime.now(UTC)
    items = await load_plan_items(db, company_id=company_id, pipeline_id=pipeline_id, ym=ym)
    plan_item_ids = [int(i.id) for i in items]

    async def _q_specialists(session: AsyncSession):
        return await load_plan_item_specialists(session, plan_item_ids=plan_item_ids)

    async def _q_managers(session: AsyncSession):
        return await load_managers(session, company_id=company_id, pipeline_id=pipeline_id)

    async def _q_dir_facts(session: AsyncSession):
        return await load_direction_facts_full_paid(
            session, company_id=company_id, pipeline_id=pipeline_id, ym=ym,
        )

    async def _q_spec_facts(session: AsyncSession):
        return await load_specialist_facts_full_paid(
            session, company_id=company_id, pipeline_id=pipeline_id, ym=ym,
        )

    async def _q_spec_company(session: AsyncSession):
        return await load_specialist_facts_company_full_paid(
            session, company_id=company_id, pipeline_id=pipeline_id, ym=ym,
        )

    async def _q_manual(session: AsyncSession):
        return await load_manual_facts(session, company_id=company_id, pipeline_id=pipeline_id, ym=ym)

    async def _q_bonus(session: AsyncSession):
        return await load_bonus_fund(session, company_id=company_id, pipeline_id=pipeline_id, ym=ym)

    async def _q_prices(session: AsyncSession):
        return await load_kpi_unit_prices_by_label(
            session, company_id=company_id, pipeline_id=pipeline_id, ym=ym,
        )

    async def _q_sales_mode(session: AsyncSession):
        return await company_is_sales_mode(session, company_id)

    async def _run(fn):
        async with AsyncSessionLocal() as session:
            return await fn(session)

    (
        item_specialists,
        managers,
        direction_facts,
        specialist_facts,
        specialist_company_facts,
        manual_facts,
        bonus_fund,
        unit_prices,
        sales_mode,
    ) = await asyncio.gather(
        _run(_q_specialists),
        _run(_q_managers),
        _run(_q_dir_facts),
        _run(_q_spec_facts),
        _run(_q_spec_company),
        _run(_q_manual),
        _run(_q_bonus),
        _run(_q_prices),
        _run(_q_sales_mode),
    )
    # plan_items из текущей сессии — не таскаем в другой AsyncSession
    desk_facts = await load_desk_sale_facts_full_paid(
        db,
        company_id=company_id,
        pipeline_id=pipeline_id,
        ym=ym,
        plan_items=items,
    )
    specialist_to_kpi: dict[int, str] = {}
    for item in items:
        for sid in item_specialists.get(int(item.id), []):
            specialist_to_kpi[sid] = item.name

    # План компании = сумма планов менеджеров (один план на менеджера × число менеджеров).
    n_managers = len(managers)
    plan_lines: list[SalesKpiCompanyPlanLine] = []
    total_contrib = Decimal("0")
    for item in items:
        sids = item_specialists.get(int(item.id), [])
        fact = 0
        if item.source_type == "direction":
            if sids:
                unit_price = unit_prices.get(_norm_kpi_label(item.name))
                fact = sum_specialist_facts_company(
                    specialist_company_facts,
                    specialist_ids=sids,
                    unit_price=unit_price,
                )
            elif item.direction_id is not None:
                for mid, _ in managers:
                    fact += direction_facts.get((mid, int(item.direction_id)), 0)
        else:
            for mid, _ in managers:
                fact += manual_facts.get((mid, int(item.id)), 0)
        for mid, _ in managers:
            fact += desk_facts.get((mid, int(item.id)), 0)
        per_manager_plan = int(item.plan_qty or 0)
        plan_qty = per_manager_plan * n_managers if n_managers > 0 else per_manager_plan
        weight = Decimal(str(item.weight_percent or 0))
        comp = completion_ratio(fact, plan_qty)
        contrib = contribution(comp, weight)
        total_contrib += contrib
        plan_lines.append(
            SalesKpiCompanyPlanLine(
                plan_item_id=int(item.id),
                name=item.name,
                source_type=item.source_type,
                plan_qty=plan_qty,
                weight_percent=weight,
                fact_qty=fact,
                completion=float(comp) if comp is not None else None,
                contribution=contrib,
            ),
        )

    managers_bonus = Decimal("0")
    for mid, mname in managers:
        raw = build_manager_lines(
            manager_id=mid,
            manager_name=mname,
            items=items,
            direction_facts=direction_facts,
            specialist_facts=specialist_facts,
            item_specialists=item_specialists,
            manual_facts=manual_facts,
            desk_facts=desk_facts,
            bonus_fund=bonus_fund,
            unit_price_by_label=unit_prices,
        )
        managers_bonus += Decimal(str(raw["bonus"]))

    revenue_booking = Decimal("0")
    debtor_booking = Decimal("0")
    creditor_total = Decimal("0")
    expert_acc: dict[tuple[int, int], dict] = {}

    if sales_mode:
        desk_rows = (
            await db.execute(
                select(ManagerDeskSale).where(
                    ManagerDeskSale.company_id == company_id,
                    ManagerDeskSale.status == "active",
                    ManagerDeskSale.sold_at >= start,
                    ManagerDeskSale.sold_at < end,
                    or_(
                        ManagerDeskSale.pipeline_id == pipeline_id,
                        ManagerDeskSale.pipeline_id.is_(None),
                    ),
                ),
            )
        ).scalars().all()
        for sale in desk_rows:
            sa = Decimal(str(sale.service_amount or 0))
            pa = Decimal(str(sale.paid_amount or 0))
            revenue_booking += pa
        # Дебиторка продаж — открытый остаток на конец месяца (с переносом прошлых).
        desk_debt_rows = (
            await db.execute(
                select(ManagerDeskSale).where(
                    ManagerDeskSale.company_id == company_id,
                    ManagerDeskSale.status == "active",
                    ManagerDeskSale.sold_at < end,
                    ManagerDeskSale.service_amount > ManagerDeskSale.paid_amount,
                    or_(
                        ManagerDeskSale.pipeline_id == pipeline_id,
                        ManagerDeskSale.pipeline_id.is_(None),
                    ),
                ),
            )
        ).scalars().all()
        for sale in desk_debt_rows:
            sa = Decimal(str(sale.service_amount or 0))
            pa = Decimal(str(sale.paid_amount or 0))
            debtor_booking += max(sa - pa, Decimal("0"))
    else:
        # Только нужные колонки — без полной ORM-сущности на каждую запись месяца.
        appt_rows = (
            await db.execute(
                select(
                    BookingAppointment.id,
                    BookingAppointment.specialist_id,
                    BookingAppointment.service_amount,
                    BookingAppointment.paid_amount,
                    BookingAppointment.status,
                    BookingAppointment.start_at,
                    BookingAppointment.paid_at,
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
                    or_(
                        and_(
                            BookingAppointment.start_at >= start,
                            BookingAppointment.start_at < end,
                        ),
                        and_(
                            BookingAppointment.paid_at.is_not(None),
                            BookingAppointment.paid_at >= start,
                            BookingAppointment.paid_at < end,
                        ),
                    ),
                    or_(
                        BookingAppointment.pipeline_id == pipeline_id,
                        PipelineStage.pipeline_id == pipeline_id,
                        BookingDirection.pipeline_id == pipeline_id,
                    ),
                ),
            )
        ).all()

        month_refunds = await _booking_refund_totals_by_appointment(
            db,
            company_id,
            [int(aid) for aid, *_rest in appt_rows],
        )

        def _ts_in(dt: datetime | None) -> bool:
            if dt is None:
                return False
            if dt.tzinfo is None:
                dt = dt.replace(tzinfo=UTC)
            return start <= dt < end

        for (
            appt_id_raw,
            sid_raw,
            sa_raw,
            pa_raw,
            status_raw,
            start_at,
            paid_at_raw,
            spec_name,
            dir_id,
            dir_name,
        ) in appt_rows:
            sid = int(sid_raw)
            did = int(dir_id) if dir_id is not None else 0
            sa = Decimal(str(sa_raw or 0))
            pa = Decimal(str(pa_raw or 0))
            st = (status_raw or "").strip()
            visit_here = _ts_in(start_at)
            cash_here = _ts_in(paid_at_raw or start_at)
            key = (sid, did)
            if key not in expert_acc:
                expert_acc[key] = {
                    "specialist_id": sid,
                    "specialist_name": str(spec_name or f"#{sid}"),
                    "direction_id": did if did else None,
                    "direction_name": str(dir_name) if dir_name else None,
                    # KPI-метка специалиста (план), не фильтр услуги строки
                    "kpi_service_name": specialist_to_kpi.get(sid),
                    "appointments_total": 0,
                    "appeared_count": 0,
                    "booked_future_count": 0,
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
                if visit_here:
                    bucket["cancelled_count"] += 1
                continue
            if visit_here:
                bucket["appointments_total"] += 1
            # Неявка: долг не ставим, но оплата уже полученная — в выручку кассы.
            if st == "no_show":
                if visit_here:
                    bucket["no_show_count"] += 1
                if cash_here and pa > 0:
                    bucket["paid_no_show_amount"] += pa
                    bucket["revenue_paid"] += pa
                    revenue_booking += pa
            else:
                if cash_here:
                    bucket["revenue_paid"] += pa
                    revenue_booking += pa
                if not visit_here:
                    continue
                # Долг только по явке (completed); «Запись»/будущее/неявка — не дебиторка.
                if st == "completed":
                    debt = _booking_open_debt(
                        sa,
                        pa,
                        month_refunds.get(int(appt_id_raw), Decimal("0")),
                    )
                    if debt > 0:
                        bucket["debtor_amount"] += debt
                    bucket["appeared_count"] += 1
                    if cash_here and (sa <= 0 or pa + Decimal("0.01") >= sa):
                        bucket["paid_full_amount"] += pa
                elif st == "booked":
                    bucket["booked_count"] += 1
                    if start_at is not None and start_at.tzinfo is None:
                        start_at = start_at.replace(tzinfo=UTC)
                    if start_at is not None and start_at > now and pa > 0 and cash_here:
                        cred = pa
                        bucket["creditor_amount"] += cred
                        creditor_total += cred
                        bucket["booked_future_count"] += 1

        # Дебиторка записи: прошедшие явки с остатком (неявка/будущее не входят).
        # Возвраты (ОСВ booking_refund) вычитаем — иначе «оплачено 0» после возврата = ложный долг.
        debt_cutoff = _booking_debt_cutoff(end, now=now)
        open_booking_debt = (
            await db.execute(
                select(
                    BookingAppointment.id,
                    BookingAppointment.service_amount,
                    BookingAppointment.paid_amount,
                )
                .outerjoin(Lead, Lead.id == BookingAppointment.lead_id)
                .outerjoin(PipelineStage, PipelineStage.id == Lead.status_id)
                .outerjoin(BookingDirection, BookingDirection.id == BookingAppointment.direction_id)
                .where(
                    BookingAppointment.company_id == company_id,
                    BookingAppointment.start_at < debt_cutoff,
                    BookingAppointment.service_amount > BookingAppointment.paid_amount,
                    BookingAppointment.status == "completed",
                    or_(
                        BookingAppointment.pipeline_id == pipeline_id,
                        PipelineStage.pipeline_id == pipeline_id,
                        BookingDirection.pipeline_id == pipeline_id,
                    ),
                ),
            )
        ).all()
        open_refunds = await _booking_refund_totals_by_appointment(
            db,
            company_id,
            [int(aid) for aid, _sa, _pa in open_booking_debt],
        )
        debtor_booking = Decimal("0")
        for aid, sa_raw, pa_raw in open_booking_debt:
            sa = Decimal(str(sa_raw or 0))
            pa = Decimal(str(pa_raw or 0))
            debtor_booking += _booking_open_debt(sa, pa, open_refunds.get(int(aid), Decimal("0")))

    # Курсы/протоколы: платежи с paid_at в этом месяце → выручка месяца.
    # KPI менеджера считается отдельно (только первый платёж / sold_at).
    revenue_manual_paid = (
        await db.execute(
            select(func.coalesce(func.sum(SalesKpiManualSalePayment.amount), 0)).where(
                SalesKpiManualSalePayment.company_id == company_id,
                SalesKpiManualSalePayment.paid_at >= start,
                SalesKpiManualSalePayment.paid_at < end,
                SalesKpiManualSalePayment.sale_id.in_(
                    select(SalesKpiManualSale.id).where(
                        SalesKpiManualSale.company_id == company_id,
                        SalesKpiManualSale.pipeline_id == pipeline_id,
                        SalesKpiManualSale.status == "active",
                    ),
                ),
            ),
        )
    ).scalar_one()
    revenue_manual = Decimal(str(revenue_manual_paid or 0))

    # Старые продажи без строк в журнале: один раз относим paid_amount к месяцу sold_at.
    legacy_manual_rows = (
        await db.execute(
            select(SalesKpiManualSale).where(
                SalesKpiManualSale.company_id == company_id,
                SalesKpiManualSale.pipeline_id == pipeline_id,
                SalesKpiManualSale.sold_at >= start,
                SalesKpiManualSale.sold_at < end,
                SalesKpiManualSale.status == "active",
                SalesKpiManualSale.paid_amount > 0,
                ~exists(
                    select(SalesKpiManualSalePayment.id).where(
                        SalesKpiManualSalePayment.sale_id == SalesKpiManualSale.id,
                    ),
                ),
            ),
        )
    ).scalars().all()
    for sale in legacy_manual_rows:
        revenue_manual += Decimal(str(sale.paid_amount or 0))

    manual_debt_sales = (
        await db.execute(
            select(SalesKpiManualSale).where(
                SalesKpiManualSale.company_id == company_id,
                SalesKpiManualSale.pipeline_id == pipeline_id,
                SalesKpiManualSale.sold_at < end,
                SalesKpiManualSale.status == "active",
                SalesKpiManualSale.service_amount > SalesKpiManualSale.paid_amount,
            ),
        )
    ).scalars().all()
    debt_pay = await _load_sale_payments(db, [int(s.id) for s in manual_debt_sales])
    debtor_manual = Decimal("0")
    for sale in manual_debt_sales:
        first_at = first_course_payment_at(sale.sold_at, debt_pay.get(int(sale.id), []))
        if not course_debt_is_due(first_at, _booking_debt_cutoff(end, now=now)):
            continue
        sa = Decimal(str(sale.service_amount or 0))
        pa = Decimal(str(sale.paid_amount or 0))
        debtor_manual += max(sa - pa, Decimal("0"))

    # Эксперты воронки без записей в месяце — тоже покажем 0 (только clinic)
    if not sales_mode:
        specialists_meta = await _load_specialists_meta(db, company_id, pipeline_id)
        seen_specialists = {int(k[0]) for k in expert_acc}
        for s in specialists_meta:
            if s.id not in seen_specialists and s.is_active:
                did = int(s.direction_id) if s.direction_id is not None else 0
                expert_acc[(int(s.id), did)] = {
                    "specialist_id": int(s.id),
                    "specialist_name": s.full_name,
                    "direction_id": did if did else None,
                    "direction_name": s.direction_name,
                    "kpi_service_name": specialist_to_kpi.get(int(s.id)),
                    "appointments_total": 0,
                    "appeared_count": 0,
                    "booked_future_count": 0,
                    "booked_count": 0,
                    "no_show_count": 0,
                    "cancelled_count": 0,
                    "revenue_paid": Decimal("0"),
                    "paid_full_amount": Decimal("0"),
                    "paid_no_show_amount": Decimal("0"),
                    "debtor_amount": Decimal("0"),
                    "creditor_amount": Decimal("0"),
                }

    # Отдельная сводка по услугам (Курс / Курс 15 / Протокол …) — не под экспертом.
    service_acc: dict[int, dict] = {}
    for row in expert_acc.values():
        did = int(row["direction_id"] or 0)
        if did not in service_acc:
            service_acc[did] = {
                "direction_id": row["direction_id"],
                "direction_name": str(row.get("direction_name") or "—"),
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
        s["appointments_total"] += int(row["appointments_total"])
        s["appeared_count"] += int(row["appeared_count"])
        s["no_show_count"] += int(row["no_show_count"])
        s["booked_count"] += int(row.get("booked_count") or 0)
        s["cancelled_count"] += int(row["cancelled_count"])
        s["revenue_paid"] += Decimal(str(row["revenue_paid"]))
        s["paid_full_amount"] += Decimal(str(row["paid_full_amount"]))
        s["paid_no_show_amount"] += Decimal(str(row["paid_no_show_amount"]))
        s["debtor_amount"] += Decimal(str(row["debtor_amount"]))
        s["creditor_amount"] += Decimal(str(row["creditor_amount"]))

    service_stats = [
        SalesKpiCompanyServiceStat(**row)
        for row in sorted(
            service_acc.values(),
            key=lambda x: (-int(x["appointments_total"]), str(x["direction_name"])),
        )
        if int(row["appointments_total"]) > 0 or int(row["cancelled_count"]) > 0
    ]

    # Сводка по эксперту (все услуги вместе) — без вложенных строк услуг.
    expert_roll: dict[int, dict] = {}
    for row in expert_acc.values():
        sid = int(row["specialist_id"])
        if sid not in expert_roll:
            expert_roll[sid] = {
                "specialist_id": sid,
                "specialist_name": row["specialist_name"],
                "direction_id": None,
                "direction_name": None,
                "kpi_service_name": row.get("kpi_service_name"),
                "appointments_total": 0,
                "appeared_count": 0,
                "booked_future_count": 0,
                "no_show_count": 0,
                "cancelled_count": 0,
                "revenue_paid": Decimal("0"),
                "paid_full_amount": Decimal("0"),
                "paid_no_show_amount": Decimal("0"),
                "debtor_amount": Decimal("0"),
                "creditor_amount": Decimal("0"),
            }
        e = expert_roll[sid]
        e["appointments_total"] += int(row["appointments_total"])
        e["appeared_count"] += int(row["appeared_count"])
        e["booked_future_count"] += int(row["booked_future_count"])
        e["no_show_count"] += int(row["no_show_count"])
        e["cancelled_count"] += int(row["cancelled_count"])
        e["revenue_paid"] += Decimal(str(row["revenue_paid"]))
        e["paid_full_amount"] += Decimal(str(row["paid_full_amount"]))
        e["paid_no_show_amount"] += Decimal(str(row["paid_no_show_amount"]))
        e["debtor_amount"] += Decimal(str(row["debtor_amount"]))
        e["creditor_amount"] += Decimal(str(row["creditor_amount"]))

    expert_stats = [
        SalesKpiCompanyExpertStat(**row)
        for row in sorted(
            expert_roll.values(),
            key=lambda x: (-int(x["appointments_total"]), str(x["specialist_name"])),
        )
    ]

    plan_pct = float((total_contrib * Decimal("100")).quantize(Decimal("0.01")))
    # Клиника: итог = касса визитов по дате сдачи (как ОСВ). Курсы KPI не прибавляем:
    # те же деньги уже в оплате визита. В продажах итог = стол + курсы.
    # Возвраты в карточке отдельно — выручку не уменьшают.
    if sales_mode:
        revenue_total = revenue_booking + revenue_manual
    else:
        revenue_total = revenue_booking
    # Дебиторка всегда = остаток визитов + открытые пакеты курсов/протоколов KPI.
    debtor_total = debtor_booking + debtor_manual

    # Возвраты за месяц: онлайн-запись (ОСВ booking_refund) + курсы KPI (status=returned).
    ym_day_from = date(ym.year, ym.month, 1)
    ym_day_to = date(ym.year, ym.month, calendar.monthrange(ym.year, ym.month)[1])
    refund_osv_rows = (
        await db.execute(
            select(FinanceOsvRow.expense, FinanceOsvRow.external_key).where(
                FinanceOsvRow.company_id == company_id,
                FinanceOsvRow.source == "booking_refund",
                FinanceOsvRow.txn_date >= ym_day_from,
                FinanceOsvRow.txn_date <= ym_day_to,
            )
        )
    ).all()
    refund_appt_ids: list[int] = []
    refund_by_key: list[tuple[Decimal, int | None]] = []
    for exp, ext in refund_osv_rows:
        amt = abs(Decimal(str(exp or 0)))
        if amt <= 0:
            continue
        appt_id: int | None = None
        key = (ext or "").strip()
        if key.startswith("booking_refund:"):
            parts = key.split(":")
            if len(parts) >= 2 and parts[1].isdigit():
                appt_id = int(parts[1])
                refund_appt_ids.append(appt_id)
        refund_by_key.append((amt, appt_id))
    appt_pipeline: dict[int, int | None] = {}
    if refund_appt_ids:
        pid_rows = (
            await db.execute(
                select(BookingAppointment.id, BookingAppointment.pipeline_id).where(
                    BookingAppointment.company_id == company_id,
                    BookingAppointment.id.in_(refund_appt_ids),
                )
            )
        ).all()
        appt_pipeline = {int(aid): (int(pid) if pid is not None else None) for aid, pid in pid_rows}
    refunds_booking = Decimal("0")
    for amt, appt_id in refund_by_key:
        if appt_id is None:
            # Без привязки к записи — учитываем в выбранной воронке (обычно одна клиника).
            refunds_booking += amt
            continue
        ap_pipe = appt_pipeline.get(appt_id)
        if ap_pipe is None or ap_pipe == pipeline_id:
            refunds_booking += amt

    refunds_manual = Decimal(
        str(
            (
                await db.scalar(
                    select(func.coalesce(func.sum(SalesKpiManualSale.paid_amount), 0)).where(
                        SalesKpiManualSale.company_id == company_id,
                        SalesKpiManualSale.pipeline_id == pipeline_id,
                        SalesKpiManualSale.status == "returned",
                        SalesKpiManualSale.returned_at.is_not(None),
                        SalesKpiManualSale.returned_at >= start,
                        SalesKpiManualSale.returned_at < end,
                    )
                )
            )
            or 0
        )
    )
    refunds_total = (refunds_booking + refunds_manual).quantize(Decimal("0.01"))
    refunds_booking = refunds_booking.quantize(Decimal("0.01"))
    refunds_manual = refunds_manual.quantize(Decimal("0.01"))

    # Дни месяца для прогноза (линейный run-rate)
    days_in_month = calendar.monthrange(ym.year, ym.month)[1]
    today = now.date()
    if today.year == ym.year and today.month == ym.month:
        days_elapsed = max(1, min(today.day, days_in_month))
        month_phase = "current"
    elif today > date(ym.year, ym.month, days_in_month):
        days_elapsed = days_in_month
        month_phase = "past"
    else:
        days_elapsed = 0
        month_phase = "future"
    month_progress = float(
        (Decimal(days_elapsed) / Decimal(days_in_month) * Decimal("100")).quantize(Decimal("0.1"))
    ) if days_in_month else 0.0

    def _revenue_at_plan_pct(target_pct: float) -> Decimal | None:
        """Грубая оценка: выручка × (target / текущий % плана). Не касса и не прогноз банка."""
        if plan_pct < 0.01 or revenue_total <= 0:
            return None
        # При низком % плана экстраполяция улетает в космос — не показываем.
        if plan_pct < 20 and target_pct >= 100:
            return None
        return (revenue_total * Decimal(str(target_pct)) / Decimal(str(plan_pct))).quantize(Decimal("0.01"))

    if month_phase == "past":
        forecast_pct: float | None = plan_pct
        forecast_rev: Decimal | None = revenue_total
        forecast_note = "Месяц завершён — прогноз равен факту."
    elif month_phase == "future":
        forecast_pct = None
        forecast_rev = None
        forecast_note = "Месяц ещё не начался — прогноз появится после первых продаж."
    else:
        # Линейный прогноз: факт / доля прошедшего месяца
        scale = Decimal(days_in_month) / Decimal(days_elapsed)
        forecast_pct = float((Decimal(str(plan_pct)) * scale).quantize(Decimal("0.01")))
        forecast_rev = (revenue_total * scale).quantize(Decimal("0.01"))
        forecast_note = (
            f"Прогноз до конца месяца: линейно от факта за {days_elapsed} из {days_in_month} дн. "
            f"(темп × {float(scale):.2f})."
        )

    return SalesKpiCompanyReport(
        pipeline_id=pipe.id,
        pipeline_name=pipe.name,
        year_month=ym.isoformat()[:7],
        plan_completion_percent=plan_pct,
        total_contribution=total_contrib,
        revenue_total=revenue_total,
        revenue_booking=revenue_booking,
        revenue_manual=revenue_manual,
        debtor_total=debtor_total,
        debtor_booking=debtor_booking,
        debtor_manual=debtor_manual,
        creditor_total=creditor_total,
        refunds_total=refunds_total,
        refunds_booking=refunds_booking,
        refunds_manual=refunds_manual,
        plan_lines=plan_lines,
        expert_stats=expert_stats,
        service_stats=service_stats,
        managers_sales_bonus_total=managers_bonus.quantize(Decimal("0.01")),
        days_elapsed=days_elapsed,
        days_in_month=days_in_month,
        month_progress_percent=month_progress,
        revenue_at_plan_10_percent=_revenue_at_plan_pct(10),
        revenue_at_plan_25_percent=_revenue_at_plan_pct(25),
        revenue_at_plan_50_percent=_revenue_at_plan_pct(50),
        revenue_at_plan_100_percent=_revenue_at_plan_pct(100),
        forecast_plan_completion_percent=forecast_pct,
        forecast_revenue=forecast_rev,
        forecast_note=forecast_note,
    )
