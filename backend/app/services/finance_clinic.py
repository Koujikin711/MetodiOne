"""Операционные финансы клиники: дебиторка, поступления, связка CRM ↔ учёт."""

from __future__ import annotations

from datetime import UTC, datetime
from decimal import Decimal

from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import BookingAppointment, Deal, FinanceJournalEntry, FinanceJournalLine, Lead, User
from app.services.finance_seed import account_id_by_code
from app.services.finance_reports import account_balance_as_of


def _q_money(v) -> Decimal:
    return Decimal(str(v or 0)).quantize(Decimal("0.01"))


async def crm_unpaid_appointments_total(db: AsyncSession, company_id: int) -> Decimal:
    """Неоплаченный остаток по записям: service_amount − paid_amount."""
    v = await db.scalar(
        select(
            func.coalesce(
                func.sum(BookingAppointment.service_amount - BookingAppointment.paid_amount),
                0,
            ),
        ).where(
            BookingAppointment.company_id == company_id,
            BookingAppointment.service_amount > BookingAppointment.paid_amount,
        ),
    )
    return _q_money(v)


async def crm_unpaid_deals_total(db: AsyncSession, company_id: int) -> Decimal:
    """Неоплаченный остаток по доп. услугам (сделки): amount − paid_amount."""
    v = await db.scalar(
        select(func.coalesce(func.sum(Deal.amount - Deal.paid_amount), 0)).where(
            Deal.company_id == company_id,
            Deal.amount > Deal.paid_amount,
        ),
    )
    return _q_money(v)


async def crm_receivables_total(db: AsyncSession, company_id: int) -> Decimal:
    appt = await crm_unpaid_appointments_total(db, company_id)
    deals = await crm_unpaid_deals_total(db, company_id)
    return (appt + deals).quantize(Decimal("0.01"))


async def crm_collected_in_period(
    db: AsyncSession,
    company_id: int,
    date_from: datetime,
    date_to: datetime,
) -> tuple[Decimal, Decimal]:
    """(оплаты по записям за период, оплаты по сделкам за период) по updated_at."""
    appt_paid = await db.scalar(
        select(func.coalesce(func.sum(BookingAppointment.paid_amount), 0)).where(
            BookingAppointment.company_id == company_id,
            BookingAppointment.paid_amount > 0,
            BookingAppointment.updated_at >= date_from,
            BookingAppointment.updated_at <= date_to,
        ),
    )
    rev_acc = await account_id_by_code(db, company_id, "4010")
    deal_paid = Decimal("0")
    if rev_acc is not None:
        deal_paid_raw = await db.scalar(
            select(func.coalesce(func.sum(FinanceJournalLine.credit - FinanceJournalLine.debit), 0))
            .select_from(FinanceJournalLine)
            .join(FinanceJournalEntry, FinanceJournalEntry.id == FinanceJournalLine.entry_id)
            .where(
                FinanceJournalEntry.company_id == company_id,
                FinanceJournalEntry.source_type == "crm_deal_payment",
                FinanceJournalEntry.entry_date >= date_from,
                FinanceJournalEntry.entry_date <= date_to,
                FinanceJournalLine.account_id == int(rev_acc),
            ),
        )
        deal_paid = _q_money(deal_paid_raw)
    return _q_money(appt_paid), deal_paid


async def crm_service_volume_in_period(
    db: AsyncSession,
    company_id: int,
    date_from: datetime,
    date_to: datetime,
) -> Decimal:
    """Сумма service_amount записей, созданных/обновлённых в периоде (объём услуг)."""
    v = await db.scalar(
        select(func.coalesce(func.sum(BookingAppointment.service_amount), 0)).where(
            BookingAppointment.company_id == company_id,
            BookingAppointment.start_at >= date_from,
            BookingAppointment.start_at <= date_to,
        ),
    )
    return _q_money(v)


async def receivable_line_items(
    db: AsyncSession,
    company_id: int,
    *,
    limit: int = 200,
) -> list[dict]:
    """Открытые позиции дебиторки для реестра в финансах."""
    out: list[dict] = []
    appt_rows = (
        await db.execute(
            select(
                BookingAppointment.id,
                BookingAppointment.lead_id,
                BookingAppointment.patient_name,
                BookingAppointment.service_amount,
                BookingAppointment.paid_amount,
                BookingAppointment.start_at,
            )
            .where(
                BookingAppointment.company_id == company_id,
                BookingAppointment.service_amount > BookingAppointment.paid_amount,
            )
            .order_by(BookingAppointment.start_at.desc())
            .limit(limit),
        )
    ).all()
    for aid, lid, guest, svc, paid, start_at in appt_rows:
        svc_d = _q_money(svc)
        paid_d = _q_money(paid)
        out.append(
            {
                "kind": "appointment",
                "source_id": int(aid),
                "lead_id": int(lid) if lid is not None else None,
                "counterparty": (guest or "").strip() or f"Запись #{aid}",
                "amount_total": svc_d,
                "amount_paid": paid_d,
                "amount_due": (svc_d - paid_d).quantize(Decimal("0.01")),
                "occurred_at": start_at,
            },
        )

    deal_rows = (
        await db.execute(
            select(
                Deal.id,
                Deal.lead_id,
                Deal.title,
                Deal.amount,
                Deal.paid_amount,
            )
            .where(
                Deal.company_id == company_id,
                Deal.amount > Deal.paid_amount,
            )
            .order_by(Deal.id.desc())
            .limit(limit),
        )
    ).all()
    for did, lid, title, amt, paid in deal_rows:
        amt_d = _q_money(amt)
        paid_d = _q_money(paid)
        out.append(
            {
                "kind": "deal",
                "source_id": int(did),
                "lead_id": int(lid) if lid is not None else None,
                "counterparty": (title or "").strip() or f"Сделка #{did}",
                "amount_total": amt_d,
                "amount_paid": paid_d,
                "amount_due": (amt_d - paid_d).quantize(Decimal("0.01")),
                "occurred_at": None,
            },
        )

    def _sort_key(item: dict) -> float:
        dt = item.get("occurred_at")
        if dt is None:
            return 0.0
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=UTC)
        return dt.timestamp()

    out.sort(key=_sort_key, reverse=True)
    return out[:limit]


async def manager_collections_in_period(
    db: AsyncSession,
    company_id: int,
    date_from: datetime,
    date_to: datetime,
) -> list[dict]:
    """Факт поступлений по менеджерам (записи) за период — основа для выплат/KPI."""
    mgr = func.coalesce(BookingAppointment.responsible_manager_id, Lead.manager_id)
    rows = (
        await db.execute(
            select(
                mgr.label("manager_id"),
                User.full_name,
                User.email,
                func.coalesce(func.sum(BookingAppointment.paid_amount), 0),
            )
            .select_from(BookingAppointment)
            .join(Lead, Lead.id == BookingAppointment.lead_id, isouter=True)
            .join(User, User.id == mgr, isouter=True)
            .where(
                BookingAppointment.company_id == company_id,
                BookingAppointment.paid_amount > 0,
                BookingAppointment.updated_at >= date_from,
                BookingAppointment.updated_at <= date_to,
            )
            .group_by(mgr, User.full_name, User.email)
            .having(func.coalesce(func.sum(BookingAppointment.paid_amount), 0) > 0)
            .order_by(func.coalesce(func.sum(BookingAppointment.paid_amount), 0).desc()),
        )
    ).all()
    result: list[dict] = []
    for mid, fname, email, paid in rows:
        if mid is None:
            continue
        result.append(
            {
                "manager_id": int(mid),
                "manager_name": (fname or email or f"#{mid}").strip(),
                "collected_amount": _q_money(paid),
            },
        )
    return result


async def clinic_finance_snapshot(
    db: AsyncSession,
    company_id: int,
    date_from: datetime,
    date_to: datetime,
) -> dict:
    """Сводка для клиники: GL + CRM."""
    cash_1010 = await account_balance_as_of(db, company_id, "1010", date_to) or Decimal("0")
    cash_1020 = await account_balance_as_of(db, company_id, "1020", date_to) or Decimal("0")
    ar_gl = await account_balance_as_of(db, company_id, "1230", date_to) or Decimal("0")
    ar_crm = await crm_receivables_total(db, company_id)
    appt_collected, deal_collected = await crm_collected_in_period(db, company_id, date_from, date_to)
    service_volume = await crm_service_volume_in_period(db, company_id, date_from, date_to)
    return {
        "cash_balance": (cash_1010 + cash_1020).quantize(Decimal("0.01")),
        "ar_gl_balance": ar_gl,
        "ar_crm_total": ar_crm,
        "ar_appointments": await crm_unpaid_appointments_total(db, company_id),
        "ar_deals": await crm_unpaid_deals_total(db, company_id),
        "crm_collected_appointments": appt_collected,
        "crm_collected_deals": deal_collected,
        "crm_collected_total": (appt_collected + deal_collected).quantize(Decimal("0.01")),
        "crm_service_volume": service_volume,
    }
