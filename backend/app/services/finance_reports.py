"""Агрегаты для дашбордов и отчётности (P&L, ОСВ, запасы, отложенная выручка)."""

from __future__ import annotations

import calendar
from datetime import UTC, datetime
from decimal import Decimal

from sqlalchemy import case, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import (
    FinanceAccount,
    FinanceDeferredContract,
    FinanceDeferredPeriod,
    FinanceJournalEntry,
    FinanceJournalLine,
    FinanceProduct,
    FinanceStockBalance,
)


def shift_month(year: int, month: int, delta: int) -> tuple[int, int]:
    m = month + delta
    y = year
    while m > 12:
        m -= 12
        y += 1
    while m < 1:
        m += 12
        y -= 1
    return y, m


def month_bounds_utc(year: int, month: int) -> tuple[datetime, datetime]:
    last = calendar.monthrange(year, month)[1]
    start = datetime(year, month, 1, 0, 0, 0, tzinfo=UTC)
    end = datetime(year, month, last, 23, 59, 59, tzinfo=UTC)
    return start, end


async def total_inventory_value(db: AsyncSession, company_id: int) -> Decimal:
    q = (
        select(func.coalesce(func.sum(FinanceStockBalance.quantity * FinanceStockBalance.avg_unit_cost), 0))
        .select_from(FinanceStockBalance)
        .join(FinanceProduct, FinanceProduct.id == FinanceStockBalance.product_id)
        .where(FinanceProduct.company_id == company_id)
    )
    v = (await db.execute(q)).scalar_one()
    return Decimal(str(v or 0)).quantize(Decimal("0.01"))


async def deferred_unrecognized_total(db: AsyncSession, company_id: int) -> Decimal:
    q = (
        select(func.coalesce(func.sum(FinanceDeferredPeriod.amount), 0))
        .select_from(FinanceDeferredPeriod)
        .join(FinanceDeferredContract, FinanceDeferredContract.id == FinanceDeferredPeriod.contract_id)
        .where(
            FinanceDeferredContract.company_id == company_id,
            FinanceDeferredPeriod.posted_at.is_(None),
        )
    )
    v = (await db.execute(q)).scalar_one()
    return Decimal(str(v or 0)).quantize(Decimal("0.01"))


async def journal_entries_count(
    db: AsyncSession,
    company_id: int,
    date_from: datetime,
    date_to: datetime,
) -> int:
    q = select(func.count(FinanceJournalEntry.id)).where(
        FinanceJournalEntry.company_id == company_id,
        FinanceJournalEntry.entry_date >= date_from,
        FinanceJournalEntry.entry_date <= date_to,
    )
    return int((await db.execute(q)).scalar_one() or 0)


async def pl_totals(
    db: AsyncSession,
    company_id: int,
    date_from: datetime,
    date_to: datetime,
) -> tuple[Decimal, Decimal, Decimal]:
    """Выручка (кредит−дебет по revenue), расходы (дебет−кредит по expense), чистый результат."""
    rev_expr = FinanceJournalLine.credit - FinanceJournalLine.debit
    exp_expr = FinanceJournalLine.debit - FinanceJournalLine.credit
    stmt = (
        select(
            func.coalesce(
                func.sum(case((FinanceAccount.account_type == "revenue", rev_expr), else_=Decimal("0"))),
                0,
            ).label("rev"),
            func.coalesce(
                func.sum(case((FinanceAccount.account_type == "expense", exp_expr), else_=Decimal("0"))),
                0,
            ).label("exp"),
        )
        .select_from(FinanceJournalLine)
        .join(FinanceJournalEntry, FinanceJournalEntry.id == FinanceJournalLine.entry_id)
        .join(FinanceAccount, FinanceAccount.id == FinanceJournalLine.account_id)
        .where(
            FinanceJournalEntry.company_id == company_id,
            FinanceAccount.company_id == company_id,
            FinanceJournalEntry.entry_date >= date_from,
            FinanceJournalEntry.entry_date <= date_to,
        )
    )
    row = (await db.execute(stmt)).one()
    rev = Decimal(str(row.rev or 0)).quantize(Decimal("0.01"))
    exp = Decimal(str(row.exp or 0)).quantize(Decimal("0.01"))
    net = (rev - exp).quantize(Decimal("0.01"))
    return rev, exp, net


async def pl_by_account(
    db: AsyncSession,
    company_id: int,
    date_from: datetime,
    date_to: datetime,
    account_types: tuple[str, ...],
) -> list[tuple[str, str, str, Decimal]]:
    """Список (code, name, type, net_amount) по счетам с ненулевым оборотом за период."""
    rev_expr = FinanceJournalLine.credit - FinanceJournalLine.debit
    exp_expr = FinanceJournalLine.debit - FinanceJournalLine.credit
    net_case = case(
        (FinanceAccount.account_type == "revenue", rev_expr),
        (FinanceAccount.account_type == "expense", exp_expr),
        else_=FinanceJournalLine.debit - FinanceJournalLine.credit,
    )
    stmt = (
        select(
            FinanceAccount.code,
            FinanceAccount.name,
            FinanceAccount.account_type,
            func.coalesce(func.sum(net_case), 0).label("net"),
        )
        .select_from(FinanceJournalLine)
        .join(FinanceJournalEntry, FinanceJournalEntry.id == FinanceJournalLine.entry_id)
        .join(FinanceAccount, FinanceAccount.id == FinanceJournalLine.account_id)
        .where(
            FinanceJournalEntry.company_id == company_id,
            FinanceAccount.company_id == company_id,
            FinanceAccount.account_type.in_(account_types),
            FinanceJournalEntry.entry_date >= date_from,
            FinanceJournalEntry.entry_date <= date_to,
        )
        .group_by(FinanceAccount.id, FinanceAccount.code, FinanceAccount.name, FinanceAccount.account_type)
        .having(func.coalesce(func.sum(net_case), 0) != 0)
        .order_by(FinanceAccount.account_type, FinanceAccount.code)
    )
    rows = (await db.execute(stmt)).all()
    out: list[tuple[str, str, str, Decimal]] = []
    for code, name, atype, net in rows:
        out.append((code, name, atype, Decimal(str(net or 0)).quantize(Decimal("0.01"))))
    return out


async def trial_balance_rows(
    db: AsyncSession,
    company_id: int,
    date_from: datetime,
    date_to: datetime,
) -> list[tuple[str, str, str, Decimal, Decimal, Decimal]]:
    """По счетам: код, название, тип, дебет, кредит, сальдо (Дт−Кт) за период."""
    stmt = (
        select(
            FinanceAccount.code,
            FinanceAccount.name,
            FinanceAccount.account_type,
            func.coalesce(func.sum(FinanceJournalLine.debit), 0).label("sdebit"),
            func.coalesce(func.sum(FinanceJournalLine.credit), 0).label("scredit"),
        )
        .select_from(FinanceJournalLine)
        .join(FinanceJournalEntry, FinanceJournalEntry.id == FinanceJournalLine.entry_id)
        .join(FinanceAccount, FinanceAccount.id == FinanceJournalLine.account_id)
        .where(
            FinanceJournalEntry.company_id == company_id,
            FinanceAccount.company_id == company_id,
            FinanceJournalEntry.entry_date >= date_from,
            FinanceJournalEntry.entry_date <= date_to,
        )
        .group_by(FinanceAccount.id, FinanceAccount.code, FinanceAccount.name, FinanceAccount.account_type)
        .having(
            (func.coalesce(func.sum(FinanceJournalLine.debit), 0) != 0)
            | (func.coalesce(func.sum(FinanceJournalLine.credit), 0) != 0),
        )
        .order_by(FinanceAccount.code)
    )
    rows = (await db.execute(stmt)).all()
    out: list[tuple[str, str, str, Decimal, Decimal, Decimal]] = []
    for code, name, atype, sd, sc in rows:
        d = Decimal(str(sd or 0)).quantize(Decimal("0.01"))
        c = Decimal(str(sc or 0)).quantize(Decimal("0.01"))
        out.append((code, name, atype, d, c, (d - c).quantize(Decimal("0.01"))))
    return out


async def simple_revenue_forecast(
    db: AsyncSession,
    company_id: int,
    *,
    anchor_year: int,
    anchor_month: int,
    horizon: int,
    history_depth: int = 3,
) -> tuple[Decimal, list[tuple[int, int, Decimal]]]:
    """Средняя выручка за history_depth полных месяцев до anchor; прогноз выручки на horizon следующих месяцев."""
    revs: list[Decimal] = []
    for i in range(1, history_depth + 1):
        y, m = shift_month(anchor_year, anchor_month, -i)
        mf, mt = month_bounds_utc(y, m)
        r, _, _ = await pl_totals(db, company_id, mf, mt)
        revs.append(r)
    avg = (sum(revs) / len(revs)).quantize(Decimal("0.01")) if revs else Decimal("0")
    pts: list[tuple[int, int, Decimal]] = []
    for j in range(1, horizon + 1):
        y, m = shift_month(anchor_year, anchor_month, j)
        pts.append((y, m, avg))
    return avg, pts


async def account_type_rollup_rows(
    db: AsyncSession,
    company_id: int,
    date_from: datetime,
    date_to: datetime,
) -> list[tuple[str, Decimal, Decimal, Decimal]]:
    """Суммы Дт/Кт и сальдо по классу счёта (asset, liability, …) за период."""
    stmt = (
        select(
            FinanceAccount.account_type,
            func.coalesce(func.sum(FinanceJournalLine.debit), 0).label("sdebit"),
            func.coalesce(func.sum(FinanceJournalLine.credit), 0).label("scredit"),
        )
        .select_from(FinanceJournalLine)
        .join(FinanceJournalEntry, FinanceJournalEntry.id == FinanceJournalLine.entry_id)
        .join(FinanceAccount, FinanceAccount.id == FinanceJournalLine.account_id)
        .where(
            FinanceJournalEntry.company_id == company_id,
            FinanceAccount.company_id == company_id,
            FinanceJournalEntry.entry_date >= date_from,
            FinanceJournalEntry.entry_date <= date_to,
        )
        .group_by(FinanceAccount.account_type)
        .order_by(FinanceAccount.account_type)
    )
    rows = (await db.execute(stmt)).all()
    out: list[tuple[str, Decimal, Decimal, Decimal]] = []
    for atype, sd, sc in rows:
        d = Decimal(str(sd or 0)).quantize(Decimal("0.01"))
        c = Decimal(str(sc or 0)).quantize(Decimal("0.01"))
        out.append((atype, d, c, (d - c).quantize(Decimal("0.01"))))
    return out


async def period_journal_debit_credit_totals(
    db: AsyncSession,
    company_id: int,
    date_from: datetime,
    date_to: datetime,
) -> tuple[Decimal, Decimal]:
    """Суммарный дебет и кредит по всем строкам журнала за период (контроль двойной записи)."""
    stmt = (
        select(
            func.coalesce(func.sum(FinanceJournalLine.debit), 0),
            func.coalesce(func.sum(FinanceJournalLine.credit), 0),
        )
        .select_from(FinanceJournalLine)
        .join(FinanceJournalEntry, FinanceJournalEntry.id == FinanceJournalLine.entry_id)
        .where(
            FinanceJournalEntry.company_id == company_id,
            FinanceJournalEntry.entry_date >= date_from,
            FinanceJournalEntry.entry_date <= date_to,
        )
    )
    row = (await db.execute(stmt)).one()
    td = Decimal(str(row[0] or 0)).quantize(Decimal("0.01"))
    tc = Decimal(str(row[1] or 0)).quantize(Decimal("0.01"))
    return td, tc


async def trial_balance_net_for_account_code(
    db: AsyncSession,
    company_id: int,
    date_from: datetime,
    date_to: datetime,
    account_code: str,
) -> Decimal:
    rows = await trial_balance_rows(db, company_id, date_from, date_to)
    for c, _n, _t, _d, _cr, nb in rows:
        if c == account_code:
            return nb
    return Decimal("0")
