"""Сид плана счетов и настроек финансов по компании."""

from datetime import timedelta
from decimal import Decimal

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import (
    FinanceAccount,
    FinanceCompanySettings,
    FinanceDeferredContract,
    FinanceDeferredPeriod,
    FinanceWarehouse,
)


DEFAULT_ACCOUNTS: list[tuple[str, str, str, bool]] = [
    ("1010", "Касса", "asset", True),
    ("1020", "Расчётный счёт", "asset", True),
    ("1230", "Дебиторская задолженность", "asset", True),
    ("2010", "Товары на складе", "asset", True),
    ("2090", "Отложенная выручка (услуги)", "liability", True),
    ("2999", "Технический зачёт (балансировка)", "liability", True),
    ("4010", "Выручка — услуги", "revenue", True),
    ("4020", "Выручка — товары", "revenue", True),
    ("7010", "Себестоимость товаров", "expense", True),
    ("7110", "Расходы на персонал", "expense", True),
]

CLINIC_EXTRA_ACCOUNT_CODES = frozenset({"1230", "7110"})


async def ensure_finance_settings(db: AsyncSession, company_id: int) -> FinanceCompanySettings:
    row = (
        await db.execute(select(FinanceCompanySettings).where(FinanceCompanySettings.company_id == company_id))
    ).scalar_one_or_none()
    if row is not None:
        return row
    row = FinanceCompanySettings(company_id=company_id)
    db.add(row)
    await db.flush()
    return row


async def ensure_default_chart(db: AsyncSession, company_id: int) -> None:
    cnt = await db.scalar(select(func.count(FinanceAccount.id)).where(FinanceAccount.company_id == company_id))
    if int(cnt or 0) == 0:
        for i, (code, name, atype, is_sys) in enumerate(DEFAULT_ACCOUNTS):
            db.add(
                FinanceAccount(
                    company_id=company_id,
                    code=code,
                    name=name,
                    account_type=atype,
                    is_system=is_sys,
                    is_active=True,
                    sort_order=i,
                )
            )
        await db.flush()
        return
    existing = set(
        (await db.execute(select(FinanceAccount.code).where(FinanceAccount.company_id == company_id))).scalars().all()
    )
    for code, name, atype, is_sys in DEFAULT_ACCOUNTS:
        if code not in existing:
            db.add(
                FinanceAccount(
                    company_id=company_id,
                    code=code,
                    name=name,
                    account_type=atype,
                    is_system=is_sys,
                    is_active=True,
                    sort_order=900 + len(existing),
                )
            )
            existing.add(code)
    await db.flush()


async def ensure_default_warehouse_if_inventory(db: AsyncSession, company_id: int, settings: FinanceCompanySettings) -> None:
    if not settings.inventory_enabled:
        return
    cnt = await db.scalar(select(func.count(FinanceWarehouse.id)).where(FinanceWarehouse.company_id == company_id))
    if int(cnt or 0) > 0:
        return
    db.add(
        FinanceWarehouse(
            company_id=company_id,
            name="Основной склад",
            code="MAIN",
            is_active=True,
            sort_order=0,
            is_default=True,
        )
    )
    await db.flush()


async def account_id_by_code(db: AsyncSession, company_id: int, code: str) -> int | None:
    return await db.scalar(select(FinanceAccount.id).where(FinanceAccount.company_id == company_id, FinanceAccount.code == code))


async def build_deferred_periods_for_contract(
    db: AsyncSession,
    contract: FinanceDeferredContract,
) -> None:
    """Равномерное распределение суммы по period_count (календарные доли по дням между start и end)."""
    existing = await db.scalar(
        select(func.count(FinanceDeferredPeriod.id)).where(FinanceDeferredPeriod.contract_id == contract.id),
    )
    if int(existing or 0) > 0:
        return
    total = contract.total_amount
    n = max(int(contract.period_count), 1)
    base = (total / Decimal(n)).quantize(Decimal("0.01"))
    remainder = (total - base * Decimal(n - 1)).quantize(Decimal("0.01"))

    start = contract.start_date
    end = contract.end_date
    if n == 1:
        amounts = [total]
    else:
        amounts = [base] * (n - 1) + [remainder]
    span_sec = (end - start).total_seconds()
    for i in range(n):
        frac = (i + 1) / n
        due = start + timedelta(seconds=span_sec * frac)
        db.add(
            FinanceDeferredPeriod(
                contract_id=contract.id,
                period_no=i + 1,
                amount=amounts[i] if i < len(amounts) else Decimal("0"),
                due_date=due,
            )
        )
    await db.flush()
