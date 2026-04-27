"""HoReCa API: базовые KPI ресторана, ABC и food-cost обзор."""

from datetime import UTC, datetime, timedelta
from decimal import Decimal
from typing import Annotated

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import CurrentCompanyId, CurrentUser
from app.database import get_db
from app.models import BookingAppointment, FinanceProduct, FinanceStockBalance, FinanceStockMovement, Task, TaskStatus

router = APIRouter(prefix="/horeca", tags=["horeca"])


class HorecaShiftOverviewRead(BaseModel):
    bookings_today: int
    revenue_today: Decimal
    avg_check_today: Decimal
    open_tasks: int
    low_stock_items: int
    cogs_7d: Decimal


class HorecaAbcItemRead(BaseModel):
    item_name: str
    revenue: Decimal
    share_pct: float
    abc_class: str


class HorecaFoodCostItemRead(BaseModel):
    product_id: int
    product_name: str
    quantity: Decimal
    avg_unit_cost: Decimal
    stock_value: Decimal
    share_pct: float
    risk: str


class HorecaOverviewRead(BaseModel):
    generated_at: datetime
    shift: HorecaShiftOverviewRead
    abc_menu: list[HorecaAbcItemRead]
    food_cost_top: list[HorecaFoodCostItemRead]


@router.get("/ping")
async def ping(
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentUser,
) -> dict[str, bool]:
    _ = db
    _ = current_user
    return {"ok": True}


@router.get("/overview", response_model=HorecaOverviewRead)
async def overview(
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentUser,
    company_id: CurrentCompanyId,
) -> HorecaOverviewRead:
    _ = current_user
    now = datetime.now(UTC)
    day_start = now.replace(hour=0, minute=0, second=0, microsecond=0)
    week_ago = now - timedelta(days=7)
    month_ago = now - timedelta(days=30)

    bookings_today = int(
        await db.scalar(
            select(func.count(BookingAppointment.id)).where(
                BookingAppointment.company_id == company_id,
                BookingAppointment.created_at >= day_start,
            )
        )
        or 0
    )
    revenue_today_raw = (
        await db.scalar(
            select(func.coalesce(func.sum(BookingAppointment.paid_amount), 0)).where(
                BookingAppointment.company_id == company_id,
                BookingAppointment.created_at >= day_start,
            )
        )
        or Decimal("0")
    )
    revenue_today = Decimal(revenue_today_raw)
    avg_check_today = revenue_today / bookings_today if bookings_today > 0 else Decimal("0")
    open_tasks = int(
        await db.scalar(
            select(func.count(Task.id)).where(
                Task.company_id == company_id,
                Task.status.in_([TaskStatus.pending, TaskStatus.in_progress]),
            )
        )
        or 0
    )
    cogs_7d_raw = (
        await db.scalar(
            select(
                func.coalesce(
                    func.sum(func.abs(FinanceStockMovement.qty_delta) * func.coalesce(FinanceStockMovement.unit_cost, 0)),
                    0,
                )
            ).where(
                FinanceStockMovement.company_id == company_id,
                FinanceStockMovement.created_at >= week_ago,
                FinanceStockMovement.movement_type.in_(["issue", "transfer_out"]),
                FinanceStockMovement.qty_delta < 0,
            )
        )
        or Decimal("0")
    )
    cogs_7d = Decimal(cogs_7d_raw)

    abc_rows = (
        await db.execute(
            select(
                func.coalesce(BookingAppointment.service_title, "Без названия"),
                func.coalesce(func.sum(BookingAppointment.paid_amount), 0),
            ).where(
                BookingAppointment.company_id == company_id,
                BookingAppointment.created_at >= month_ago,
            )
            .group_by(func.coalesce(BookingAppointment.service_title, "Без названия"))
            .order_by(func.coalesce(func.sum(BookingAppointment.paid_amount), 0).desc())
            .limit(30)
        )
    ).all()
    total_abc_revenue = sum((Decimal(r[1] or 0) for r in abc_rows), start=Decimal("0"))
    run_share = 0.0
    abc_menu: list[HorecaAbcItemRead] = []
    for item_name, rev_raw in abc_rows:
        rev = Decimal(rev_raw or 0)
        share_pct = float((rev / total_abc_revenue * Decimal("100")) if total_abc_revenue > 0 else Decimal("0"))
        run_share += share_pct
        if run_share <= 80:
            klass = "A"
        elif run_share <= 95:
            klass = "B"
        else:
            klass = "C"
        abc_menu.append(
            HorecaAbcItemRead(
                item_name=str(item_name),
                revenue=rev,
                share_pct=round(share_pct, 2),
                abc_class=klass,
            )
        )

    food_rows = (
        await db.execute(
            select(
                FinanceProduct.id,
                FinanceProduct.name,
                func.coalesce(func.sum(FinanceStockBalance.quantity), 0),
                func.coalesce(func.avg(FinanceStockBalance.avg_unit_cost), 0),
                func.coalesce(func.sum(FinanceStockBalance.quantity * FinanceStockBalance.avg_unit_cost), 0),
            )
            .join(FinanceProduct, FinanceProduct.id == FinanceStockBalance.product_id)
            .where(FinanceProduct.company_id == company_id, FinanceProduct.is_active.is_(True))
            .group_by(FinanceProduct.id, FinanceProduct.name)
            .order_by(func.coalesce(func.sum(FinanceStockBalance.quantity * FinanceStockBalance.avg_unit_cost), 0).desc())
            .limit(20)
        )
    ).all()
    total_stock_value = sum((Decimal(r[4] or 0) for r in food_rows), start=Decimal("0"))
    food_cost_top: list[HorecaFoodCostItemRead] = []
    for pid, pname, qty_raw, avg_raw, val_raw in food_rows:
        qty = Decimal(qty_raw or 0)
        avg = Decimal(avg_raw or 0)
        val = Decimal(val_raw or 0)
        share = float((val / total_stock_value * Decimal("100")) if total_stock_value > 0 else Decimal("0"))
        risk = "ok"
        if qty <= 0:
            risk = "out"
        elif qty < Decimal("3"):
            risk = "low"
        food_cost_top.append(
            HorecaFoodCostItemRead(
                product_id=int(pid),
                product_name=str(pname),
                quantity=qty,
                avg_unit_cost=avg,
                stock_value=val,
                share_pct=round(share, 2),
                risk=risk,
            )
        )
    low_stock_items = sum(1 for r in food_cost_top if r.risk in {"low", "out"})

    return HorecaOverviewRead(
        generated_at=now,
        shift=HorecaShiftOverviewRead(
            bookings_today=bookings_today,
            revenue_today=revenue_today,
            avg_check_today=avg_check_today,
            open_tasks=open_tasks,
            low_stock_items=low_stock_items,
            cogs_7d=cogs_7d,
        ),
        abc_menu=abc_menu,
        food_cost_top=food_cost_top,
    )
