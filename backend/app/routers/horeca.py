"""HoReCa API: базовые KPI ресторана, техкарты и ресторанные финансы."""

from datetime import UTC, datetime, timedelta
from decimal import Decimal
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field
from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import CurrentCompanyId, CurrentUser
from app.database import get_db
from app.models import (
    BookingAppointment,
    FinanceProduct,
    FinanceStockBalance,
    FinanceStockMovement,
    HorecaMenuItem,
    HorecaTechCardLine,
    Task,
    TaskStatus,
    UserRole,
)

router = APIRouter(prefix="/horeca", tags=["horeca"])

_HORECA_READ_ROLES = frozenset({UserRole.owner, UserRole.admin, UserRole.super_owner, UserRole.finance_analyst})
_HORECA_WRITE_ROLES = frozenset({UserRole.owner, UserRole.admin, UserRole.super_owner})
_HORECA_READ_STAFF_ROLES = frozenset({"waiter", "hall_admin", "cook", "cashier"})
_HORECA_WRITE_STAFF_ROLES = frozenset({"hall_admin", "cashier"})


def _require_horeca_read(user: CurrentUser) -> None:
    staff_role = str(getattr(user, "horeca_role", "") or "").strip().lower()
    if user.role not in _HORECA_READ_ROLES and staff_role not in _HORECA_READ_STAFF_ROLES:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Нет доступа к HoReCa")


def _require_horeca_write(user: CurrentUser) -> None:
    staff_role = str(getattr(user, "horeca_role", "") or "").strip().lower()
    if user.role not in _HORECA_WRITE_ROLES and staff_role not in _HORECA_WRITE_STAFF_ROLES:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Недостаточно прав для изменения HoReCa")


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


class HorecaMenuItemCreate(BaseModel):
    name: str = Field(..., min_length=2, max_length=255)
    sale_price: Decimal = Field(default=Decimal("0"), ge=Decimal("0"))
    is_active: bool = True


class HorecaMenuItemPatch(BaseModel):
    name: str | None = Field(default=None, min_length=2, max_length=255)
    sale_price: Decimal | None = Field(default=None, ge=Decimal("0"))
    is_active: bool | None = None


class HorecaMenuItemRead(BaseModel):
    id: int
    name: str
    sale_price: Decimal
    is_active: bool


class HorecaTechCardLineWrite(BaseModel):
    product_id: int
    qty_per_portion: Decimal = Field(..., gt=Decimal("0"))


class HorecaTechCardLineRead(BaseModel):
    product_id: int
    product_name: str
    qty_per_portion: Decimal
    avg_unit_cost: Decimal
    line_cost: Decimal


class HorecaTechCardRead(BaseModel):
    menu_item_id: int
    menu_item_name: str
    sale_price: Decimal
    recipe_cost: Decimal
    gross_per_portion: Decimal
    food_cost_pct: float
    lines: list[HorecaTechCardLineRead]


class HorecaFinanceItemRead(BaseModel):
    menu_item_name: str
    qty: int
    revenue: Decimal
    cogs: Decimal
    gross_profit: Decimal
    food_cost_pct: float
    abc_class: str
    unmapped: bool = False


class HorecaFinanceSummaryRead(BaseModel):
    date_from: datetime
    date_to: datetime
    revenue: Decimal
    cogs: Decimal
    gross_profit: Decimal
    gross_margin_pct: float
    food_cost_pct: float
    sales_count: int
    mapped_sales_count: int
    unmapped_sales_count: int
    items: list[HorecaFinanceItemRead]


def _risk_by_qty(qty: Decimal) -> str:
    if qty <= 0:
        return "out"
    if qty < Decimal("3"):
        return "low"
    return "ok"


async def _product_avg_cost_map(db: AsyncSession, company_id: int) -> dict[int, Decimal]:
    rows = (
        await db.execute(
            select(
                FinanceProduct.id,
                func.coalesce(func.avg(FinanceStockBalance.avg_unit_cost), 0),
            )
            .join(FinanceStockBalance, FinanceStockBalance.product_id == FinanceProduct.id)
            .where(FinanceProduct.company_id == company_id)
            .group_by(FinanceProduct.id)
        )
    ).all()
    return {int(pid): Decimal(avg or 0) for pid, avg in rows}


async def _menu_cost_map(db: AsyncSession, company_id: int) -> dict[str, Decimal]:
    avg_cost_by_product = await _product_avg_cost_map(db, company_id)
    line_rows = (
        await db.execute(
            select(
                HorecaMenuItem.id,
                HorecaMenuItem.name,
                HorecaTechCardLine.product_id,
                HorecaTechCardLine.qty_per_portion,
            )
            .join(HorecaTechCardLine, HorecaTechCardLine.menu_item_id == HorecaMenuItem.id)
            .where(HorecaMenuItem.company_id == company_id, HorecaMenuItem.is_active.is_(True))
        )
    ).all()
    out: dict[str, Decimal] = {}
    for _, name, product_id, qty in line_rows:
        key = str(name).strip().lower()
        cost = Decimal(qty or 0) * Decimal(avg_cost_by_product.get(int(product_id), Decimal("0")))
        out[key] = out.get(key, Decimal("0")) + cost
    return out


@router.get("/ping")
async def ping(
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentUser,
) -> dict[str, bool]:
    _ = db
    _ = current_user
    return {"ok": True}


@router.get("/menu-items", response_model=list[HorecaMenuItemRead])
async def list_menu_items(
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentUser,
    company_id: CurrentCompanyId,
) -> list[HorecaMenuItemRead]:
    _require_horeca_read(current_user)
    rows = (
        await db.execute(
            select(HorecaMenuItem)
            .where(HorecaMenuItem.company_id == company_id)
            .order_by(HorecaMenuItem.is_active.desc(), HorecaMenuItem.name)
        )
    ).scalars().all()
    return [HorecaMenuItemRead(id=r.id, name=r.name, sale_price=r.sale_price, is_active=r.is_active) for r in rows]


@router.post("/menu-items", response_model=HorecaMenuItemRead, status_code=201)
async def create_menu_item(
    body: HorecaMenuItemCreate,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentUser,
    company_id: CurrentCompanyId,
) -> HorecaMenuItemRead:
    _require_horeca_write(current_user)
    row = HorecaMenuItem(
        company_id=company_id,
        name=body.name.strip(),
        sale_price=body.sale_price,
        is_active=body.is_active,
    )
    db.add(row)
    await db.flush()
    return HorecaMenuItemRead(id=row.id, name=row.name, sale_price=row.sale_price, is_active=row.is_active)


@router.patch("/menu-items/{item_id}", response_model=HorecaMenuItemRead)
async def patch_menu_item(
    item_id: int,
    body: HorecaMenuItemPatch,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentUser,
    company_id: CurrentCompanyId,
) -> HorecaMenuItemRead:
    _require_horeca_write(current_user)
    row = await db.get(HorecaMenuItem, item_id)
    if row is None or row.company_id != company_id:
        raise HTTPException(status_code=404, detail="Позиция меню не найдена")
    if body.name is not None:
        row.name = body.name.strip()
    if body.sale_price is not None:
        row.sale_price = body.sale_price
    if body.is_active is not None:
        row.is_active = body.is_active
    await db.flush()
    return HorecaMenuItemRead(id=row.id, name=row.name, sale_price=row.sale_price, is_active=row.is_active)


@router.put("/menu-items/{item_id}/tech-card", response_model=HorecaTechCardRead)
async def put_tech_card(
    item_id: int,
    body: list[HorecaTechCardLineWrite],
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentUser,
    company_id: CurrentCompanyId,
) -> HorecaTechCardRead:
    _require_horeca_write(current_user)
    menu = await db.get(HorecaMenuItem, item_id)
    if menu is None or menu.company_id != company_id:
        raise HTTPException(status_code=404, detail="Позиция меню не найдена")
    product_ids = {int(x.product_id) for x in body}
    if product_ids:
        existing = (
            await db.execute(
                select(FinanceProduct.id)
                .where(FinanceProduct.company_id == company_id, FinanceProduct.id.in_(product_ids))
            )
        ).scalars().all()
        if len(set(int(x) for x in existing)) != len(product_ids):
            raise HTTPException(status_code=400, detail="В техкарте есть продукты не из вашей компании")
    await db.execute(delete(HorecaTechCardLine).where(HorecaTechCardLine.menu_item_id == menu.id))
    for ln in body:
        db.add(HorecaTechCardLine(menu_item_id=menu.id, product_id=ln.product_id, qty_per_portion=ln.qty_per_portion))
    await db.flush()
    return await get_tech_card(item_id=menu.id, db=db, current_user=current_user, company_id=company_id)


@router.get("/menu-items/{item_id}/tech-card", response_model=HorecaTechCardRead)
async def get_tech_card(
    item_id: int,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentUser,
    company_id: CurrentCompanyId,
) -> HorecaTechCardRead:
    _require_horeca_read(current_user)
    menu = await db.get(HorecaMenuItem, item_id)
    if menu is None or menu.company_id != company_id:
        raise HTTPException(status_code=404, detail="Позиция меню не найдена")
    avg_cost = await _product_avg_cost_map(db, company_id)
    rows = (
        await db.execute(
            select(
                HorecaTechCardLine.product_id,
                FinanceProduct.name,
                HorecaTechCardLine.qty_per_portion,
            )
            .join(FinanceProduct, FinanceProduct.id == HorecaTechCardLine.product_id)
            .where(HorecaTechCardLine.menu_item_id == menu.id)
            .order_by(FinanceProduct.name)
        )
    ).all()
    lines: list[HorecaTechCardLineRead] = []
    recipe_cost = Decimal("0")
    for pid, pname, qty in rows:
        unit_cost = Decimal(avg_cost.get(int(pid), Decimal("0")))
        line_cost = Decimal(qty or 0) * unit_cost
        recipe_cost += line_cost
        lines.append(
            HorecaTechCardLineRead(
                product_id=int(pid),
                product_name=str(pname),
                qty_per_portion=Decimal(qty or 0),
                avg_unit_cost=unit_cost,
                line_cost=line_cost,
            )
        )
    gross = Decimal(menu.sale_price or 0) - recipe_cost
    pct = float((recipe_cost / Decimal(menu.sale_price or 0) * Decimal("100")) if Decimal(menu.sale_price or 0) > 0 else Decimal("0"))
    return HorecaTechCardRead(
        menu_item_id=menu.id,
        menu_item_name=menu.name,
        sale_price=Decimal(menu.sale_price or 0),
        recipe_cost=recipe_cost,
        gross_per_portion=gross,
        food_cost_pct=round(pct, 2),
        lines=lines,
    )


@router.get("/finance/summary", response_model=HorecaFinanceSummaryRead)
async def horeca_finance_summary(
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentUser,
    company_id: CurrentCompanyId,
    days: int = Query(default=30, ge=1, le=365),
) -> HorecaFinanceSummaryRead:
    _require_horeca_read(current_user)
    now = datetime.now(UTC)
    date_from = now - timedelta(days=days)
    sales = (
        await db.execute(
            select(
                func.coalesce(func.trim(BookingAppointment.service_title), "Без названия"),
                func.count(BookingAppointment.id),
                func.coalesce(func.sum(BookingAppointment.paid_amount), 0),
            )
            .where(BookingAppointment.company_id == company_id, BookingAppointment.created_at >= date_from)
            .group_by(func.coalesce(func.trim(BookingAppointment.service_title), "Без названия"))
            .order_by(func.coalesce(func.sum(BookingAppointment.paid_amount), 0).desc())
        )
    ).all()
    cost_map = await _menu_cost_map(db, company_id)
    items: list[HorecaFinanceItemRead] = []
    total_revenue = Decimal("0")
    total_cogs = Decimal("0")
    mapped = 0
    unmapped = 0
    ranked: list[tuple[str, int, Decimal]] = []
    for name_raw, qty_raw, rev_raw in sales:
        qty = int(qty_raw or 0)
        rev = Decimal(rev_raw or 0)
        total_revenue += rev
        ranked.append((str(name_raw), qty, rev))
    cumulative = 0.0
    for name, qty, rev in ranked:
        key = name.strip().lower()
        per_cost = Decimal(cost_map.get(key, Decimal("0")))
        cogs = per_cost * Decimal(qty)
        if key in cost_map:
            mapped += qty
        else:
            unmapped += qty
        total_cogs += cogs
        share_pct = float((rev / total_revenue * Decimal("100")) if total_revenue > 0 else Decimal("0"))
        cumulative += share_pct
        abc = "A" if cumulative <= 80 else ("B" if cumulative <= 95 else "C")
        gp = rev - cogs
        food_pct = float((cogs / rev * Decimal("100")) if rev > 0 else Decimal("0"))
        items.append(
            HorecaFinanceItemRead(
                menu_item_name=name,
                qty=qty,
                revenue=rev,
                cogs=cogs,
                gross_profit=gp,
                food_cost_pct=round(food_pct, 2),
                abc_class=abc,
                unmapped=key not in cost_map,
            )
        )
    gp_total = total_revenue - total_cogs
    return HorecaFinanceSummaryRead(
        date_from=date_from,
        date_to=now,
        revenue=total_revenue,
        cogs=total_cogs,
        gross_profit=gp_total,
        gross_margin_pct=round(float((gp_total / total_revenue * Decimal("100")) if total_revenue > 0 else Decimal("0")), 2),
        food_cost_pct=round(float((total_cogs / total_revenue * Decimal("100")) if total_revenue > 0 else Decimal("0")), 2),
        sales_count=mapped + unmapped,
        mapped_sales_count=mapped,
        unmapped_sales_count=unmapped,
        items=items,
    )


@router.get("/overview", response_model=HorecaOverviewRead)
async def overview(
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentUser,
    company_id: CurrentCompanyId,
) -> HorecaOverviewRead:
    _require_horeca_read(current_user)
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
    revenue_today = Decimal(
        await db.scalar(
            select(func.coalesce(func.sum(BookingAppointment.paid_amount), 0)).where(
                BookingAppointment.company_id == company_id,
                BookingAppointment.created_at >= day_start,
            )
        )
        or Decimal("0")
    )
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
    cogs_7d = Decimal(
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
    abc_rows = (
        await db.execute(
            select(
                func.coalesce(BookingAppointment.service_title, "Без названия"),
                func.coalesce(func.sum(BookingAppointment.paid_amount), 0),
            )
            .where(BookingAppointment.company_id == company_id, BookingAppointment.created_at >= month_ago)
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
        klass = "A" if run_share <= 80 else ("B" if run_share <= 95 else "C")
        abc_menu.append(HorecaAbcItemRead(item_name=str(item_name), revenue=rev, share_pct=round(share_pct, 2), abc_class=klass))
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
        food_cost_top.append(
            HorecaFoodCostItemRead(
                product_id=int(pid),
                product_name=str(pname),
                quantity=qty,
                avg_unit_cost=avg,
                stock_value=val,
                share_pct=round(share, 2),
                risk=_risk_by_qty(qty),
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
