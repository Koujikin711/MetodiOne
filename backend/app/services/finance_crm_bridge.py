from __future__ import annotations

from datetime import UTC, datetime
from decimal import Decimal

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import FinanceAccount, FinanceJournalEntry, FinanceJournalLine
from app.services.finance_seed import account_id_by_code


async def _preferred_cash_account_id(db: AsyncSession, company_id: int) -> int | None:
    cash_bank = await account_id_by_code(db, company_id, "1020")
    if cash_bank is not None:
        return int(cash_bank)
    cash_hand = await account_id_by_code(db, company_id, "1010")
    if cash_hand is not None:
        return int(cash_hand)
    return None


async def post_crm_deal_payment_once(
    db: AsyncSession,
    *,
    company_id: int,
    lead_id: int | None,
    deal_id: int,
    amount: Decimal,
    user_id: int | None,
) -> bool:
    """Постит оплату сделки в финжурнал один раз (защита от дубля по deal_id)."""
    amount = Decimal(amount or 0).quantize(Decimal("0.01"))
    if amount <= 0:
        return False
    exists = await db.scalar(
        select(FinanceJournalEntry.id).where(
            FinanceJournalEntry.company_id == company_id,
            FinanceJournalEntry.source_type == "crm_deal_payment",
            FinanceJournalEntry.related_deal_id == deal_id,
        )
    )
    if exists is not None:
        return False
    cash_acc_id = await _preferred_cash_account_id(db, company_id)
    rev_acc_id = await account_id_by_code(db, company_id, "4010")
    if cash_acc_id is None or rev_acc_id is None:
        return False
    ent = FinanceJournalEntry(
        company_id=company_id,
        entry_date=datetime.now(UTC),
        memo=f"CRM: оплата закрытой сделки #{deal_id}",
        source_type="crm_deal_payment",
        created_by_user_id=user_id,
        related_lead_id=lead_id,
        related_deal_id=deal_id,
    )
    db.add(ent)
    await db.flush()
    db.add(
        FinanceJournalLine(
            entry_id=ent.id,
            account_id=int(cash_acc_id),
            debit=amount,
            credit=Decimal("0"),
        )
    )
    db.add(
        FinanceJournalLine(
            entry_id=ent.id,
            account_id=int(rev_acc_id),
            debit=Decimal("0"),
            credit=amount,
        )
    )
    await db.flush()
    return True


async def sync_booking_payment_revenue(
    db: AsyncSession,
    *,
    company_id: int,
    lead_id: int | None,
    appointment_id: int,
    target_paid_amount: Decimal,
    user_id: int | None,
) -> bool:
    """
    Синхронизирует финжурнал с оплатой записи:
    - считает, сколько уже отражено по appointment_id;
    - допроводит только дельту (в плюс или в минус).
    """
    memo_key = f"CRM: оплата записи #{appointment_id}"
    rev_acc_id = await account_id_by_code(db, company_id, "4010")
    cash_acc_id = await _preferred_cash_account_id(db, company_id)
    if rev_acc_id is None or cash_acc_id is None:
        return False

    posted = await db.scalar(
        select(func.coalesce(func.sum(FinanceJournalLine.credit - FinanceJournalLine.debit), 0))
        .select_from(FinanceJournalLine)
        .join(FinanceJournalEntry, FinanceJournalEntry.id == FinanceJournalLine.entry_id)
        .where(
            FinanceJournalEntry.company_id == company_id,
            FinanceJournalEntry.source_type == "crm_booking_payment",
            FinanceJournalEntry.memo == memo_key,
            FinanceJournalLine.account_id == int(rev_acc_id),
        )
    )
    already_posted = Decimal(str(posted or 0)).quantize(Decimal("0.01"))
    target = Decimal(target_paid_amount or 0).quantize(Decimal("0.01"))
    delta = (target - already_posted).quantize(Decimal("0.01"))
    if delta == 0:
        return False

    ent = FinanceJournalEntry(
        company_id=company_id,
        entry_date=datetime.now(UTC),
        memo=memo_key,
        source_type="crm_booking_payment",
        created_by_user_id=user_id,
        related_lead_id=lead_id,
    )
    db.add(ent)
    await db.flush()

    amt = abs(delta)
    if delta > 0:
        # Дт деньги / Кт выручка
        db.add(FinanceJournalLine(entry_id=ent.id, account_id=int(cash_acc_id), debit=amt, credit=Decimal("0")))
        db.add(FinanceJournalLine(entry_id=ent.id, account_id=int(rev_acc_id), debit=Decimal("0"), credit=amt))
    else:
        # Возврат/коррекция вниз: Дт выручка / Кт деньги
        db.add(FinanceJournalLine(entry_id=ent.id, account_id=int(rev_acc_id), debit=amt, credit=Decimal("0")))
        db.add(FinanceJournalLine(entry_id=ent.id, account_id=int(cash_acc_id), debit=Decimal("0"), credit=amt))
    await db.flush()
    return True
