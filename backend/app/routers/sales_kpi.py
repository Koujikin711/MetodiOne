"""KPI продаж: план по воронке (эксперт) и менеджерам, факт по оплатам записей за месяц."""

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
    SalesKpiPlan,
    User,
    UserPipelineAssignment,
    UserRole,
)
from app.schemas.sales_kpi import (
    SalesKpiManagerOwnerRow,
    SalesKpiManagerSnapshot,
    SalesKpiOwnerDashboard,
    SalesKpiPipelineMeta,
    SalesKpiPlansPut,
    SalesKpiServiceSlice,
)

router = APIRouter(prefix="/sales-kpi", tags=["sales-kpi"])


def _parse_year_month(s: str) -> date:
    t = (s or "").strip()
    if len(t) == 7 and t[4] == "-":
        y, m = int(t[:4]), int(t[5:7])
        if 1 <= m <= 12:
            return date(y, m, 1)
    raise ValueError("year_month: ожидается YYYY-MM")


def _month_range(ym: date) -> tuple[datetime, datetime]:
    y, m = ym.year, ym.month
    start = datetime(y, m, 1, tzinfo=UTC)
    if m == 12:
        end = datetime(y + 1, 1, 1, tzinfo=UTC)
    else:
        end = datetime(y, m + 1, 1, tzinfo=UTC)
    return start, end


def _days_in_month(ym: date) -> int:
    return calendar.monthrange(ym.year, ym.month)[1]


def _elapsed_days_for_pacing(ym: date, today: date) -> int:
    if (today.year, today.month) < (ym.year, ym.month):
        return 0
    if (today.year, today.month) > (ym.year, ym.month):
        return _days_in_month(ym)
    return min(today.day, _days_in_month(ym))


def _assert_kpi_access(current_user: CurrentUser) -> None:
    if current_user.role == UserRole.finance_analyst:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Раздел KPI недоступен для этой роли")
    if current_user.role == UserRole.expert:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Раздел KPI недоступен для эксперта")
    if current_user.role not in (
        UserRole.owner,
        UserRole.manager,
        UserRole.admin,
        UserRole.super_owner,
    ):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Нет доступа к KPI")


async def _load_pipeline(db: AsyncSession, company_id: int, pipeline_id: int) -> Pipeline:
    pipe = await db.get(Pipeline, pipeline_id)
    if pipe is None or pipe.company_id != company_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Воронка не найдена")
    return pipe


async def _user_assigned_to_pipeline(
    db: AsyncSession, company_id: int, user_id: int, pipeline_id: int
) -> bool:
    n = await db.scalar(
        select(func.count(UserPipelineAssignment.id)).where(
            UserPipelineAssignment.company_id == company_id,
            UserPipelineAssignment.user_id == user_id,
            UserPipelineAssignment.pipeline_id == pipeline_id,
        ),
    )
    return int(n or 0) > 0


def _manager_expr():
    return func.coalesce(BookingAppointment.responsible_manager_id, Lead.manager_id)


async def _paid_by_manager_and_direction(
    db: AsyncSession,
    company_id: int,
    pipeline_id: int,
    start: datetime,
    end: datetime,
) -> list[tuple[int | None, int, str, Decimal]]:
    rows = (
        await db.execute(
            select(
                _manager_expr(),
                BookingDirection.id,
                BookingDirection.name,
                func.coalesce(func.sum(BookingAppointment.paid_amount), 0),
            )
            .select_from(BookingAppointment)
            .join(BookingDirection, BookingDirection.id == BookingAppointment.direction_id)
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
            .group_by(_manager_expr(), BookingDirection.id, BookingDirection.name),
        )
    ).all()
    out: list[tuple[int | None, int, str, Decimal]] = []
    for mgr_id, did, dname, paid in rows:
        out.append((mgr_id, int(did), str(dname or ""), Decimal(str(paid or 0))))
    return out


def _pct(numer: Decimal, denom: Decimal) -> float | None:
    if denom <= 0:
        return None
    return float((numer / denom * Decimal("100")).quantize(Decimal("0.01")))


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
            expert_name=(fn or em) if (fn or em) else None,
        )
        for p, fn, em in rows
    ]


@router.get("/manager", response_model=SalesKpiManagerSnapshot)
async def kpi_manager_snapshot(
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentUser,
    company_id: CurrentCompanyId,
    pipeline_id: int = Query(..., ge=1),
    year_month: str = Query(..., description="YYYY-MM"),
) -> SalesKpiManagerSnapshot:
    _assert_kpi_access(current_user)
    if current_user.role in (UserRole.owner, UserRole.super_owner):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Для владельца используйте /sales-kpi/owner-dashboard",
        )
    pipe = await _load_pipeline(db, company_id, pipeline_id)
    if not await _user_assigned_to_pipeline(db, company_id, current_user.id, pipeline_id):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Вы не назначены на эту воронку")

    try:
        ym = _parse_year_month(year_month)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    start, end = _month_range(ym)
    days = _days_in_month(ym)
    today = datetime.now(UTC).date()
    elapsed = _elapsed_days_for_pacing(ym, today)

    expert = await db.get(User, pipe.expert_user_id) if pipe.expert_user_id else None
    expert_name = (expert.full_name or expert.email) if expert else None

    plan_row = (
        await db.execute(
            select(SalesKpiPlan).where(
                SalesKpiPlan.company_id == company_id,
                SalesKpiPlan.pipeline_id == pipeline_id,
                SalesKpiPlan.year_month == ym,
                SalesKpiPlan.manager_user_id == current_user.id,
            ),
        )
    ).scalar_one_or_none()
    plan_amount: Decimal | None = None
    if plan_row is not None:
        plan_amount = Decimal(str(plan_row.plan_amount))

    slices = await _paid_by_manager_and_direction(db, company_id, pipeline_id, start, end)
    actual = Decimal("0")
    for mgr_id, _d, _n, paid in slices:
        if mgr_id == current_user.id:
            actual += paid

    linear_target = Decimal("0")
    if plan_amount is not None and plan_amount > 0 and days > 0 and elapsed > 0:
        linear_target = (plan_amount * Decimal(elapsed) / Decimal(days)).quantize(Decimal("0.01"))

    daily = (plan_amount / Decimal(days)).quantize(Decimal("0.01")) if plan_amount and days else Decimal("0")

    return SalesKpiManagerSnapshot(
        pipeline_id=pipe.id,
        pipeline_name=pipe.name,
        expert_user_id=pipe.expert_user_id,
        expert_name=expert_name,
        year_month=ym.isoformat()[:7],
        days_in_month=days,
        elapsed_days_for_pacing=elapsed,
        daily_plan=daily,
        plan_amount=plan_amount,
        actual_paid=actual,
        month_progress_percent=_pct(actual, plan_amount) if plan_amount is not None else None,
        linear_target_to_date=linear_target,
        pace_percent=_pct(actual, linear_target) if linear_target > 0 else None,
    )


@router.get("/owner-dashboard", response_model=SalesKpiOwnerDashboard)
async def kpi_owner_dashboard(
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentUser,
    company_id: CurrentCompanyId,
    pipeline_id: int = Query(..., ge=1),
    year_month: str = Query(..., description="YYYY-MM"),
) -> SalesKpiOwnerDashboard:
    _assert_kpi_access(current_user)
    if current_user.role not in (UserRole.owner, UserRole.super_owner):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Только владелец компании")

    pipe = await _load_pipeline(db, company_id, pipeline_id)
    try:
        ym = _parse_year_month(year_month)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    start, end = _month_range(ym)
    days = _days_in_month(ym)
    today = datetime.now(UTC).date()
    elapsed = _elapsed_days_for_pacing(ym, today)

    expert = await db.get(User, pipe.expert_user_id) if pipe.expert_user_id else None
    expert_name = (expert.full_name or expert.email) if expert else None

    mgr_rows = (
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

    manager_ids = {int(r[0]) for r in mgr_rows}

    plan_rows = (
        await db.execute(
            select(SalesKpiPlan).where(
                SalesKpiPlan.company_id == company_id,
                SalesKpiPlan.pipeline_id == pipeline_id,
                SalesKpiPlan.year_month == ym,
            ),
        )
    ).scalars().all()
    plan_by_mgr: dict[int, Decimal] = {int(p.manager_user_id): Decimal(str(p.plan_amount)) for p in plan_rows}

    slices = await _paid_by_manager_and_direction(db, company_id, pipeline_id, start, end)
    actual_by_mgr: dict[int, Decimal] = {}
    by_mgr_dir: dict[int, dict[int, tuple[str, Decimal]]] = {}
    for mgr_id, did, dname, paid in slices:
        if mgr_id is None:
            continue
        mid = int(mgr_id)
        actual_by_mgr[mid] = actual_by_mgr.get(mid, Decimal("0")) + paid
        by_mgr_dir.setdefault(mid, {})[did] = (dname, paid)

    for mid, amt in list(actual_by_mgr.items()):
        if mid not in manager_ids and amt > 0:
            u = await db.get(User, mid)
            if u is not None and u.company_id == company_id:
                mgr_rows.append((u.id, u.full_name, u.email))
                manager_ids.add(mid)

    managers_out: list[SalesKpiManagerOwnerRow] = []
    for mid, fn, em in sorted(mgr_rows, key=lambda x: ((x[1] or x[2] or "").lower(), x[0])):
        mid_i = int(mid)
        name = fn or em or f"#{mid_i}"
        plan_amt = plan_by_mgr.get(mid_i, Decimal("0"))
        act = actual_by_mgr.get(mid_i, Decimal("0"))
        linear_target = Decimal("0")
        if plan_amt > 0 and days > 0 and elapsed > 0:
            linear_target = (plan_amt * Decimal(elapsed) / Decimal(days)).quantize(Decimal("0.01"))

        svc_slices: list[SalesKpiServiceSlice] = []
        for did, (dname, paid) in sorted(
            by_mgr_dir.get(mid_i, {}).items(),
            key=lambda x: (-x[1][1], x[1][0]),
        ):
            svc_slices.append(
                SalesKpiServiceSlice(
                    direction_id=did,
                    direction_name=dname,
                    paid_amount=paid,
                    percent_of_plan=_pct(paid, plan_amt) if plan_amt > 0 else None,
                ),
            )

        managers_out.append(
            SalesKpiManagerOwnerRow(
                manager_id=mid_i,
                manager_name=name,
                plan_amount=plan_amt,
                actual_paid=act,
                month_progress_percent=_pct(act, plan_amt) if plan_amt > 0 else None,
                linear_target_to_date=linear_target,
                pace_percent=_pct(act, linear_target) if linear_target > 0 else None,
                by_service=svc_slices,
            ),
        )

    return SalesKpiOwnerDashboard(
        pipeline_id=pipe.id,
        pipeline_name=pipe.name,
        expert_user_id=pipe.expert_user_id,
        expert_name=expert_name,
        year_month=ym.isoformat()[:7],
        days_in_month=days,
        elapsed_days_for_pacing=elapsed,
        managers=managers_out,
    )


@router.put("/plans", status_code=status.HTTP_204_NO_CONTENT)
async def put_kpi_plans(
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentUser,
    company_id: CurrentCompanyId,
    body: SalesKpiPlansPut,
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
        delete(SalesKpiPlan).where(
            SalesKpiPlan.company_id == company_id,
            SalesKpiPlan.pipeline_id == body.pipeline_id,
            SalesKpiPlan.year_month == ym,
        ),
    )

    for row in body.plans:
        if row.plan_amount <= 0:
            continue
        u = await db.get(User, row.manager_user_id)
        if u is None or u.company_id != company_id:
            raise HTTPException(status_code=400, detail=f"Пользователь {row.manager_user_id} не в компании")
        if not await _user_assigned_to_pipeline(db, company_id, row.manager_user_id, body.pipeline_id):
            raise HTTPException(
                status_code=400,
                detail=f"Менеджер {row.manager_user_id} не назначен на эту воронку — добавьте направление в карточке сотрудника",
            )
        db.add(
            SalesKpiPlan(
                company_id=company_id,
                pipeline_id=body.pipeline_id,
                year_month=ym,
                manager_user_id=row.manager_user_id,
                expert_user_id=pipe.expert_user_id,
                plan_amount=row.plan_amount,
            ),
        )
    await db.commit()
