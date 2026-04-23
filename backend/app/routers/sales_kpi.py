"""KPI продаж: матрица план/факт по услугам и менеджерам."""

from __future__ import annotations

import calendar
from datetime import UTC, date, datetime
from decimal import Decimal
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import delete, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import CurrentCompanyId, CurrentUser
from app.database import get_db
from app.models import (
    BookingAppointment,
    BookingDirection,
    Lead,
    Pipeline,
    PipelineStage,
    SalesKpiServicePlan,
    SalesKpiServicePrice,
    User,
    UserPipelineAssignment,
    UserRole,
)
from app.schemas.sales_kpi import (
    SalesKpiDirectionMeta,
    SalesKpiLeadPriceHint,
    SalesKpiManagerCell,
    SalesKpiManagerMatrix,
    SalesKpiManagerRow,
    SalesKpiMatrixPut,
    SalesKpiOwnerMatrix,
    SalesKpiPipelineMeta,
    SalesKpiPriceHint,
)
from app.services.sales_kpi import get_kpi_service_price, month_start_from_datetime

router = APIRouter(prefix="/sales-kpi", tags=["sales-kpi"])


def _parse_year_month(s: str) -> date:
    t = (s or "").strip()
    if len(t) == 7 and t[4] == "-":
        y, m = int(t[:4]), int(t[5:7])
        if 1 <= m <= 12:
            return date(y, m, 1)
    raise ValueError("year_month: ожидается YYYY-MM")


def _month_bounds(ym: date) -> tuple[datetime, datetime]:
    start = datetime(ym.year, ym.month, 1, tzinfo=UTC)
    if ym.month == 12:
        end = datetime(ym.year + 1, 1, 1, tzinfo=UTC)
    else:
        end = datetime(ym.year, ym.month + 1, 1, tzinfo=UTC)
    return start, end


def _assert_kpi_access(current_user: CurrentUser) -> None:
    if current_user.role in (UserRole.expert, UserRole.finance_analyst):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Раздел KPI недоступен для этой роли")
    if current_user.role not in (UserRole.owner, UserRole.super_owner, UserRole.manager, UserRole.admin):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Нет доступа к KPI")


def _manager_expr():
    return func.coalesce(BookingAppointment.responsible_manager_id, Lead.manager_id)


async def _load_pipeline(db: AsyncSession, company_id: int, pipeline_id: int) -> Pipeline:
    pipe = await db.get(Pipeline, pipeline_id)
    if pipe is None or pipe.company_id != company_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Воронка не найдена")
    return pipe


async def _is_user_assigned_pipeline(db: AsyncSession, company_id: int, user_id: int, pipeline_id: int) -> bool:
    n = await db.scalar(
        select(func.count(UserPipelineAssignment.id)).where(
            UserPipelineAssignment.company_id == company_id,
            UserPipelineAssignment.user_id == user_id,
            UserPipelineAssignment.pipeline_id == pipeline_id,
        ),
    )
    return int(n or 0) > 0


def _pct(part: Decimal, total: Decimal) -> float | None:
    if total <= 0:
        return None
    return float((part / total * Decimal("100")).quantize(Decimal("0.01")))


@router.get("/pipelines", response_model=list[SalesKpiPipelineMeta])
async def list_kpi_pipelines(
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentUser,
    company_id: CurrentCompanyId,
) -> list[SalesKpiPipelineMeta]:
    _assert_kpi_access(current_user)
    q = (
        select(Pipeline, User.full_name, User.email)
        .join(User, User.id == Pipeline.expert_user_id, isouter=True)
        .where(Pipeline.company_id == company_id)
        .order_by(Pipeline.name.asc())
    )
    if current_user.role in (UserRole.manager, UserRole.admin):
        q = q.join(
            UserPipelineAssignment,
            (UserPipelineAssignment.pipeline_id == Pipeline.id)
            & (UserPipelineAssignment.user_id == current_user.id)
            & (UserPipelineAssignment.company_id == company_id),
        )
    rows = (await db.execute(q)).all()
    return [
        SalesKpiPipelineMeta(
            id=int(p.id),
            name=p.name,
            expert_user_id=p.expert_user_id,
            expert_name=(full_name or email) if (full_name or email) else None,
        )
        for p, full_name, email in rows
    ]


async def _load_directions_for_pipeline(
    db: AsyncSession,
    company_id: int,
    pipeline_id: int,
    ym: date,
) -> list[SalesKpiDirectionMeta]:
    all_dir_rows = (
        await db.execute(
            select(BookingDirection.id, BookingDirection.name)
            .where(BookingDirection.company_id == company_id, BookingDirection.is_active.is_(True))
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
    out: list[SalesKpiDirectionMeta] = []
    for direction_id, direction_name in all_dir_rows:
        did = int(direction_id)
        out.append(
            SalesKpiDirectionMeta(
                direction_id=did,
                direction_name=str(direction_name),
                unit_price=price_map.get(did, Decimal("0")),
            ),
        )
    return out


async def _load_facts(
    db: AsyncSession,
    company_id: int,
    pipeline_id: int,
    ym: date,
) -> dict[tuple[int, int], int]:
    start, end = _month_bounds(ym)
    rows = (
        await db.execute(
            select(
                _manager_expr(),
                BookingAppointment.direction_id,
                func.count(BookingAppointment.id),
            )
            .select_from(BookingAppointment)
            .join(Lead, Lead.id == BookingAppointment.lead_id, isouter=True)
            .join(PipelineStage, PipelineStage.id == Lead.status_id, isouter=True)
            .where(
                BookingAppointment.company_id == company_id,
                BookingAppointment.start_at >= start,
                BookingAppointment.start_at < end,
                or_(
                    BookingAppointment.pipeline_id == pipeline_id,
                    PipelineStage.pipeline_id == pipeline_id,
                ),
            )
            .group_by(_manager_expr(), BookingAppointment.direction_id),
        )
    ).all()
    out: dict[tuple[int, int], int] = {}
    for manager_id, direction_id, cnt in rows:
        if manager_id is None:
            continue
        out[(int(manager_id), int(direction_id))] = int(cnt or 0)
    return out


async def _load_plan_qtys(
    db: AsyncSession,
    company_id: int,
    pipeline_id: int,
    ym: date,
) -> dict[tuple[int, int], int]:
    rows = (
        await db.execute(
            select(
                SalesKpiServicePlan.manager_user_id,
                SalesKpiServicePlan.direction_id,
                SalesKpiServicePlan.plan_qty,
            ).where(
                SalesKpiServicePlan.company_id == company_id,
                SalesKpiServicePlan.pipeline_id == pipeline_id,
                SalesKpiServicePlan.year_month == ym,
            ),
        )
    ).all()
    return {(int(mid), int(did)): int(qty or 0) for mid, did, qty in rows}


@router.get("/owner-matrix", response_model=SalesKpiOwnerMatrix)
async def owner_matrix(
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentUser,
    company_id: CurrentCompanyId,
    pipeline_id: int = Query(..., ge=1),
    year_month: str = Query(..., description="YYYY-MM"),
) -> SalesKpiOwnerMatrix:
    _assert_kpi_access(current_user)
    if current_user.role not in (UserRole.owner, UserRole.super_owner):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Только владелец компании")
    pipe = await _load_pipeline(db, company_id, pipeline_id)
    try:
        ym = _parse_year_month(year_month)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e

    directions = await _load_directions_for_pipeline(db, company_id, pipeline_id, ym)
    price_by_dir = {d.direction_id: d.unit_price for d in directions}
    fact_map = await _load_facts(db, company_id, pipeline_id, ym)
    plan_qty_map = await _load_plan_qtys(db, company_id, pipeline_id, ym)

    manager_rows = (
        await db.execute(
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
            .order_by(User.full_name.asc().nulls_last(), User.email.asc()),
        )
    ).all()

    managers: list[SalesKpiManagerRow] = []
    for manager_id, full_name, email in manager_rows:
        mid = int(manager_id)
        manager_name = (full_name or email or f"#{mid}")
        cells: list[SalesKpiManagerCell] = []
        total_plan = Decimal("0")
        total_actual = Decimal("0")
        for d in directions:
            plan_qty = plan_qty_map.get((mid, d.direction_id), 0)
            plan_amount = (Decimal(plan_qty) * d.unit_price).quantize(Decimal("0.01"))
            actual_count = fact_map.get((mid, d.direction_id), 0)
            actual_paid = (Decimal(actual_count) * d.unit_price).quantize(Decimal("0.01"))
            total_plan += plan_amount
            total_actual += actual_paid
            cells.append(
                SalesKpiManagerCell(
                    direction_id=d.direction_id,
                    plan_qty=plan_qty,
                    plan_amount=plan_amount,
                    actual_paid=actual_paid,
                    actual_count=actual_count,
                    progress_percent=_pct(actual_paid, plan_amount),
                )
            )
        managers.append(
            SalesKpiManagerRow(
                manager_id=mid,
                manager_name=manager_name,
                total_plan_amount=total_plan,
                total_actual_paid=total_actual,
                total_progress_percent=_pct(total_actual, total_plan),
                cells=cells,
            )
        )

    return SalesKpiOwnerMatrix(
        pipeline_id=pipe.id,
        pipeline_name=pipe.name,
        year_month=ym.isoformat()[:7],
        directions=directions,
        managers=managers,
    )


@router.get("/manager-matrix", response_model=SalesKpiManagerMatrix)
async def manager_matrix(
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentUser,
    company_id: CurrentCompanyId,
    pipeline_id: int = Query(..., ge=1),
    year_month: str = Query(..., description="YYYY-MM"),
) -> SalesKpiManagerMatrix:
    _assert_kpi_access(current_user)
    if current_user.role not in (UserRole.manager, UserRole.admin):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Только менеджер или админ воронки")
    pipe = await _load_pipeline(db, company_id, pipeline_id)
    if not await _is_user_assigned_pipeline(db, company_id, current_user.id, pipeline_id):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Вы не назначены на эту воронку")
    try:
        ym = _parse_year_month(year_month)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e

    directions = await _load_directions_for_pipeline(db, company_id, pipeline_id, ym)
    fact_map = await _load_facts(db, company_id, pipeline_id, ym)
    plan_qty_map = await _load_plan_qtys(db, company_id, pipeline_id, ym)
    cells: list[SalesKpiManagerCell] = []
    total_plan = Decimal("0")
    total_actual = Decimal("0")
    for d in directions:
        plan_qty = plan_qty_map.get((current_user.id, d.direction_id), 0)
        plan_amount = (Decimal(plan_qty) * d.unit_price).quantize(Decimal("0.01"))
        actual_count = fact_map.get((current_user.id, d.direction_id), 0)
        actual_paid = (Decimal(actual_count) * d.unit_price).quantize(Decimal("0.01"))
        total_plan += plan_amount
        total_actual += actual_paid
        cells.append(
            SalesKpiManagerCell(
                direction_id=d.direction_id,
                plan_qty=plan_qty,
                plan_amount=plan_amount,
                actual_paid=actual_paid,
                actual_count=actual_count,
                progress_percent=_pct(actual_paid, plan_amount),
            )
        )

    manager_name = (current_user.full_name or current_user.email or f"#{current_user.id}")
    return SalesKpiManagerMatrix(
        pipeline_id=pipe.id,
        pipeline_name=pipe.name,
        year_month=ym.isoformat()[:7],
        directions=directions,
        manager=SalesKpiManagerRow(
            manager_id=current_user.id,
            manager_name=manager_name,
            total_plan_amount=total_plan,
            total_actual_paid=total_actual,
            total_progress_percent=_pct(total_actual, total_plan),
            cells=cells,
        ),
    )


@router.put("/matrix", status_code=status.HTTP_204_NO_CONTENT)
async def put_matrix(
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentUser,
    company_id: CurrentCompanyId,
    body: SalesKpiMatrixPut,
) -> None:
    _assert_kpi_access(current_user)
    if current_user.role not in (UserRole.owner, UserRole.super_owner):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Только владелец компании")
    pipe = await _load_pipeline(db, company_id, body.pipeline_id)
    try:
        ym = _parse_year_month(body.year_month)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e

    await db.execute(
        delete(SalesKpiServicePrice).where(
            SalesKpiServicePrice.company_id == company_id,
            SalesKpiServicePrice.pipeline_id == body.pipeline_id,
            SalesKpiServicePrice.year_month == ym,
        )
    )
    await db.execute(
        delete(SalesKpiServicePlan).where(
            SalesKpiServicePlan.company_id == company_id,
            SalesKpiServicePlan.pipeline_id == body.pipeline_id,
            SalesKpiServicePlan.year_month == ym,
        )
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
            )
        )

    for m in body.managers:
        u = await db.get(User, m.manager_user_id)
        if u is None or u.company_id != company_id:
            raise HTTPException(status_code=400, detail=f"Пользователь {m.manager_user_id} не найден в компании")
        if not await _is_user_assigned_pipeline(db, company_id, m.manager_user_id, body.pipeline_id):
            raise HTTPException(
                status_code=400,
                detail=f"Менеджер {m.manager_user_id} не назначен на выбранную воронку",
            )
        for c in m.cells:
            if c.plan_qty <= 0:
                continue
            d = await db.get(BookingDirection, c.direction_id)
            if d is None or d.company_id != company_id:
                raise HTTPException(status_code=400, detail=f"Неизвестное направление: {c.direction_id}")
            db.add(
                SalesKpiServicePlan(
                    company_id=company_id,
                    pipeline_id=body.pipeline_id,
                    year_month=ym,
                    manager_user_id=m.manager_user_id,
                    direction_id=c.direction_id,
                    plan_qty=c.plan_qty,
                    expert_user_id=pipe.expert_user_id,
                )
            )

    await db.commit()


@router.get("/price-hint", response_model=SalesKpiPriceHint)
async def price_hint(
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentUser,
    company_id: CurrentCompanyId,
    pipeline_id: int = Query(..., ge=1),
    direction_id: int = Query(..., ge=1),
    start_at: datetime = Query(...),
) -> SalesKpiPriceHint:
    _assert_kpi_access(current_user)
    pipe = await _load_pipeline(db, company_id, pipeline_id)
    _ = pipe
    direction = await db.get(BookingDirection, direction_id)
    if direction is None or direction.company_id != company_id:
        raise HTTPException(status_code=404, detail="Направление не найдено")
    fixed = await get_kpi_service_price(
        db,
        company_id=company_id,
        pipeline_id=pipeline_id,
        direction_id=direction_id,
        at_datetime=start_at if start_at.tzinfo else start_at.replace(tzinfo=UTC),
    )
    ym = month_start_from_datetime(start_at if start_at.tzinfo else start_at.replace(tzinfo=UTC))
    return SalesKpiPriceHint(
        fixed_price=fixed,
        year_month=ym.isoformat()[:7],
        direction_id=direction_id,
        direction_name=direction.name,
        start_at=start_at,
    )


@router.get("/lead-price-hint", response_model=SalesKpiLeadPriceHint)
async def lead_price_hint(
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentUser,
    company_id: CurrentCompanyId,
    lead_id: int = Query(..., ge=1),
) -> SalesKpiLeadPriceHint:
    _assert_kpi_access(current_user)
    lead = await db.get(Lead, lead_id)
    if lead is None or lead.company_id != company_id:
        raise HTTPException(status_code=404, detail="Лид не найден")
    await db.refresh(lead, ["stage"])
    pipeline_id = lead.stage.pipeline_id if lead.stage else None
    if pipeline_id is None:
        return SalesKpiLeadPriceHint(fixed_price=None, year_month=datetime.now(UTC).strftime("%Y-%m"))
    last_appt = (
        await db.execute(
            select(BookingAppointment)
            .where(
                BookingAppointment.company_id == company_id,
                BookingAppointment.lead_id == lead_id,
                BookingAppointment.direction_id.is_not(None),
            )
            .order_by(BookingAppointment.start_at.desc(), BookingAppointment.id.desc())
            .limit(1),
        )
    ).scalars().first()
    if last_appt is None:
        return SalesKpiLeadPriceHint(fixed_price=None, year_month=datetime.now(UTC).strftime("%Y-%m"))
    at_dt = last_appt.start_at if last_appt.start_at.tzinfo else last_appt.start_at.replace(tzinfo=UTC)
    fixed = await get_kpi_service_price(
        db,
        company_id=company_id,
        pipeline_id=int(pipeline_id),
        direction_id=int(last_appt.direction_id),
        at_datetime=at_dt,
    )
    direction = await db.get(BookingDirection, int(last_appt.direction_id))
    ym = month_start_from_datetime(at_dt)
    return SalesKpiLeadPriceHint(
        fixed_price=fixed,
        year_month=ym.isoformat()[:7],
        direction_id=int(last_appt.direction_id),
        direction_name=direction.name if direction else None,
    )
