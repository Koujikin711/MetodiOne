from __future__ import annotations

import calendar
from datetime import UTC, date, datetime
from decimal import Decimal
from typing import Annotated

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, UploadFile, status
from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession
from app.core.deps import CurrentCompanyId, CurrentUser
from app.database import get_db
from app.models import (
    FinanceAccount,
    FinanceBudgetMonth,
    FinanceCompanySettings,
    FinanceDeferredContract,
    FinanceDeferredPeriod,
    FinanceJournalEntry,
    FinanceJournalLine,
    FinanceJournalTemplate,
    FinanceProduct,
    FinanceStockBalance,
    FinanceStockLayer,
    FinanceStockMovement,
    FinanceWarehouse,
    User,
    UserRole,
)
from app.schemas.finance import (
    AccountRead,
    AccountTypeRollupRead,
    BudgetMonthPut,
    BudgetMonthRead,
    DeferredContractCreate,
    DeferredContractRead,
    DeferredPeriodRead,
    FinanceConsistencyRead,
    FinanceDashboardRead,
    FinanceForecastRead,
    FinancePeriodSummaryRead,
    FinanceSettingsPatch,
    FinanceSettingsRead,
    ForecastPointRead,
    JournalCreate,
    JournalEntryDetailRead,
    JournalEntryRead,
    JournalFromTemplateBody,
    JournalLineDetailRead,
    JournalTemplateCreate,
    JournalTemplateRead,
    OsvImportResultRead,
    PLLineRead,
    ProductCreate,
    ProductRead,
    StockBalanceRead,
    StockIssueCreate,
    StockMovementRead,
    StockReceiptCreate,
    TrialBalanceLineRead,
    WarehouseCreate,
    WarehousePatch,
    WarehouseRead,
    YearOverviewMonthRead,
)
from app.services.finance_osv_import import parse_osv_csv_text
from app.services.finance_reports import (
    account_type_rollup_rows,
    deferred_unrecognized_total,
    journal_entries_count,
    month_bounds_utc,
    period_journal_debit_credit_totals,
    pl_by_account,
    pl_totals,
    simple_revenue_forecast,
    total_inventory_value,
    trial_balance_net_for_account_code,
    trial_balance_rows,
)
from app.services.finance_seed import (
    account_id_by_code,
    build_deferred_periods_for_contract,
    ensure_default_chart,
    ensure_default_warehouse_if_inventory,
    ensure_finance_settings,
)

router = APIRouter(prefix="/finance", tags=["finance"])


def _parse_period_dates(date_from_s: str, date_to_s: str) -> tuple[datetime, datetime]:
    try:
        d0 = datetime.strptime(date_from_s.strip(), "%Y-%m-%d").replace(tzinfo=UTC)
        d1 = datetime.strptime(date_to_s.strip(), "%Y-%m-%d").replace(
            hour=23,
            minute=59,
            second=59,
            microsecond=999000,
            tzinfo=UTC,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail="date_from / date_to: формат YYYY-MM-DD") from e
    if d1 < d0:
        raise HTTPException(status_code=400, detail="date_to не может быть раньше date_from")
    return d0, d1

_COSTING = frozenset({"fifo", "average"})
_GOODS_REV = frozenset({"payment", "shipment", "invoice"})
_SERV_REV = frozenset({"deferred_period", "payment", "shipment"})


def _finance_allowed(user: User) -> bool:
    return user.role in (UserRole.owner, UserRole.admin, UserRole.super_owner)


async def _require_finance(user: CurrentUser) -> None:
    if not _finance_allowed(user):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Нет доступа к финансам")


async def _ready_finance(db: AsyncSession, company_id: int) -> FinanceCompanySettings:
    s = await ensure_finance_settings(db, company_id)
    await ensure_default_chart(db, company_id)
    await ensure_default_warehouse_if_inventory(db, company_id, s)
    return s


async def _assert_journal_period_unlocked(db: AsyncSession, company_id: int, entry_date: datetime) -> None:
    s = await db.scalar(select(FinanceCompanySettings).where(FinanceCompanySettings.company_id == company_id))
    if s is None or s.posting_locked_until is None:
        return
    lock = s.posting_locked_until
    ed = entry_date.date() if isinstance(entry_date, datetime) else entry_date
    if ed <= lock:
        raise HTTPException(
            status_code=400,
            detail=f"Период закрыт: проводки с датой ≤ {lock.isoformat()} запрещены. Измените «Блокировка проводок до» в настройках финансов.",
        )


async def _post_balanced_journal(
    db: AsyncSession,
    *,
    company_id: int,
    user_id: int | None,
    entry_date: datetime,
    memo: str | None,
    source_type: str,
    lines: list[tuple[int, Decimal, Decimal]],
    skip_period_lock: bool = False,
) -> FinanceJournalEntry:
    if not skip_period_lock:
        await _assert_journal_period_unlocked(db, company_id, entry_date)
    td = Decimal("0")
    tc = Decimal("0")
    for _, d, c in lines:
        td += d
        tc += c
    if td != tc or td <= 0:
        raise HTTPException(status_code=400, detail="Проводки должны быть сбалансированы (сумма дебет = кредит) и больше нуля")
    ent = FinanceJournalEntry(
        company_id=company_id,
        entry_date=entry_date,
        memo=memo,
        source_type=source_type,
        created_by_user_id=user_id,
    )
    db.add(ent)
    await db.flush()
    for acc_id, d, c in lines:
        db.add(FinanceJournalLine(entry_id=ent.id, account_id=acc_id, debit=d, credit=c))
    await db.flush()
    return ent


@router.get("/settings", response_model=FinanceSettingsRead)
async def get_finance_settings(
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentUser,
    company_id: CurrentCompanyId,
) -> FinanceCompanySettings:
    await _require_finance(current_user)
    return await _ready_finance(db, company_id)


@router.patch("/settings", response_model=FinanceSettingsRead)
async def patch_finance_settings(
    body: FinanceSettingsPatch,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentUser,
    company_id: CurrentCompanyId,
) -> FinanceCompanySettings:
    await _require_finance(current_user)
    row = await _ready_finance(db, company_id)
    if body.inventory_enabled is not None:
        row.inventory_enabled = body.inventory_enabled
    if body.costing_method is not None:
        if body.costing_method not in _COSTING:
            raise HTTPException(400, detail="costing_method: fifo или average")
        row.costing_method = body.costing_method
    if body.revenue_goods_policy is not None:
        if body.revenue_goods_policy not in _GOODS_REV:
            raise HTTPException(400, detail="revenue_goods_policy: payment, shipment или invoice")
        row.revenue_goods_policy = body.revenue_goods_policy
    if body.revenue_services_policy is not None:
        if body.revenue_services_policy not in _SERV_REV:
            raise HTTPException(400, detail="revenue_services_policy: deferred_period, payment или shipment")
        row.revenue_services_policy = body.revenue_services_policy
    if "posting_locked_until" in body.model_fields_set:
        row.posting_locked_until = body.posting_locked_until
    await db.flush()
    await ensure_default_warehouse_if_inventory(db, company_id, row)
    await db.commit()
    await db.refresh(row)
    return row


@router.get("/warehouses", response_model=list[WarehouseRead])
async def list_warehouses(
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentUser,
    company_id: CurrentCompanyId,
) -> list[FinanceWarehouse]:
    await _require_finance(current_user)
    await _ready_finance(db, company_id)
    r = await db.execute(
        select(FinanceWarehouse).where(FinanceWarehouse.company_id == company_id).order_by(FinanceWarehouse.sort_order, FinanceWarehouse.id),
    )
    return list(r.scalars().all())


@router.post("/warehouses", response_model=WarehouseRead, status_code=status.HTTP_201_CREATED)
async def create_warehouse(
    body: WarehouseCreate,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentUser,
    company_id: CurrentCompanyId,
) -> FinanceWarehouse:
    await _require_finance(current_user)
    await _ready_finance(db, company_id)
    if body.is_default:
        rows = (await db.execute(select(FinanceWarehouse).where(FinanceWarehouse.company_id == company_id))).scalars().all()
        for w in rows:
            w.is_default = False
    w = FinanceWarehouse(
        company_id=company_id,
        name=body.name.strip(),
        code=(body.code or "").strip() or None,
        sort_order=body.sort_order,
        is_default=body.is_default,
    )
    db.add(w)
    await db.flush()
    await db.commit()
    await db.refresh(w)
    return w


@router.patch("/warehouses/{warehouse_id}", response_model=WarehouseRead)
async def patch_warehouse(
    warehouse_id: int,
    body: WarehousePatch,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentUser,
    company_id: CurrentCompanyId,
) -> FinanceWarehouse:
    await _require_finance(current_user)
    w = await db.get(FinanceWarehouse, warehouse_id)
    if w is None or w.company_id != company_id:
        raise HTTPException(404, detail="Склад не найден")
    if body.name is not None:
        w.name = body.name.strip()
    if body.code is not None:
        w.code = body.code.strip() or None
    if body.is_active is not None:
        w.is_active = body.is_active
    if body.sort_order is not None:
        w.sort_order = body.sort_order
    if body.is_default is True:
        others = (await db.execute(select(FinanceWarehouse).where(FinanceWarehouse.company_id == company_id))).scalars().all()
        for o in others:
            o.is_default = o.id == warehouse_id
    await db.flush()
    await db.commit()
    await db.refresh(w)
    return w


@router.get("/accounts", response_model=list[AccountRead])
async def list_accounts(
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentUser,
    company_id: CurrentCompanyId,
) -> list[FinanceAccount]:
    await _require_finance(current_user)
    await _ready_finance(db, company_id)
    r = await db.execute(
        select(FinanceAccount).where(FinanceAccount.company_id == company_id).order_by(FinanceAccount.sort_order, FinanceAccount.code),
    )
    return list(r.scalars().all())


@router.post("/journal", response_model=JournalEntryRead, status_code=status.HTTP_201_CREATED)
async def post_manual_journal(
    body: JournalCreate,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentUser,
    company_id: CurrentCompanyId,
) -> FinanceJournalEntry:
    await _require_finance(current_user)
    await _ready_finance(db, company_id)
    lines: list[tuple[int, Decimal, Decimal]] = []
    for ln in body.lines:
        acc = await db.get(FinanceAccount, ln.account_id)
        if acc is None or acc.company_id != company_id:
            raise HTTPException(400, detail=f"Счёт {ln.account_id} не найден")
        if ln.debit > 0 and ln.credit > 0:
            raise HTTPException(400, detail="В одной строке не может быть одновременно дебет и кредит")
        if ln.debit <= 0 and ln.credit <= 0:
            raise HTTPException(400, detail="В каждой строке укажите либо дебет, либо кредит")
        lines.append((ln.account_id, ln.debit, ln.credit))
    ent = await _post_balanced_journal(
        db,
        company_id=company_id,
        user_id=current_user.id,
        entry_date=body.entry_date,
        memo=body.memo,
        source_type="manual",
        lines=lines,
    )
    await db.commit()
    await db.refresh(ent)
    return ent


@router.get("/journal-entries", response_model=list[JournalEntryDetailRead])
async def list_journal_entries(
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentUser,
    company_id: CurrentCompanyId,
    limit: int = Query(80, ge=1, le=200),
    source_type: str | None = Query(None, max_length=40),
    date_from: str | None = Query(None, description="YYYY-MM-DD, вместе с date_to"),
    date_to: str | None = Query(None, description="YYYY-MM-DD"),
    account_id: int | None = Query(None, ge=1),
) -> list[JournalEntryDetailRead]:
    await _require_finance(current_user)
    await _ready_finance(db, company_id)
    q = select(FinanceJournalEntry).where(FinanceJournalEntry.company_id == company_id)
    if source_type:
        q = q.where(FinanceJournalEntry.source_type == source_type.strip())
    if (date_from or date_to) and (not date_from or not date_to):
        raise HTTPException(status_code=400, detail="Укажите оба date_from и date_to для фильтра по датам")
    if date_from and date_to:
        d0, d1 = _parse_period_dates(date_from, date_to)
        q = q.where(FinanceJournalEntry.entry_date >= d0, FinanceJournalEntry.entry_date <= d1)
    if account_id is not None:
        acc = await db.get(FinanceAccount, account_id)
        if acc is None or acc.company_id != company_id:
            raise HTTPException(status_code=404, detail="Счёт не найден")
        line_entry_ids = select(FinanceJournalLine.entry_id).where(FinanceJournalLine.account_id == account_id).distinct()
        q = q.where(FinanceJournalEntry.id.in_(line_entry_ids))
    q = q.order_by(FinanceJournalEntry.entry_date.desc(), FinanceJournalEntry.id.desc()).limit(limit)
    entries = list((await db.execute(q)).scalars().all())
    if not entries:
        return []
    eids = [e.id for e in entries]
    line_rows = (
        await db.execute(
            select(FinanceJournalLine, FinanceAccount.code, FinanceAccount.name)
            .join(FinanceAccount, FinanceAccount.id == FinanceJournalLine.account_id)
            .where(FinanceJournalLine.entry_id.in_(eids))
            .order_by(FinanceJournalLine.entry_id.asc(), FinanceJournalLine.id.asc()),
        )
    ).all()
    by_entry: dict[int, list[JournalLineDetailRead]] = {i: [] for i in eids}
    for ln, code, name in line_rows:
        by_entry[ln.entry_id].append(
            JournalLineDetailRead(account_code=code, account_name=name, debit=ln.debit, credit=ln.credit),
        )
    out: list[JournalEntryDetailRead] = []
    for ent in entries:
        out.append(
            JournalEntryDetailRead(
                id=ent.id,
                entry_date=ent.entry_date,
                memo=ent.memo,
                source_type=ent.source_type,
                created_at=ent.created_at,
                lines=by_entry.get(ent.id, []),
            ),
        )
    return out


@router.get("/stock/movements", response_model=list[StockMovementRead])
async def list_stock_movements(
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentUser,
    company_id: CurrentCompanyId,
    limit: int = Query(100, ge=1, le=500),
) -> list[StockMovementRead]:
    await _require_finance(current_user)
    settings = await _ready_finance(db, company_id)
    if not settings.inventory_enabled:
        return []
    r = await db.execute(
        select(FinanceStockMovement, FinanceWarehouse.name, FinanceProduct.name)
        .join(FinanceWarehouse, FinanceWarehouse.id == FinanceStockMovement.warehouse_id)
        .join(FinanceProduct, FinanceProduct.id == FinanceStockMovement.product_id)
        .where(FinanceStockMovement.company_id == company_id)
        .order_by(FinanceStockMovement.created_at.desc(), FinanceStockMovement.id.desc())
        .limit(limit),
    )
    out: list[StockMovementRead] = []
    for mv, wh_name, prod_name in r.all():
        out.append(
            StockMovementRead(
                id=mv.id,
                created_at=mv.created_at,
                movement_type=mv.movement_type,
                qty_delta=mv.qty_delta,
                unit_cost=mv.unit_cost,
                memo=mv.memo,
                warehouse_id=mv.warehouse_id,
                warehouse_name=wh_name,
                product_id=mv.product_id,
                product_name=prod_name,
            ),
        )
    return out


@router.get("/reports/period-summary", response_model=FinancePeriodSummaryRead)
async def report_period_summary(
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentUser,
    company_id: CurrentCompanyId,
    date_from: str = Query(..., description="YYYY-MM-DD"),
    date_to: str = Query(..., description="YYYY-MM-DD"),
) -> FinancePeriodSummaryRead:
    await _require_finance(current_user)
    settings = await _ready_finance(db, company_id)
    d0, d1 = _parse_period_dates(date_from, date_to)
    rev, exp, net = await pl_totals(db, company_id, d0, d1)
    inv = await total_inventory_value(db, company_id) if settings.inventory_enabled else Decimal("0")
    deferred = await deferred_unrecognized_total(db, company_id)
    jn = await journal_entries_count(db, company_id, d0, d1)
    margin: Decimal | None = None
    if rev > 0:
        margin = (net / rev * Decimal("100")).quantize(Decimal("0.01"))
    bud_rev: Decimal | None = None
    bud_exp: Decimal | None = None
    v_rev: Decimal | None = None
    v_exp: Decimal | None = None
    budget_alert = False
    last_day = calendar.monthrange(d0.year, d0.month)[1]
    if d0.day == 1 and d1.year == d0.year and d1.month == d0.month and d1.day == last_day:
        mf, mt = month_bounds_utc(d0.year, d0.month)
        if d0 == mf and d1 == mt:
            bud = (
                await db.execute(
                    select(FinanceBudgetMonth).where(
                        FinanceBudgetMonth.company_id == company_id,
                        FinanceBudgetMonth.year == d0.year,
                        FinanceBudgetMonth.month == d0.month,
                    ),
                )
            ).scalars().first()
            if bud is not None:
                bud_rev = bud.revenue_plan
                bud_exp = bud.expense_plan
                if bud_rev and bud_rev > 0:
                    v_rev = ((rev - bud_rev) / bud_rev * Decimal("100")).quantize(Decimal("0.01"))
                if bud_exp and bud_exp > 0:
                    v_exp = ((exp - bud_exp) / bud_exp * Decimal("100")).quantize(Decimal("0.01"))
                if v_rev is not None and abs(v_rev) > Decimal("10"):
                    budget_alert = True
                if v_exp is not None and abs(v_exp) > Decimal("10"):
                    budget_alert = True
    return FinancePeriodSummaryRead(
        date_from=d0,
        date_to=d1,
        revenue_total=rev,
        expense_total=exp,
        net_income=net,
        inventory_value=inv,
        deferred_unrecognized=deferred,
        journal_entries_count=jn,
        net_margin_pct=margin,
        budget_revenue_plan=bud_rev,
        budget_expense_plan=bud_exp,
        budget_revenue_variance_pct=v_rev,
        budget_expense_variance_pct=v_exp,
        budget_alert=budget_alert,
    )


@router.get("/reports/trial-balance", response_model=list[TrialBalanceLineRead])
async def report_trial_balance(
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentUser,
    company_id: CurrentCompanyId,
    date_from: str = Query(..., description="YYYY-MM-DD"),
    date_to: str = Query(..., description="YYYY-MM-DD"),
) -> list[TrialBalanceLineRead]:
    await _require_finance(current_user)
    await _ready_finance(db, company_id)
    d0, d1 = _parse_period_dates(date_from, date_to)
    rows = await trial_balance_rows(db, company_id, d0, d1)
    return [
        TrialBalanceLineRead(
            account_code=c,
            account_name=n,
            account_type=t,
            debit_total=d,
            credit_total=crd,
            net_balance=nb,
        )
        for c, n, t, d, crd, nb in rows
    ]


@router.get("/reports/pl-lines", response_model=list[PLLineRead])
async def report_pl_lines(
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentUser,
    company_id: CurrentCompanyId,
    date_from: str = Query(..., description="YYYY-MM-DD"),
    date_to: str = Query(..., description="YYYY-MM-DD"),
) -> list[PLLineRead]:
    await _require_finance(current_user)
    await _ready_finance(db, company_id)
    d0, d1 = _parse_period_dates(date_from, date_to)
    rows = await pl_by_account(db, company_id, d0, d1, ("revenue", "expense"))
    return [PLLineRead(account_code=c, account_name=n, account_type=t, amount=a) for c, n, t, a in rows]


@router.get("/reports/account-type-rollup", response_model=list[AccountTypeRollupRead])
async def report_account_type_rollup(
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentUser,
    company_id: CurrentCompanyId,
    date_from: str = Query(..., description="YYYY-MM-DD"),
    date_to: str = Query(..., description="YYYY-MM-DD"),
) -> list[AccountTypeRollupRead]:
    await _require_finance(current_user)
    await _ready_finance(db, company_id)
    d0, d1 = _parse_period_dates(date_from, date_to)
    rows = await account_type_rollup_rows(db, company_id, d0, d1)
    return [
        AccountTypeRollupRead(account_type=t, debit_total=d, credit_total=c, net_balance=nb) for t, d, c, nb in rows
    ]


@router.get("/reports/year-overview", response_model=list[YearOverviewMonthRead])
async def report_year_overview(
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentUser,
    company_id: CurrentCompanyId,
    year: int = Query(..., ge=2000, le=2100),
) -> list[YearOverviewMonthRead]:
    await _require_finance(current_user)
    await _ready_finance(db, company_id)
    budget_rows = (
        await db.execute(select(FinanceBudgetMonth).where(FinanceBudgetMonth.company_id == company_id, FinanceBudgetMonth.year == year))
    ).scalars().all()
    by_m = {b.month: b for b in budget_rows}
    out: list[YearOverviewMonthRead] = []
    for month in range(1, 13):
        mf, mt = month_bounds_utc(year, month)
        rev, exp, net = await pl_totals(db, company_id, mf, mt)
        b = by_m.get(month)
        out.append(
            YearOverviewMonthRead(
                year=year,
                month=month,
                revenue_actual=rev,
                expense_actual=exp,
                net_actual=net,
                revenue_plan=b.revenue_plan if b else Decimal("0"),
                expense_plan=b.expense_plan if b else Decimal("0"),
            ),
        )
    return out


@router.get("/reports/forecast", response_model=FinanceForecastRead)
async def report_forecast(
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentUser,
    company_id: CurrentCompanyId,
    year: int = Query(..., ge=2000, le=2100),
    month: int = Query(..., ge=1, le=12, description="Опорный месяц: прогноз на следующие horizon месяцев"),
    horizon: int = Query(3, ge=1, le=24),
    history_depth: int = Query(3, ge=1, le=12),
) -> FinanceForecastRead:
    await _require_finance(current_user)
    await _ready_finance(db, company_id)
    avg, pts = await simple_revenue_forecast(
        db,
        company_id,
        anchor_year=year,
        anchor_month=month,
        horizon=horizon,
        history_depth=history_depth,
    )
    return FinanceForecastRead(
        baseline_months_used=history_depth,
        average_monthly_revenue=avg,
        points=[ForecastPointRead(year=y, month=m, projected_revenue=v) for y, m, v in pts],
    )


@router.put("/budgets/month", response_model=BudgetMonthRead)
async def upsert_budget_month(
    body: BudgetMonthPut,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentUser,
    company_id: CurrentCompanyId,
) -> FinanceBudgetMonth:
    await _require_finance(current_user)
    await _ready_finance(db, company_id)
    row = (
        await db.execute(
            select(FinanceBudgetMonth).where(
                FinanceBudgetMonth.company_id == company_id,
                FinanceBudgetMonth.year == body.year,
                FinanceBudgetMonth.month == body.month,
            ),
        )
    ).scalar_one_or_none()
    if row is None:
        row = FinanceBudgetMonth(
            company_id=company_id,
            year=body.year,
            month=body.month,
            revenue_plan=body.revenue_plan,
            expense_plan=body.expense_plan,
        )
        db.add(row)
    else:
        row.revenue_plan = body.revenue_plan
        row.expense_plan = body.expense_plan
    await db.flush()
    await db.commit()
    await db.refresh(row)
    return row


@router.get("/dashboard", response_model=FinanceDashboardRead)
async def finance_dashboard(
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentUser,
    company_id: CurrentCompanyId,
) -> FinanceDashboardRead:
    await _require_finance(current_user)
    settings = await _ready_finance(db, company_id)
    wh_rows = (
        await db.execute(select(FinanceWarehouse).where(FinanceWarehouse.company_id == company_id, FinanceWarehouse.is_active.is_(True)))
    ).scalars().all()
    warehouses_out: list[dict] = []
    if settings.inventory_enabled and len(wh_rows) > 1:
        for w in wh_rows:
            q = (
                select(
                    func.coalesce(func.sum(FinanceStockBalance.quantity * FinanceStockBalance.avg_unit_cost), 0),
                    func.count(FinanceStockBalance.id),
                ).where(FinanceStockBalance.warehouse_id == w.id)
            )
            val, cnt = (await db.execute(q)).one()
            warehouses_out.append(
                {
                    "warehouse_id": w.id,
                    "warehouse_name": w.name,
                    "sku_positions": int(cnt or 0),
                    "inventory_value": str(val or Decimal("0")),
                },
            )
    elif settings.inventory_enabled and len(wh_rows) == 1:
        w = wh_rows[0]
        q = select(
            func.coalesce(func.sum(FinanceStockBalance.quantity * FinanceStockBalance.avg_unit_cost), 0),
            func.count(FinanceStockBalance.id),
        ).where(FinanceStockBalance.warehouse_id == w.id)
        val, cnt = (await db.execute(q)).one()
        warehouses_out.append(
            {
                "warehouse_id": w.id,
                "warehouse_name": w.name,
                "sku_positions": int(cnt or 0),
                "inventory_value": str(val or Decimal("0")),
            },
        )
    return FinanceDashboardRead(
        warehouse_count=len(wh_rows),
        multi_warehouse=len(wh_rows) > 1,
        warehouses=warehouses_out,
        inventory_enabled=settings.inventory_enabled,
        costing_method=settings.costing_method,
    )


@router.get("/products", response_model=list[ProductRead])
async def list_products(
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentUser,
    company_id: CurrentCompanyId,
) -> list[FinanceProduct]:
    await _require_finance(current_user)
    await _ready_finance(db, company_id)
    r = await db.execute(select(FinanceProduct).where(FinanceProduct.company_id == company_id).order_by(FinanceProduct.name))
    return list(r.scalars().all())


@router.post("/products", response_model=ProductRead, status_code=status.HTTP_201_CREATED)
async def create_product(
    body: ProductCreate,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentUser,
    company_id: CurrentCompanyId,
) -> FinanceProduct:
    await _require_finance(current_user)
    await _ready_finance(db, company_id)
    pt = (body.product_type or "good").strip().lower()
    if pt not in ("good", "service"):
        raise HTTPException(400, detail="product_type: good или service")
    p = FinanceProduct(
        company_id=company_id,
        name=body.name.strip(),
        sku=(body.sku or "").strip() or None,
        product_type=pt,
        unit=(body.unit or "pcs").strip() or "pcs",
    )
    db.add(p)
    await db.flush()
    await db.commit()
    await db.refresh(p)
    return p


@router.get("/stock/balances", response_model=list[StockBalanceRead])
async def list_stock_balances(
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentUser,
    company_id: CurrentCompanyId,
) -> list[StockBalanceRead]:
    await _require_finance(current_user)
    settings = await _ready_finance(db, company_id)
    if not settings.inventory_enabled:
        return []
    r = await db.execute(
        select(FinanceStockBalance, FinanceProduct, FinanceWarehouse)
        .join(FinanceProduct, FinanceProduct.id == FinanceStockBalance.product_id)
        .join(FinanceWarehouse, FinanceWarehouse.id == FinanceStockBalance.warehouse_id)
        .where(FinanceProduct.company_id == company_id),
    )
    out: list[StockBalanceRead] = []
    for bal, prod, wh in r.all():
        val = (bal.quantity or Decimal("0")) * (bal.avg_unit_cost or Decimal("0"))
        out.append(
            StockBalanceRead(
                product_id=prod.id,
                product_name=prod.name,
                warehouse_id=wh.id,
                warehouse_name=wh.name,
                quantity=bal.quantity,
                avg_unit_cost=bal.avg_unit_cost,
                value=val.quantize(Decimal("0.01")),
            ),
        )
    return out


@router.post("/stock/receipt", status_code=status.HTTP_201_CREATED)
async def stock_receipt(
    body: StockReceiptCreate,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentUser,
    company_id: CurrentCompanyId,
) -> dict[str, int]:
    await _require_finance(current_user)
    settings = await _ready_finance(db, company_id)
    if not settings.inventory_enabled:
        raise HTTPException(400, detail="Склад выключен в настройках финансов")
    wh = await db.get(FinanceWarehouse, body.warehouse_id)
    if wh is None or wh.company_id != company_id:
        raise HTTPException(404, detail="Склад не найден")
    prod = await db.get(FinanceProduct, body.product_id)
    if prod is None or prod.company_id != company_id:
        raise HTTPException(404, detail="Номенклатура не найдена")
    if prod.product_type != "good":
        raise HTTPException(400, detail="Приход только для типа «товар»")
    q = body.quantity
    uc = body.unit_cost
    bal = await db.scalar(
        select(FinanceStockBalance).where(
            FinanceStockBalance.product_id == prod.id,
            FinanceStockBalance.warehouse_id == wh.id,
        ),
    )
    if bal is None:
        bal = FinanceStockBalance(product_id=prod.id, warehouse_id=wh.id, quantity=Decimal("0"), avg_unit_cost=Decimal("0"))
        db.add(bal)
        await db.flush()
    old_q = bal.quantity or Decimal("0")
    old_c = bal.avg_unit_cost or Decimal("0")
    new_q = old_q + q
    mv = FinanceStockMovement(
        company_id=company_id,
        warehouse_id=wh.id,
        product_id=prod.id,
        qty_delta=q,
        movement_type="receipt",
        unit_cost=uc,
        memo=body.memo,
    )
    db.add(mv)
    await db.flush()

    if settings.costing_method == "average":
        if new_q > 0:
            bal.avg_unit_cost = ((old_q * old_c) + (q * uc)) / new_q
        else:
            bal.avg_unit_cost = uc
        bal.quantity = new_q
    else:
        bal.quantity = new_q
        bal.avg_unit_cost = bal.avg_unit_cost or uc
        db.add(
            FinanceStockLayer(
                product_id=prod.id,
                warehouse_id=wh.id,
                qty_remaining=q,
                unit_cost=uc,
                movement_id=mv.id,
            ),
        )
    amount = (q * uc).quantize(Decimal("0.01"))
    acc_inv = await account_id_by_code(db, company_id, "2010")
    acc_tech = await account_id_by_code(db, company_id, "2999")
    if acc_inv and acc_tech and amount > 0:
        await _post_balanced_journal(
            db,
            company_id=company_id,
            user_id=current_user.id,
            entry_date=datetime.now(UTC),
            memo=body.memo or f"Приход {prod.name}",
            source_type="stock_receipt",
            lines=[(acc_inv, amount, Decimal("0")), (acc_tech, Decimal("0"), amount)],
        )
    await db.commit()
    return {"ok": 1}


@router.post("/stock/issue", status_code=status.HTTP_201_CREATED)
async def stock_issue(
    body: StockIssueCreate,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentUser,
    company_id: CurrentCompanyId,
) -> dict[str, str]:
    await _require_finance(current_user)
    settings = await _ready_finance(db, company_id)
    if not settings.inventory_enabled:
        raise HTTPException(400, detail="Склад выключен в настройках финансов")
    wh = await db.get(FinanceWarehouse, body.warehouse_id)
    if wh is None or wh.company_id != company_id:
        raise HTTPException(404, detail="Склад не найден")
    prod = await db.get(FinanceProduct, body.product_id)
    if prod is None or prod.company_id != company_id or prod.product_type != "good":
        raise HTTPException(404, detail="Номенклатура не найдена или не товар")
    need = body.quantity
    bal = await db.scalar(
        select(FinanceStockBalance).where(
            FinanceStockBalance.product_id == prod.id,
            FinanceStockBalance.warehouse_id == wh.id,
        ),
    )
    if bal is None or (bal.quantity or Decimal("0")) < need:
        raise HTTPException(400, detail="Недостаточно остатка")
    cost_total = Decimal("0")
    if settings.costing_method == "average":
        uc = bal.avg_unit_cost or Decimal("0")
        cost_total = (need * uc).quantize(Decimal("0.01"))
        bal.quantity = (bal.quantity or Decimal("0")) - need
    else:
        layers = (
            await db.execute(
                select(FinanceStockLayer)
                .where(
                    FinanceStockLayer.product_id == prod.id,
                    FinanceStockLayer.warehouse_id == wh.id,
                    FinanceStockLayer.qty_remaining > 0,
                )
                .order_by(FinanceStockLayer.id.asc()),
            )
        ).scalars().all()
        left = need
        for layer in layers:
            if left <= 0:
                break
            take = min(left, layer.qty_remaining)
            cost_total += take * layer.unit_cost
            layer.qty_remaining -= take
            left -= take
        if left > 0:
            raise HTTPException(400, detail="Недостаточно партий FIFO")
        bal.quantity = (bal.quantity or Decimal("0")) - need
    mv = FinanceStockMovement(
        company_id=company_id,
        warehouse_id=wh.id,
        product_id=prod.id,
        qty_delta=-need,
        movement_type="issue",
        unit_cost=None,
        memo=body.memo,
    )
    db.add(mv)
    cost_total = cost_total.quantize(Decimal("0.01"))
    acc_inv = await account_id_by_code(db, company_id, "2010")
    acc_cogs = await account_id_by_code(db, company_id, "7010")
    if acc_inv and acc_cogs and cost_total > 0:
        await _post_balanced_journal(
            db,
            company_id=company_id,
            user_id=current_user.id,
            entry_date=datetime.now(UTC),
            memo=body.memo or f"Списание {prod.name}",
            source_type="stock_issue",
            lines=[(acc_cogs, cost_total, Decimal("0")), (acc_inv, Decimal("0"), cost_total)],
        )
    await db.commit()
    return {"cost": str(cost_total)}


@router.get("/deferred-contracts", response_model=list[DeferredContractRead])
async def list_deferred(
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentUser,
    company_id: CurrentCompanyId,
) -> list[FinanceDeferredContract]:
    await _require_finance(current_user)
    await _ready_finance(db, company_id)
    r = await db.execute(select(FinanceDeferredContract).where(FinanceDeferredContract.company_id == company_id).order_by(FinanceDeferredContract.id.desc()))
    return list(r.scalars().all())


@router.post("/deferred-contracts", response_model=DeferredContractRead, status_code=status.HTTP_201_CREATED)
async def create_deferred(
    body: DeferredContractCreate,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentUser,
    company_id: CurrentCompanyId,
) -> FinanceDeferredContract:
    await _require_finance(current_user)
    await _ready_finance(db, company_id)
    if body.end_date <= body.start_date:
        raise HTTPException(400, detail="end_date должен быть позже start_date")
    c = FinanceDeferredContract(
        company_id=company_id,
        title=body.title.strip(),
        total_amount=body.total_amount,
        period_count=body.period_count,
        start_date=body.start_date,
        end_date=body.end_date,
        memo=body.memo,
    )
    db.add(c)
    await db.flush()
    await build_deferred_periods_for_contract(db, c)
    await db.commit()
    await db.refresh(c)
    return c


@router.get("/deferred-contracts/{contract_id}/periods", response_model=list[DeferredPeriodRead])
async def list_deferred_periods(
    contract_id: int,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentUser,
    company_id: CurrentCompanyId,
) -> list[FinanceDeferredPeriod]:
    await _require_finance(current_user)
    c = await db.get(FinanceDeferredContract, contract_id)
    if c is None or c.company_id != company_id:
        raise HTTPException(404, detail="Договор не найден")
    r = await db.execute(
        select(FinanceDeferredPeriod).where(FinanceDeferredPeriod.contract_id == contract_id).order_by(FinanceDeferredPeriod.period_no),
    )
    return list(r.scalars().all())


@router.post("/deferred-contracts/{contract_id}/periods/{period_no}/recognize", response_model=JournalEntryRead)
async def recognize_period(
    contract_id: int,
    period_no: int,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentUser,
    company_id: CurrentCompanyId,
) -> FinanceJournalEntry:
    await _require_finance(current_user)
    await _ready_finance(db, company_id)
    c = await db.get(FinanceDeferredContract, contract_id)
    if c is None or c.company_id != company_id:
        raise HTTPException(404, detail="Договор не найден")
    per = await db.scalar(
        select(FinanceDeferredPeriod).where(
            FinanceDeferredPeriod.contract_id == contract_id,
            FinanceDeferredPeriod.period_no == period_no,
        ),
    )
    if per is None:
        raise HTTPException(404, detail="Период не найден")
    if per.posted_at is not None:
        raise HTTPException(400, detail="Период уже признан")
    acc_def = await account_id_by_code(db, company_id, "2090")
    acc_rev = await account_id_by_code(db, company_id, "4010")
    if not acc_def or not acc_rev:
        raise HTTPException(500, detail="Не настроены счета 2090/4010")
    amt = per.amount
    ent = await _post_balanced_journal(
        db,
        company_id=company_id,
        user_id=current_user.id,
        entry_date=datetime.now(UTC),
        memo=f"Признание выручки: {c.title} период {period_no}",
        source_type="deferred_revenue",
        lines=[(acc_def, amt, Decimal("0")), (acc_rev, Decimal("0"), amt)],
    )
    per.journal_entry_id = ent.id
    per.posted_at = datetime.now(UTC)
    await db.commit()
    await db.refresh(ent)
    return ent


def _calendar_period_bounds(d0: date, d1: date) -> tuple[datetime, datetime]:
    return (
        datetime(d0.year, d0.month, d0.day, 0, 0, 0, tzinfo=UTC),
        datetime(d1.year, d1.month, d1.day, 23, 59, 59, 999000, tzinfo=UTC),
    )


@router.get("/reports/consistency", response_model=FinanceConsistencyRead)
async def report_consistency(
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentUser,
    company_id: CurrentCompanyId,
    date_from: str = Query(..., description="YYYY-MM-DD"),
    date_to: str = Query(..., description="YYYY-MM-DD"),
) -> FinanceConsistencyRead:
    await _require_finance(current_user)
    settings = await _ready_finance(db, company_id)
    d0, d1 = _parse_period_dates(date_from, date_to)
    td, tc = await period_journal_debit_credit_totals(db, company_id, d0, d1)
    diff = (td - tc).quantize(Decimal("0.01"))
    inv_net = await trial_balance_net_for_account_code(db, company_id, d0, d1, "2010")
    inv_val = await total_inventory_value(db, company_id) if settings.inventory_enabled else Decimal("0")
    return FinanceConsistencyRead(
        debit_total=td,
        credit_total=tc,
        balanced=diff == 0,
        difference=diff,
        inventory_account_code="2010",
        inventory_gl_net=inv_net,
        inventory_stock_value=inv_val,
    )


@router.get("/journal-templates", response_model=list[JournalTemplateRead])
async def list_journal_templates(
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentUser,
    company_id: CurrentCompanyId,
) -> list[JournalTemplateRead]:
    await _require_finance(current_user)
    await _ready_finance(db, company_id)
    rows = (
        await db.execute(
            select(FinanceJournalTemplate)
            .where(FinanceJournalTemplate.company_id == company_id)
            .order_by(FinanceJournalTemplate.id.desc()),
        )
    ).scalars().all()
    return [
        JournalTemplateRead(
            id=t.id,
            name=t.name,
            lines=list(t.lines or []),
            created_at=t.created_at,
        )
        for t in rows
    ]


@router.post("/journal-templates", response_model=JournalTemplateRead, status_code=status.HTTP_201_CREATED)
async def create_journal_template(
    body: JournalTemplateCreate,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentUser,
    company_id: CurrentCompanyId,
) -> JournalTemplateRead:
    await _require_finance(current_user)
    await _ready_finance(db, company_id)
    for ln in body.lines:
        if ln.debit > 0 and ln.credit > 0:
            raise HTTPException(400, detail="В строке шаблона не может быть одновременно дебет и кредит")
        if ln.debit <= 0 and ln.credit <= 0:
            raise HTTPException(400, detail="В каждой строке шаблона укажите дебет или кредит")
    t = FinanceJournalTemplate(
        company_id=company_id,
        name=body.name.strip(),
        lines=[ln.model_dump(mode="json") for ln in body.lines],
    )
    db.add(t)
    await db.commit()
    await db.refresh(t)
    return JournalTemplateRead(id=t.id, name=t.name, lines=list(t.lines or []), created_at=t.created_at)


@router.delete("/journal-templates/{template_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_journal_template(
    template_id: int,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentUser,
    company_id: CurrentCompanyId,
) -> None:
    await _require_finance(current_user)
    t = await db.get(FinanceJournalTemplate, template_id)
    if t is None or t.company_id != company_id:
        raise HTTPException(404, detail="Шаблон не найден")
    await db.delete(t)
    await db.commit()


@router.post("/journal/from-template/{template_id}", response_model=JournalEntryRead, status_code=status.HTTP_201_CREATED)
async def post_journal_from_template(
    template_id: int,
    body: JournalFromTemplateBody,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentUser,
    company_id: CurrentCompanyId,
) -> FinanceJournalEntry:
    await _require_finance(current_user)
    await _ready_finance(db, company_id)
    t = await db.get(FinanceJournalTemplate, template_id)
    if t is None or t.company_id != company_id:
        raise HTTPException(404, detail="Шаблон не найден")
    lines_out: list[tuple[int, Decimal, Decimal]] = []
    for item in t.lines or []:
        code = str(item.get("account_code") or "").strip()
        d = Decimal(str(item.get("debit", "0"))).quantize(Decimal("0.01"))
        c = Decimal(str(item.get("credit", "0"))).quantize(Decimal("0.01"))
        aid = await account_id_by_code(db, company_id, code)
        if aid is None:
            raise HTTPException(400, detail=f"Счёт с кодом {code!r} не найден")
        if d > 0 and c > 0:
            raise HTTPException(400, detail=f"Строка шаблона для {code}: и дебет, и кредит")
        if d <= 0 and c <= 0:
            continue
        lines_out.append((aid, d, c))
    if len(lines_out) < 2:
        raise HTTPException(400, detail="Мало строк для проводки")
    ent = await _post_balanced_journal(
        db,
        company_id=company_id,
        user_id=current_user.id,
        entry_date=body.entry_date,
        memo=f"Из шаблона: {t.name}",
        source_type="template",
        lines=lines_out,
    )
    await db.commit()
    await db.refresh(ent)
    return ent


@router.post("/import/osv", response_model=OsvImportResultRead)
async def import_osv_csv(
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentUser,
    company_id: CurrentCompanyId,
    file: UploadFile = File(..., description="CSV ОСВ (UTF-8), см. подсказку в UI"),
    date_from: str | None = Form(None, description="YYYY-MM-DD, если нет #PERIOD в файле"),
    date_to: str | None = Form(None, description="YYYY-MM-DD"),
    replace_period: bool = Form(False, description="Удалить прежние проводки osv_import за этот период"),
    apply: bool = Form(False, description="Записать в журнал; false — только разбор и период"),
) -> OsvImportResultRead:
    await _require_finance(current_user)
    settings = await _ready_finance(db, company_id)
    raw = await file.read()
    try:
        text = raw.decode("utf-8-sig")
    except UnicodeDecodeError as e:
        raise HTTPException(400, detail="Файл должен быть в кодировке UTF-8") from e
    try:
        parsed = parse_osv_csv_text(text)
    except ValueError as e:
        raise HTTPException(400, detail=str(e)) from e

    p_from = parsed.period_from
    p_to = parsed.period_to
    if date_from and date_to:
        p_from = datetime.strptime(date_from.strip(), "%Y-%m-%d").date()
        p_to = datetime.strptime(date_to.strip(), "%Y-%m-%d").date()
    if p_from is None or p_to is None:
        raise HTTPException(
            400,
            detail="Укажите период: первая строка файла #PERIOD=YYYY-MM-DD..YYYY-MM-DD или поля date_from/date_to формы",
        )
    if p_to < p_from:
        raise HTTPException(400, detail="date_to не может быть раньше date_from")

    d0, d1 = _calendar_period_bounds(p_from, p_to)
    warnings = list(parsed.warnings)
    missing: list[str] = []

    if not apply:
        return OsvImportResultRead(
            applied=False,
            date_from=p_from.isoformat(),
            date_to=p_to.isoformat(),
            rows_parsed=len(parsed.rows),
            journal_entry_id=None,
            warnings=warnings,
            accounts_missing=missing,
        )

    await _assert_journal_period_unlocked(db, company_id, d1)

    agg: dict[int, tuple[Decimal, Decimal]] = {}
    for row in parsed.rows:
        aid = await account_id_by_code(db, company_id, row.account_code.strip())
        if aid is None:
            missing.append(row.account_code.strip())
            continue
        td, tc = agg.get(aid, (Decimal("0"), Decimal("0")))
        agg[aid] = (td + row.debit, tc + row.credit)

    if missing:
        raise HTTPException(400, detail=f"Не найдены счета в плане счетов: {', '.join(missing)}")

    lines: list[tuple[int, Decimal, Decimal]] = []
    for aid, (td, tc) in agg.items():
        net = td - tc
        if net > 0:
            lines.append((aid, net, Decimal("0")))
        elif net < 0:
            lines.append((aid, Decimal("0"), -net))

    td_tot = sum(x[1] for x in lines)
    tc_tot = sum(x[2] for x in lines)
    bal = td_tot - tc_tot
    tech_id = await account_id_by_code(db, company_id, "2999")
    if tech_id is None:
        raise HTTPException(500, detail="Не найден технический счёт 2999")
    if bal > 0:
        lines.append((tech_id, Decimal("0"), bal))
    elif bal < 0:
        lines.append((tech_id, -bal, Decimal("0")))

    if not lines or sum(x[1] for x in lines) <= 0:
        raise HTTPException(400, detail="Нет данных для проводки (все обороты нулевые)")

    if replace_period:
        await db.execute(
            delete(FinanceJournalEntry).where(
                FinanceJournalEntry.company_id == company_id,
                FinanceJournalEntry.source_type == "osv_import",
                FinanceJournalEntry.entry_date >= d0,
                FinanceJournalEntry.entry_date <= d1,
            ),
        )

    memo = f"Импорт ОСВ {p_from.isoformat()}..{p_to.isoformat()}"
    ent = await _post_balanced_journal(
        db,
        company_id=company_id,
        user_id=current_user.id,
        entry_date=d1,
        memo=memo,
        source_type="osv_import",
        lines=lines,
    )
    settings.last_osv_import_from = p_from
    settings.last_osv_import_to = p_to
    await db.flush()
    await db.commit()
    await db.refresh(ent)
    return OsvImportResultRead(
        applied=True,
        date_from=p_from.isoformat(),
        date_to=p_to.isoformat(),
        rows_parsed=len(parsed.rows),
        journal_entry_id=ent.id,
        warnings=warnings,
        accounts_missing=[],
    )
