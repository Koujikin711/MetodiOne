"""HoReCa API: базовые KPI ресторана, техкарты и ресторанные финансы."""

from datetime import UTC, datetime, timedelta
from decimal import Decimal
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field
from sqlalchemy import case, delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import CurrentCompanyId, CurrentUser
from app.database import get_db
from app.models import (
    BookingAppointment,
    BookingSpecialist,
    FinanceProduct,
    FinanceStockBalance,
    FinanceStockMovement,
    HorecaMenuItem,
    HorecaPrepPortion,
    HorecaTechCardLine,
    Task,
    TaskStatus,
    User,
    UserRole,
)

router = APIRouter(prefix="/horeca", tags=["horeca"])

_HORECA_READ_ROLES = frozenset(
    {UserRole.owner, UserRole.admin, UserRole.manager, UserRole.super_owner, UserRole.finance_analyst}
)
_HORECA_WRITE_ROLES = frozenset({UserRole.owner, UserRole.admin, UserRole.super_owner})
_HORECA_READ_STAFF_ROLES = frozenset({"waiter", "hall_admin", "cook", "cashier"})
_HORECA_WRITE_STAFF_ROLES = frozenset({"hall_admin", "cashier"})
_HORECA_PREP_WRITE_STAFF = frozenset({"cook", "hall_admin"})


def _require_horeca_read(user: CurrentUser) -> None:
    staff_role = str(getattr(user, "horeca_role", "") or "").strip().lower()
    if user.role not in _HORECA_READ_ROLES and staff_role not in _HORECA_READ_STAFF_ROLES:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Нет доступа к HoReCa")


def _require_horeca_write(user: CurrentUser) -> None:
    staff_role = str(getattr(user, "horeca_role", "") or "").strip().lower()
    if user.role not in _HORECA_WRITE_ROLES and staff_role not in _HORECA_WRITE_STAFF_ROLES:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Недостаточно прав для изменения HoReCa")


def _require_horeca_prep_write(user: CurrentUser) -> None:
    staff_role = str(getattr(user, "horeca_role", "") or "").strip().lower()
    if user.role not in _HORECA_WRITE_ROLES and staff_role not in _HORECA_PREP_WRITE_STAFF:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Недостаточно прав для заготовок HoReCa")


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


class HorecaOrderBoardItemRead(BaseModel):
    id: int
    stage: str
    status: str
    table_id: int | None = None
    table_name: str | None = None
    guest_name: str
    item_name: str
    start_at: datetime
    end_at: datetime
    paid_amount: Decimal


class HorecaTableStatusRead(BaseModel):
    table_id: int
    table_name: str
    table_number: int
    is_busy: bool
    current_order_id: int | None = None
    current_guest_name: str | None = None
    current_item_name: str | None = None
    starts_at: datetime | None = None
    ends_at: datetime | None = None


class HorecaProductOptionRead(BaseModel):
    id: int
    name: str
    unit: str
    is_active: bool


class HorecaStockBalanceRead(BaseModel):
    product_id: int
    product_name: str
    quantity: Decimal
    avg_unit_cost: Decimal
    stock_value: Decimal
    risk: str


class HorecaStockMovementRead(BaseModel):
    id: int
    created_at: datetime
    movement_type: str
    product_id: int
    product_name: str
    qty_delta: Decimal
    unit_cost: Decimal | None = None
    memo: str | None = None


class HorecaStockAlertRead(BaseModel):
    product_id: int
    product_name: str
    quantity: Decimal
    risk: str


class HorecaStockReportLineRead(BaseModel):
    product_id: int
    product_name: str
    issue_qty: Decimal
    issue_value: Decimal


class HorecaStockReportRead(BaseModel):
    date_from: datetime
    date_to: datetime
    total_issue_value: Decimal
    lines: list[HorecaStockReportLineRead]


class HorecaPrepLineRead(BaseModel):
    menu_item_id: int
    menu_item_name: str
    portions_ready: Decimal


class HorecaPrepTodayPutLine(BaseModel):
    menu_item_id: int
    portions_ready: Decimal = Field(..., ge=Decimal("0"))


class HorecaPrepTodayPut(BaseModel):
    lines: list[HorecaPrepTodayPutLine]


class HorecaSellableItemRead(BaseModel):
    menu_item_id: int
    menu_item_name: str
    max_from_stock: int | None
    portions_prepared_today: Decimal | None
    sellable_portions: int | None


class HorecaCapacityForecastRead(BaseModel):
    generated_at: datetime
    tables_count: int
    staff_horeca_count: int
    avg_visit_minutes: float
    turns_per_table_per_4h: int
    estimated_max_covers_4h: int
    notes: str


def _risk_by_qty(qty: Decimal) -> str:
    if qty <= 0:
        return "out"
    if qty < Decimal("3"):
        return "low"
    return "ok"


def _booking_status_to_order_stage(status_raw: str) -> str:
    s = (status_raw or "").strip().lower()
    if s == "booked":
        return "new"
    if s in {"arrived", "in_service", "confirmed"}:
        return "in_work"
    if s in {"ready", "awaiting_payment"}:
        return "ready"
    return "closed"


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
    menu_title_expr = func.coalesce(func.trim(BookingAppointment.service_title), "Без названия")
    revenue_sum_expr = func.coalesce(func.sum(BookingAppointment.paid_amount), 0)
    sales = (
        await db.execute(
            select(
                menu_title_expr,
                func.count(BookingAppointment.id),
                revenue_sum_expr,
            )
            .where(BookingAppointment.company_id == company_id, BookingAppointment.created_at >= date_from)
            .group_by(menu_title_expr)
            .order_by(revenue_sum_expr.desc())
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


@router.get("/orders/board", response_model=list[HorecaOrderBoardItemRead])
async def horeca_orders_board(
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentUser,
    company_id: CurrentCompanyId,
    days: int = Query(default=1, ge=1, le=30),
) -> list[HorecaOrderBoardItemRead]:
    _require_horeca_read(current_user)
    date_from = datetime.now(UTC) - timedelta(days=days)
    rows = (
        await db.execute(
            select(
                BookingAppointment.id,
                BookingAppointment.status,
                BookingAppointment.patient_name,
                BookingAppointment.service_title,
                BookingAppointment.start_at,
                BookingAppointment.end_at,
                BookingAppointment.paid_amount,
                BookingSpecialist.id,
                BookingSpecialist.full_name,
            )
            .outerjoin(BookingSpecialist, BookingSpecialist.id == BookingAppointment.specialist_id)
            .where(
                BookingAppointment.company_id == company_id,
                BookingAppointment.created_at >= date_from,
            )
            .order_by(BookingAppointment.start_at.desc(), BookingAppointment.id.desc())
            .limit(400)
        )
    ).all()
    out: list[HorecaOrderBoardItemRead] = []
    for oid, status_raw, guest, item, start_at, end_at, paid_amount, tid, tname in rows:
        out.append(
            HorecaOrderBoardItemRead(
                id=int(oid),
                stage=_booking_status_to_order_stage(str(status_raw or "")),
                status=str(status_raw or ""),
                table_id=int(tid) if tid is not None else None,
                table_name=str(tname or "") or None,
                guest_name=(str(guest or "").strip() or "Гость"),
                item_name=(str(item or "").strip() or "Заказ"),
                start_at=start_at,
                end_at=end_at,
                paid_amount=Decimal(paid_amount or 0),
            )
        )
    return out


@router.get("/tables/status", response_model=list[HorecaTableStatusRead])
async def horeca_tables_status(
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentUser,
    company_id: CurrentCompanyId,
) -> list[HorecaTableStatusRead]:
    _require_horeca_read(current_user)
    now = datetime.now(UTC)
    specs = (
        await db.execute(
            select(BookingSpecialist.id, BookingSpecialist.full_name, BookingSpecialist.sort_order)
            .where(BookingSpecialist.company_id == company_id, BookingSpecialist.is_active.is_(True))
            .order_by(BookingSpecialist.sort_order.asc(), BookingSpecialist.id.asc())
        )
    ).all()
    active_rows = (
        await db.execute(
            select(
                BookingAppointment.id,
                BookingAppointment.specialist_id,
                BookingAppointment.patient_name,
                BookingAppointment.service_title,
                BookingAppointment.start_at,
                BookingAppointment.end_at,
                BookingAppointment.status,
            )
            .where(
                BookingAppointment.company_id == company_id,
                BookingAppointment.start_at <= now,
                BookingAppointment.end_at > now,
            )
            .order_by(BookingAppointment.start_at.desc(), BookingAppointment.id.desc())
        )
    ).all()
    active_by_table: dict[int, tuple[int, str, str, datetime, datetime, str]] = {}
    for oid, sid, guest, item, st, en, status_raw in active_rows:
        if sid is None:
            continue
        if _booking_status_to_order_stage(str(status_raw or "")) == "closed":
            continue
        if int(sid) not in active_by_table:
            active_by_table[int(sid)] = (
                int(oid),
                str(guest or "").strip() or "Гость",
                str(item or "").strip() or "Заказ",
                st,
                en,
                str(status_raw or ""),
            )

    out: list[HorecaTableStatusRead] = []
    for idx, (sid, full_name, _) in enumerate(specs, start=1):
        cur = active_by_table.get(int(sid))
        out.append(
            HorecaTableStatusRead(
                table_id=int(sid),
                table_name=str(full_name or "") or f"Стол {idx}",
                table_number=idx,
                is_busy=cur is not None,
                current_order_id=cur[0] if cur else None,
                current_guest_name=cur[1] if cur else None,
                current_item_name=cur[2] if cur else None,
                starts_at=cur[3] if cur else None,
                ends_at=cur[4] if cur else None,
            )
        )
    return out


@router.get("/products/options", response_model=list[HorecaProductOptionRead])
async def horeca_products_options(
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentUser,
    company_id: CurrentCompanyId,
) -> list[HorecaProductOptionRead]:
    _require_horeca_read(current_user)
    rows = (
        await db.execute(
            select(FinanceProduct.id, FinanceProduct.name, FinanceProduct.unit, FinanceProduct.is_active)
            .where(FinanceProduct.company_id == company_id)
            .order_by(FinanceProduct.is_active.desc(), FinanceProduct.name.asc())
            .limit(500)
        )
    ).all()
    return [
        HorecaProductOptionRead(id=int(pid), name=str(name), unit=str(unit or "шт"), is_active=bool(is_active))
        for pid, name, unit, is_active in rows
    ]


@router.get("/stock/balances", response_model=list[HorecaStockBalanceRead])
async def horeca_stock_balances(
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentUser,
    company_id: CurrentCompanyId,
) -> list[HorecaStockBalanceRead]:
    _require_horeca_read(current_user)
    rows = (
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
            .limit(300)
        )
    ).all()
    return [
        HorecaStockBalanceRead(
            product_id=int(pid),
            product_name=str(name),
            quantity=Decimal(qty or 0),
            avg_unit_cost=Decimal(avg_cost or 0),
            stock_value=Decimal(stock_value or 0),
            risk=_risk_by_qty(Decimal(qty or 0)),
        )
        for pid, name, qty, avg_cost, stock_value in rows
    ]


@router.get("/stock/movements", response_model=list[HorecaStockMovementRead])
async def horeca_stock_movements(
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentUser,
    company_id: CurrentCompanyId,
    limit: int = Query(default=80, ge=1, le=300),
) -> list[HorecaStockMovementRead]:
    _require_horeca_read(current_user)
    rows = (
        await db.execute(
            select(
                FinanceStockMovement.id,
                FinanceStockMovement.created_at,
                FinanceStockMovement.movement_type,
                FinanceStockMovement.product_id,
                FinanceProduct.name,
                FinanceStockMovement.qty_delta,
                FinanceStockMovement.unit_cost,
                FinanceStockMovement.memo,
            )
            .join(FinanceProduct, FinanceProduct.id == FinanceStockMovement.product_id)
            .where(FinanceStockMovement.company_id == company_id)
            .order_by(FinanceStockMovement.created_at.desc(), FinanceStockMovement.id.desc())
            .limit(limit)
        )
    ).all()
    return [
        HorecaStockMovementRead(
            id=int(mid),
            created_at=created_at,
            movement_type=str(mtype or ""),
            product_id=int(product_id),
            product_name=str(product_name),
            qty_delta=Decimal(qty_delta or 0),
            unit_cost=Decimal(unit_cost or 0) if unit_cost is not None else None,
            memo=str(memo) if memo else None,
        )
        for mid, created_at, mtype, product_id, product_name, qty_delta, unit_cost, memo in rows
    ]


@router.get("/stock/alerts", response_model=list[HorecaStockAlertRead])
async def horeca_stock_alerts(
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentUser,
    company_id: CurrentCompanyId,
) -> list[HorecaStockAlertRead]:
    _require_horeca_read(current_user)
    rows = (
        await db.execute(
            select(
                FinanceProduct.id,
                FinanceProduct.name,
                func.coalesce(func.sum(FinanceStockBalance.quantity), 0),
            )
            .join(FinanceProduct, FinanceProduct.id == FinanceStockBalance.product_id)
            .where(FinanceProduct.company_id == company_id, FinanceProduct.is_active.is_(True))
            .group_by(FinanceProduct.id, FinanceProduct.name)
            .having(func.coalesce(func.sum(FinanceStockBalance.quantity), 0) < 3)
            .order_by(func.coalesce(func.sum(FinanceStockBalance.quantity), 0).asc())
            .limit(200)
        )
    ).all()
    out: list[HorecaStockAlertRead] = []
    for pid, name, qty in rows:
        q = Decimal(qty or 0)
        out.append(
            HorecaStockAlertRead(
                product_id=int(pid),
                product_name=str(name),
                quantity=q,
                risk=_risk_by_qty(q),
            )
        )
    return out


@router.get("/stock/report", response_model=HorecaStockReportRead)
async def horeca_stock_report(
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentUser,
    company_id: CurrentCompanyId,
    days: int = Query(default=7, ge=1, le=90),
) -> HorecaStockReportRead:
    _require_horeca_read(current_user)
    now = datetime.now(UTC)
    start = now - timedelta(days=days)
    issue_qty_expr = func.sum(
        case(
            (FinanceStockMovement.qty_delta < 0, -FinanceStockMovement.qty_delta),
            else_=Decimal("0"),
        )
    )
    issue_val_expr = func.sum(
        case(
            (
                FinanceStockMovement.qty_delta < 0,
                func.abs(FinanceStockMovement.qty_delta) * func.coalesce(FinanceStockMovement.unit_cost, 0),
            ),
            else_=Decimal("0"),
        )
    )
    rows = (
        await db.execute(
            select(
                FinanceProduct.id,
                FinanceProduct.name,
                issue_qty_expr,
                issue_val_expr,
            )
            .join(FinanceProduct, FinanceProduct.id == FinanceStockMovement.product_id)
            .where(
                FinanceStockMovement.company_id == company_id,
                FinanceStockMovement.created_at >= start,
                FinanceStockMovement.movement_type.in_(["issue", "transfer_out"]),
            )
            .group_by(FinanceProduct.id, FinanceProduct.name)
            .having(issue_qty_expr > 0)
            .order_by(issue_val_expr.desc())
            .limit(200)
        )
    ).all()
    lines = [
        HorecaStockReportLineRead(
            product_id=int(pid),
            product_name=str(name),
            issue_qty=Decimal(iq or 0),
            issue_value=Decimal(iv or 0),
        )
        for pid, name, iq, iv in rows
    ]
    total = sum((l.issue_value for l in lines), start=Decimal("0"))
    return HorecaStockReportRead(date_from=start, date_to=now, total_issue_value=total, lines=lines)


def _floor_portions_from_stock(qty: Decimal, per: Decimal) -> int:
    if per <= 0:
        return 10**9
    return int(qty // per)


@router.get("/prep/today", response_model=list[HorecaPrepLineRead])
async def horeca_prep_today(
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentUser,
    company_id: CurrentCompanyId,
) -> list[HorecaPrepLineRead]:
    _require_horeca_read(current_user)
    today = datetime.now(UTC).date()
    prep_rows = (
        await db.execute(
            select(HorecaPrepPortion.menu_item_id, HorecaPrepPortion.portions_ready)
            .where(HorecaPrepPortion.company_id == company_id, HorecaPrepPortion.prep_date == today)
        )
    ).all()
    prep_map = {int(mid): Decimal(pr or 0) for mid, pr in prep_rows}
    menu_rows = (
        await db.execute(
            select(HorecaMenuItem.id, HorecaMenuItem.name)
            .where(HorecaMenuItem.company_id == company_id, HorecaMenuItem.is_active.is_(True))
            .order_by(HorecaMenuItem.name.asc())
        )
    ).all()
    return [
        HorecaPrepLineRead(
            menu_item_id=int(mid),
            menu_item_name=str(mname),
            portions_ready=prep_map.get(int(mid), Decimal("0")),
        )
        for mid, mname in menu_rows
    ]


@router.put("/prep/today", response_model=list[HorecaPrepLineRead])
async def horeca_prep_today_put(
    body: HorecaPrepTodayPut,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentUser,
    company_id: CurrentCompanyId,
) -> list[HorecaPrepLineRead]:
    _require_horeca_prep_write(current_user)
    today = datetime.now(UTC).date()
    menu_ids = {line.menu_item_id for line in body.lines}
    if menu_ids:
        ok = (
            await db.execute(
                select(HorecaMenuItem.id).where(
                    HorecaMenuItem.company_id == company_id,
                    HorecaMenuItem.id.in_(menu_ids),
                )
            )
        ).all()
        ok_set = {int(r[0]) for r in ok}
        if ok_set != menu_ids:
            raise HTTPException(status_code=400, detail="Неизвестная позиция меню для компании")
    for line in body.lines:
        existing = (
            await db.execute(
                select(HorecaPrepPortion).where(
                    HorecaPrepPortion.company_id == company_id,
                    HorecaPrepPortion.prep_date == today,
                    HorecaPrepPortion.menu_item_id == line.menu_item_id,
                )
            )
        ).scalars().first()
        if existing is not None:
            existing.portions_ready = line.portions_ready
        else:
            db.add(
                HorecaPrepPortion(
                    company_id=company_id,
                    prep_date=today,
                    menu_item_id=line.menu_item_id,
                    portions_ready=line.portions_ready,
                )
            )
    await db.flush()
    return await horeca_prep_today(db, current_user, company_id)


@router.get("/menu/sellable-today", response_model=list[HorecaSellableItemRead])
async def horeca_menu_sellable_today(
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentUser,
    company_id: CurrentCompanyId,
) -> list[HorecaSellableItemRead]:
    _require_horeca_read(current_user)
    today = datetime.now(UTC).date()
    bal_rows = (
        await db.execute(
            select(FinanceStockBalance.product_id, func.coalesce(func.sum(FinanceStockBalance.quantity), 0))
            .join(FinanceProduct, FinanceProduct.id == FinanceStockBalance.product_id)
            .where(FinanceProduct.company_id == company_id)
            .group_by(FinanceStockBalance.product_id)
        )
    ).all()
    qty_by_product = {int(pid): Decimal(q or 0) for pid, q in bal_rows}
    prep_rows = (
        await db.execute(
            select(HorecaPrepPortion.menu_item_id, HorecaPrepPortion.portions_ready).where(
                HorecaPrepPortion.company_id == company_id,
                HorecaPrepPortion.prep_date == today,
            )
        )
    ).all()
    prep_map = {int(mid): Decimal(pr or 0) for mid, pr in prep_rows}
    tech_rows = (
        await db.execute(
            select(HorecaTechCardLine.menu_item_id, HorecaTechCardLine.product_id, HorecaTechCardLine.qty_per_portion)
            .join(HorecaMenuItem, HorecaMenuItem.id == HorecaTechCardLine.menu_item_id)
            .where(HorecaMenuItem.company_id == company_id, HorecaMenuItem.is_active.is_(True))
        )
    ).all()
    lines_by_menu: dict[int, list[tuple[int, Decimal]]] = {}
    for mid, pid, qpp in tech_rows:
        lines_by_menu.setdefault(int(mid), []).append((int(pid), Decimal(qpp or 0)))
    menu_rows = (
        await db.execute(
            select(HorecaMenuItem.id, HorecaMenuItem.name)
            .where(HorecaMenuItem.company_id == company_id, HorecaMenuItem.is_active.is_(True))
            .order_by(HorecaMenuItem.name.asc())
        )
    ).all()
    out: list[HorecaSellableItemRead] = []
    for mid, mname in menu_rows:
        mid_i = int(mid)
        recipe = lines_by_menu.get(mid_i)
        max_from_stock: int | None
        if not recipe:
            max_from_stock = None
        else:
            caps = []
            for pid, per in recipe:
                caps.append(_floor_portions_from_stock(qty_by_product.get(pid, Decimal("0")), per))
            max_from_stock = min(caps) if caps else 0
        prep_val = prep_map.get(mid_i)
        portions_prepared = prep_val if mid_i in prep_map else None
        sellable: int | None
        if max_from_stock is None:
            sellable = int(prep_val) if mid_i in prep_map else None
        elif mid_i in prep_map:
            sellable = min(max_from_stock, int(prep_val))
        else:
            sellable = max_from_stock
        out.append(
            HorecaSellableItemRead(
                menu_item_id=mid_i,
                menu_item_name=str(mname),
                max_from_stock=max_from_stock,
                portions_prepared_today=portions_prepared,
                sellable_portions=sellable,
            )
        )
    return out


@router.get("/forecast/capacity", response_model=HorecaCapacityForecastRead)
async def horeca_forecast_capacity(
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentUser,
    company_id: CurrentCompanyId,
) -> HorecaCapacityForecastRead:
    _require_horeca_read(current_user)
    now = datetime.now(UTC)
    month_ago = now - timedelta(days=30)
    tables_count = int(
        await db.scalar(
            select(func.count(BookingSpecialist.id)).where(
                BookingSpecialist.company_id == company_id,
                BookingSpecialist.is_active.is_(True),
            )
        )
        or 0
    )
    staff_horeca_count = int(
        await db.scalar(
            select(func.count(User.id)).where(
                User.company_id == company_id,
                User.is_active.is_(True),
                User.horeca_role.in_(["waiter", "hall_admin", "cook", "cashier"]),
            )
        )
        or 0
    )
    dur_rows = (
        await db.execute(
            select(BookingAppointment.start_at, BookingAppointment.end_at).where(
                BookingAppointment.company_id == company_id,
                BookingAppointment.created_at >= month_ago,
                BookingAppointment.end_at > BookingAppointment.start_at,
            )
        )
    ).all()
    durations_min: list[float] = []
    for st, en in dur_rows:
        if st is None or en is None:
            continue
        delta = (en - st).total_seconds() / 60.0
        if 5 <= delta <= 600:
            durations_min.append(delta)
    avg_visit = sum(durations_min) / len(durations_min) if durations_min else 90.0
    turn_min = max(30.0, float(avg_visit))
    turns_4h = int((4 * 60) // turn_min) if turn_min > 0 else 0
    est_covers = tables_count * max(turns_4h, 0) if tables_count else 0
    notes = (
        f"Оценка по столикам из онлайн-записи ({tables_count}) и средней длительности визита за 30 дней "
        f"({avg_visit:.0f} мин). Пиковая «ёмкость» на 4 ч — условные {est_covers} посадок при полной загрузке; "
        f"учтите кухню ({staff_horeca_count} сотрудников с ролью HoReCa) и реальное меню."
    )
    return HorecaCapacityForecastRead(
        generated_at=now,
        tables_count=tables_count,
        staff_horeca_count=staff_horeca_count,
        avg_visit_minutes=round(avg_visit, 1),
        turns_per_table_per_4h=max(turns_4h, 0),
        estimated_max_covers_4h=est_covers,
        notes=notes,
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
    abc_title_expr = func.coalesce(func.trim(BookingAppointment.service_title), "Без названия")
    abc_revenue_expr = func.coalesce(func.sum(BookingAppointment.paid_amount), 0)
    abc_rows = (
        await db.execute(
            select(
                abc_title_expr,
                abc_revenue_expr,
            )
            .where(BookingAppointment.company_id == company_id, BookingAppointment.created_at >= month_ago)
            .group_by(abc_title_expr)
            .order_by(abc_revenue_expr.desc())
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
