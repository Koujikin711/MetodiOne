"""Взвешенный KPI: план владельца, отчёт ПРОДАЖИ, курсы/протоколы, дебиторка."""

from __future__ import annotations

from datetime import UTC, datetime
from decimal import Decimal
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import delete, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import CurrentCompanyId, CurrentUser
from app.database import get_db
from app.models import (
    BookingAppointment,
    BookingDirection,
    BookingSpecialist,
    Lead,
    Pipeline,
    PipelineStage,
    SalesKpiManualSale,
    SalesKpiPlanItem,
    SalesKpiPlanItemSpecialist,
    SalesKpiServicePrice,
    SalesKpiWeightedSettings,
    User,
    UserPipelineAssignment,
    UserRole,
)
from app.schemas.sales_kpi import (
    SalesKpiBoardLine,
    SalesKpiBoardManager,
    SalesKpiDebtorRow,
    SalesKpiDebtorsReport,
    SalesKpiDirectionMeta,
    SalesKpiManualSaleCreate,
    SalesKpiManualSaleOut,
    SalesKpiManualSalePaymentPatch,
    SalesKpiPlanItemOut,
    SalesKpiSalesReport,
    SalesKpiSpecialistMeta,
    SalesKpiWeightedPlanOut,
    SalesKpiWeightedPlanPut,
)
from app.services.sales_kpi_weighted import (
    MANUAL_SALE_MIN_PAID_RATIO,
    build_manager_lines,
    load_bonus_fund,
    load_direction_facts_full_paid,
    load_managers,
    load_manual_facts,
    load_plan_item_specialists,
    load_plan_items,
    load_specialist_facts_full_paid,
    month_bounds,
    parse_year_month,
)

router = APIRouter(prefix="/sales-kpi", tags=["sales-kpi"])


def _assert_kpi_access(current_user: CurrentUser) -> None:
    if current_user.role in (UserRole.expert, UserRole.finance_analyst):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Раздел KPI недоступен для этой роли")
    if current_user.role not in (UserRole.owner, UserRole.super_owner, UserRole.manager, UserRole.admin):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Нет доступа к KPI")


def _assert_owner(current_user: CurrentUser) -> None:
    if current_user.role not in (UserRole.owner, UserRole.super_owner):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Только владелец компании")


def _assert_admin_or_owner(current_user: CurrentUser) -> None:
    if current_user.role not in (UserRole.owner, UserRole.super_owner, UserRole.admin):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Только владелец или админ")


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


def _manual_counts_in_kpi(service_amount: Decimal, paid_amount: Decimal, status: str) -> bool:
    if status != "active":
        return False
    if service_amount <= 0:
        return False
    return paid_amount >= (service_amount * MANUAL_SALE_MIN_PAID_RATIO)


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
            bonus_fund=bonus_fund,
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

    items = await load_plan_items(db, company_id=company_id, pipeline_id=pipeline_id, ym=ym)
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

    specialists_meta = await _load_specialists_meta(db, company_id, body.pipeline_id)
    allowed_specialist_ids = {s.id for s in specialists_meta}
    seen_specialists: dict[int, str] = {}

    for raw in body.items:
        st = (raw.source_type or "manual").strip().lower()
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
                    detail=f"Нельзя удалить показатель «{old.name}»: есть продажи. Сначала оформите возвраты/удалите продажи.",
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

    rows = (
        await db.execute(
            select(SalesKpiManualSale, SalesKpiPlanItem.name, User.full_name, User.email)
            .join(SalesKpiPlanItem, SalesKpiPlanItem.id == SalesKpiManualSale.plan_item_id)
            .join(User, User.id == SalesKpiManualSale.manager_user_id)
            .where(
                SalesKpiManualSale.company_id == company_id,
                SalesKpiManualSale.pipeline_id == pipeline_id,
                SalesKpiManualSale.sold_at >= start,
                SalesKpiManualSale.sold_at < end,
            )
            .order_by(SalesKpiManualSale.sold_at.desc(), SalesKpiManualSale.id.desc()),
        )
    ).all()

    out: list[SalesKpiManualSaleOut] = []
    for sale, item_name, full_name, email in rows:
        sa = Decimal(str(sale.service_amount or 0))
        pa = Decimal(str(sale.paid_amount or 0))
        out.append(
            SalesKpiManualSaleOut(
                id=int(sale.id),
                pipeline_id=int(sale.pipeline_id),
                plan_item_id=int(sale.plan_item_id),
                plan_item_name=str(item_name),
                manager_user_id=int(sale.manager_user_id),
                manager_name=str(full_name or email or f"#{sale.manager_user_id}"),
                client_name=sale.client_name,
                client_phone=sale.client_phone,
                service_amount=sa,
                paid_amount=pa,
                debt_amount=max(sa - pa, Decimal("0")),
                sold_at=sale.sold_at,
                status=sale.status,
                returned_at=sale.returned_at,
                note=sale.note,
                counts_in_kpi=_manual_counts_in_kpi(sa, pa, sale.status),
            ),
        )
    return out


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
        raise HTTPException(status_code=400, detail="Показатель плана не найден")
    if item.source_type != "manual":
        raise HTTPException(status_code=400, detail="Этот показатель берётся из онлайн-записи, не из формы курса/протокола")

    manager = await db.get(User, body.manager_user_id)
    if manager is None or manager.company_id != company_id or manager.role != UserRole.manager:
        raise HTTPException(status_code=400, detail="Укажите менеджера компании")
    if not await _is_user_assigned_pipeline(db, company_id, body.manager_user_id, body.pipeline_id):
        raise HTTPException(status_code=400, detail="Менеджер не назначен на воронку")

    if body.paid_amount > body.service_amount:
        raise HTTPException(status_code=400, detail="Оплата не может быть больше стоимости")

    sold_at = body.sold_at or datetime.now(UTC)
    if sold_at.tzinfo is None:
        sold_at = sold_at.replace(tzinfo=UTC)

    sale = SalesKpiManualSale(
        company_id=company_id,
        pipeline_id=body.pipeline_id,
        plan_item_id=body.plan_item_id,
        manager_user_id=body.manager_user_id,
        client_name=body.client_name.strip(),
        client_phone=body.client_phone.strip(),
        service_amount=body.service_amount,
        paid_amount=body.paid_amount,
        sold_at=sold_at,
        status="active",
        note=body.note,
        created_by_user_id=current_user.id,
    )
    db.add(sale)
    await db.commit()
    await db.refresh(sale)

    sa = Decimal(str(sale.service_amount))
    pa = Decimal(str(sale.paid_amount))
    return SalesKpiManualSaleOut(
        id=int(sale.id),
        pipeline_id=int(sale.pipeline_id),
        plan_item_id=int(sale.plan_item_id),
        plan_item_name=item.name,
        manager_user_id=int(sale.manager_user_id),
        manager_name=str(manager.full_name or manager.email or f"#{manager.id}"),
        client_name=sale.client_name,
        client_phone=sale.client_phone,
        service_amount=sa,
        paid_amount=pa,
        debt_amount=max(sa - pa, Decimal("0")),
        sold_at=sale.sold_at,
        status=sale.status,
        returned_at=sale.returned_at,
        note=sale.note,
        counts_in_kpi=_manual_counts_in_kpi(sa, pa, sale.status),
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
    if body.paid_amount > sale.service_amount:
        raise HTTPException(status_code=400, detail="Оплата не может быть больше стоимости")

    sale.paid_amount = body.paid_amount
    sale.updated_at = datetime.now(UTC)
    if body.note is not None:
        sale.note = body.note
    await db.commit()
    await db.refresh(sale)

    item = await db.get(SalesKpiPlanItem, sale.plan_item_id)
    manager = await db.get(User, sale.manager_user_id)
    sa = Decimal(str(sale.service_amount))
    pa = Decimal(str(sale.paid_amount))
    return SalesKpiManualSaleOut(
        id=int(sale.id),
        pipeline_id=int(sale.pipeline_id),
        plan_item_id=int(sale.plan_item_id),
        plan_item_name=item.name if item else "",
        manager_user_id=int(sale.manager_user_id),
        manager_name=str((manager.full_name if manager else None) or (manager.email if manager else None) or f"#{sale.manager_user_id}"),
        client_name=sale.client_name,
        client_phone=sale.client_phone,
        service_amount=sa,
        paid_amount=pa,
        debt_amount=max(sa - pa, Decimal("0")),
        sold_at=sale.sold_at,
        status=sale.status,
        returned_at=sale.returned_at,
        note=sale.note,
        counts_in_kpi=_manual_counts_in_kpi(sa, pa, sale.status),
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
    sa = Decimal(str(sale.service_amount))
    pa = Decimal(str(sale.paid_amount))
    return SalesKpiManualSaleOut(
        id=int(sale.id),
        pipeline_id=int(sale.pipeline_id),
        plan_item_id=int(sale.plan_item_id),
        plan_item_name=item.name if item else "",
        manager_user_id=int(sale.manager_user_id),
        manager_name=str((manager.full_name if manager else None) or (manager.email if manager else None) or f"#{sale.manager_user_id}"),
        client_name=sale.client_name,
        client_phone=sale.client_phone,
        service_amount=sa,
        paid_amount=pa,
        debt_amount=max(sa - pa, Decimal("0")),
        sold_at=sale.sold_at,
        status=sale.status,
        returned_at=sale.returned_at,
        note=sale.note,
        counts_in_kpi=False,
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
    _assert_admin_or_owner(current_user)
    pipe = await _load_pipeline(db, company_id, pipeline_id)
    try:
        ym = parse_year_month(year_month)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    start, end = month_bounds(ym)

    rows_out: list[SalesKpiDebtorRow] = []

    booking_q = (
        await db.execute(
            select(BookingAppointment, BookingDirection.name, Lead.manager_id)
            .join(BookingDirection, BookingDirection.id == BookingAppointment.direction_id)
            .join(Lead, Lead.id == BookingAppointment.lead_id, isouter=True)
            .join(PipelineStage, PipelineStage.id == Lead.status_id, isouter=True)
            .where(
                BookingAppointment.company_id == company_id,
                BookingAppointment.start_at >= start,
                BookingAppointment.start_at < end,
                BookingAppointment.service_amount > BookingAppointment.paid_amount,
                or_(
                    BookingAppointment.pipeline_id == pipeline_id,
                    PipelineStage.pipeline_id == pipeline_id,
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

    manual_q = (
        await db.execute(
            select(SalesKpiManualSale, SalesKpiPlanItem.name)
            .join(SalesKpiPlanItem, SalesKpiPlanItem.id == SalesKpiManualSale.plan_item_id)
            .where(
                SalesKpiManualSale.company_id == company_id,
                SalesKpiManualSale.pipeline_id == pipeline_id,
                SalesKpiManualSale.sold_at >= start,
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

    for appt, dname, lead_mgr in booking_q:
        sa = Decimal(str(appt.service_amount or 0))
        pa = Decimal(str(appt.paid_amount or 0))
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
                debt_amount=max(sa - pa, Decimal("0")),
                status="debt",
            ),
        )

    for sale, item_name in manual_q:
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
    return SalesKpiDebtorsReport(
        pipeline_id=pipe.id,
        pipeline_name=pipe.name,
        year_month=ym.isoformat()[:7],
        rows=rows_out,
        total_debt=total,
    )
