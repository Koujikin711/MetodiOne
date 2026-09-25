"""Phase 1: sync Purchase/Payment из booking/KPI/desk/extra + расчёт Paid LTV."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime
from decimal import Decimal
from typing import Iterable

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import (
    BookingAppointment,
    BookingDirection,
    ExtraServiceSale,
    ExtraServiceType,
    FinanceOsvRow,
    ManagerDeskSale,
    PatientPurchase,
    PatientPurchasePayment,
    SalesKpiManualSale,
    SalesKpiManualSalePayment,
    SalesKpiPlanItem,
)
from app.services.booking_directions import (
    is_admin_only_booking_direction_name,
    is_course_like_direction_name,
)


def _utc(dt: datetime | None) -> datetime:
    if dt is None:
        return datetime.now(UTC)
    if dt.tzinfo is None:
        return dt.replace(tzinfo=UTC)
    return dt.astimezone(UTC)


def classify_product_kind(name: str | None) -> str:
    """Таксономия продукта для Journey/LTV (без hardcode конкретных брендов услуг)."""
    n = (name or "").strip()
    k = n.casefold()
    if not k:
        return "other_service"
    if "курс 15" in k or (k.startswith("курс") and "15" in k):
        return "course_15"
    if is_admin_only_booking_direction_name(n) and ("протокол" in k or "пртокол" in k):
        return "protocol"
    if is_admin_only_booking_direction_name(n) and "курс" in k:
        return "main_course"
    if is_course_like_direction_name(n):
        if "протокол" in k or "пртокол" in k:
            return "protocol"
        if "курс" in k:
            return "main_course"
    return "other_service"


def booking_counts_as_purchase(direction_name: str | None) -> bool:
    """Курс/Протокол (KPI-пакеты) не дублируем из визитов записи."""
    return not is_admin_only_booking_direction_name(direction_name)


@dataclass(frozen=True)
class NormalizedMoneyEvent:
    """Каноническое финансовое событие для Paid LTV (после нормализации источника)."""

    signed_amount: Decimal
    is_refund: bool
    event_type: str  # payment | refund


def normalize_money_event(*, amount: Decimal | int | float | str, is_refund: bool = False) -> NormalizedMoneyEvent:
    """Единый контракт: source → signed amount / event type.

    - payment: signed_amount >= 0, is_refund=False
    - refund: signed_amount <= 0, is_refund=True (ровно один раз; |amount| не зависит от знака входа)
    - is_refund=True + amount>0 → negate once
    - is_refund=False + amount<0 → трактуем как refund
    """
    raw = Decimal(str(amount or 0))
    if is_refund or raw < 0:
        signed = -abs(raw)
        return NormalizedMoneyEvent(signed_amount=signed, is_refund=True, event_type="refund")
    return NormalizedMoneyEvent(signed_amount=raw, is_refund=False, event_type="payment")


def normalize_payment_row(pay: PatientPurchasePayment) -> NormalizedMoneyEvent:
    return normalize_money_event(amount=pay.amount or 0, is_refund=bool(pay.is_refund))


@dataclass
class LeadLtvSnapshot:
    lead_id: int
    purchase_count: int
    paid_ltv: Decimal
    sales_value: Decimal
    outstanding: Decimal
    refunds_total: Decimal
    first_purchase_at: datetime | None
    last_purchase_at: datetime | None
    lifetime_days: int | None


def compute_lead_ltv(purchases: Iterable[PatientPurchase], payments: Iterable[PatientPurchasePayment]) -> LeadLtvSnapshot:
    """Единая формула Paid LTV / Sales Value (backend-only).

    Paid LTV = sum(normalized signed money events).
    Debt/outstanding не входит в Paid LTV.
    Returned sale: Sales Value исключается; payments+refund остаются (net), без двойного вычета.
    """
    pur_list = list(purchases)
    pay_list = list(payments)
    lead_id = next((int(p.lead_id) for p in pur_list if p.lead_id is not None), 0)

    active = [p for p in pur_list if (p.status or "") not in ("cancelled",)]
    # returned purchases: sales value 0 for outstanding, but refunds still in payments
    sales_value = sum(
        (Decimal(str(p.service_amount or 0)) for p in active if (p.status or "") != "returned"),
        Decimal("0"),
    )
    events = [normalize_payment_row(x) for x in pay_list]
    paid_ltv = sum((e.signed_amount for e in events), Decimal("0"))
    refunds_total = sum((abs(e.signed_amount) for e in events if e.is_refund), Decimal("0"))
    # outstanding only on non-returned active
    outstanding = Decimal("0")
    for p in active:
        if (p.status or "") == "returned":
            continue
        sa = Decimal(str(p.service_amount or 0))
        pa = Decimal(str(p.paid_amount or 0))
        outstanding += max(sa - pa, Decimal("0"))

    times = [_utc(p.purchased_at) for p in active if p.purchased_at is not None]
    first_at = min(times) if times else None
    last_at = max(times) if times else None
    lifetime = None
    if first_at and last_at:
        lifetime = max(0, (last_at.date() - first_at.date()).days)

    return LeadLtvSnapshot(
        lead_id=lead_id,
        purchase_count=len([p for p in active if (p.status or "") != "returned"]),
        paid_ltv=paid_ltv,
        sales_value=sales_value,
        outstanding=outstanding,
        refunds_total=refunds_total,
        first_purchase_at=first_at,
        last_purchase_at=last_at,
        lifetime_days=lifetime,
    )


async def _upsert_purchase(
    db: AsyncSession,
    *,
    company_id: int,
    lead_id: int | None,
    pipeline_id: int | None,
    source_type: str,
    source_id: int,
    product_kind: str,
    product_name: str,
    service_amount: Decimal,
    paid_amount: Decimal,
    status: str,
    purchased_at: datetime,
    client_name: str | None,
    client_phone: str | None,
) -> PatientPurchase:
    existing = (
        await db.execute(
            select(PatientPurchase).where(
                PatientPurchase.company_id == company_id,
                PatientPurchase.source_type == source_type,
                PatientPurchase.source_id == source_id,
            ),
        )
    ).scalar_one_or_none()
    now = datetime.now(UTC)
    if existing is None:
        row = PatientPurchase(
            company_id=company_id,
            lead_id=lead_id,
            pipeline_id=pipeline_id,
            source_type=source_type,
            source_id=source_id,
            product_kind=product_kind,
            product_name=product_name,
            service_amount=service_amount,
            paid_amount=paid_amount,
            status=status,
            purchased_at=_utc(purchased_at),
            client_name=client_name,
            client_phone=client_phone,
            created_at=now,
            updated_at=now,
        )
        db.add(row)
        await db.flush()
        return row
    existing.lead_id = lead_id
    existing.pipeline_id = pipeline_id
    existing.product_kind = product_kind
    existing.product_name = product_name
    existing.service_amount = service_amount
    existing.paid_amount = paid_amount
    existing.status = status
    existing.purchased_at = _utc(purchased_at)
    existing.client_name = client_name
    existing.client_phone = client_phone
    existing.updated_at = now
    await db.flush()
    return existing


async def _upsert_payment(
    db: AsyncSession,
    *,
    company_id: int,
    purchase_id: int,
    source_type: str,
    source_id: int,
    amount: Decimal,
    is_refund: bool,
    paid_at: datetime,
    note: str | None = None,
) -> PatientPurchasePayment:
    norm = normalize_money_event(amount=amount, is_refund=is_refund)
    existing = (
        await db.execute(
            select(PatientPurchasePayment).where(
                PatientPurchasePayment.company_id == company_id,
                PatientPurchasePayment.source_type == source_type,
                PatientPurchasePayment.source_id == source_id,
            ),
        )
    ).scalar_one_or_none()
    if existing is None:
        row = PatientPurchasePayment(
            company_id=company_id,
            purchase_id=purchase_id,
            source_type=source_type,
            source_id=source_id,
            amount=norm.signed_amount,
            is_refund=norm.is_refund,
            paid_at=_utc(paid_at),
            note=note,
        )
        db.add(row)
        await db.flush()
        return row
    existing.purchase_id = purchase_id
    existing.amount = norm.signed_amount
    existing.is_refund = norm.is_refund
    existing.paid_at = _utc(paid_at)
    existing.note = note
    await db.flush()
    return existing


def _parse_booking_refund_appointment_id(external_key: str | None) -> int | None:
    key = (external_key or "").strip()
    if not key.startswith("booking_refund:"):
        return None
    parts = key.split(":")
    if len(parts) < 2:
        return None
    try:
        return int(parts[1])
    except ValueError:
        return None


async def _booking_refunds_by_appointment(
    db: AsyncSession,
    *,
    company_id: int,
) -> dict[int, list[tuple[int, Decimal, datetime]]]:
    """appt_id → [(osv_id, refund_abs, paid_at), ...]. Источник — Finance ОСВ."""
    rows = (
        await db.execute(
            select(FinanceOsvRow).where(
                FinanceOsvRow.company_id == company_id,
                FinanceOsvRow.source == "booking_refund",
            ),
        )
    ).scalars().all()
    out: dict[int, list[tuple[int, Decimal, datetime]]] = {}
    for row in rows:
        aid = _parse_booking_refund_appointment_id(row.external_key)
        if aid is None:
            continue
        # expense хранит −сумму; берём abs
        amt = abs(Decimal(str(row.expense or 0)))
        if amt <= 0:
            continue
        at = datetime.combine(row.txn_date, datetime.min.time(), tzinfo=UTC)
        out.setdefault(aid, []).append((int(row.id), amt, at))
    return out


async def sync_company_purchases(db: AsyncSession, company_id: int) -> dict[str, int]:
    """Идемпотентный sync ledger для компании. Без phone auto-merge."""
    stats = {"purchases": 0, "payments": 0, "skipped_course_booking": 0, "booking_refunds": 0}

    booking_refunds = await _booking_refunds_by_appointment(db, company_id=company_id)

    # --- Booking visits (не Курс/Протокол пакеты) ---
    appt_rows = (
        await db.execute(
            select(BookingAppointment, BookingDirection.name)
            .join(BookingDirection, BookingDirection.id == BookingAppointment.direction_id)
            .where(BookingAppointment.company_id == company_id),
        )
    ).all()
    for appt, dname in appt_rows:
        if not booking_counts_as_purchase(dname):
            stats["skipped_course_booking"] += 1
            continue
        st = (appt.status or "").strip()
        status = "cancelled" if st == "cancelled" else "active"
        if st == "completed":
            status = "completed"
        sa = Decimal(str(appt.service_amount or 0))
        net_paid = Decimal(str(appt.paid_amount or 0))
        refund_rows = booking_refunds.get(int(appt.id), [])
        refund_sum = sum((r[1] for r in refund_rows), Decimal("0"))
        # Gross received = net on appointment + refunds already applied (distinguishable events)
        gross_paid = net_paid + refund_sum
        pur = await _upsert_purchase(
            db,
            company_id=company_id,
            lead_id=int(appt.lead_id) if appt.lead_id is not None else None,
            pipeline_id=int(appt.pipeline_id) if appt.pipeline_id is not None else None,
            source_type="booking_appointment",
            source_id=int(appt.id),
            product_kind=classify_product_kind(dname),
            product_name=str(appt.service_title or dname or "Визит"),
            service_amount=sa,
            paid_amount=net_paid,
            status=status,
            purchased_at=appt.start_at or datetime.now(UTC),
            client_name=appt.patient_name,
            client_phone=appt.patient_phone,
        )
        stats["purchases"] += 1
        # Всегда upsert payment (в т.ч. 0), чтобы полный refund не оставлял stale amount
        await _upsert_payment(
            db,
            company_id=company_id,
            purchase_id=int(pur.id),
            source_type="booking_payment",
            source_id=int(appt.id),
            amount=gross_paid,
            is_refund=False,
            paid_at=appt.paid_at or appt.start_at or datetime.now(UTC),
        )
        stats["payments"] += 1
        for osv_id, refund_amt, refund_at in refund_rows:
            await _upsert_payment(
                db,
                company_id=company_id,
                purchase_id=int(pur.id),
                source_type="booking_refund",
                source_id=int(osv_id),
                amount=refund_amt,
                is_refund=True,
                paid_at=refund_at,
                note="booking_refund",
            )
            stats["booking_refunds"] += 1
            stats["payments"] += 1

    # --- KPI packages ---
    sale_rows = (
        await db.execute(
            select(SalesKpiManualSale, SalesKpiPlanItem.name).join(
                SalesKpiPlanItem,
                SalesKpiPlanItem.id == SalesKpiManualSale.plan_item_id,
            ).where(SalesKpiManualSale.company_id == company_id),
        )
    ).all()
    for sale, item_name in sale_rows:
        st = (sale.status or "active").strip()
        lead_id = int(sale.lead_id) if getattr(sale, "lead_id", None) is not None else None
        pur = await _upsert_purchase(
            db,
            company_id=company_id,
            lead_id=lead_id,
            pipeline_id=int(sale.pipeline_id) if sale.pipeline_id is not None else None,
            source_type="kpi_manual_sale",
            source_id=int(sale.id),
            product_kind=classify_product_kind(item_name),
            product_name=str(item_name or "Курс/протокол"),
            service_amount=Decimal(str(sale.service_amount or 0)),
            paid_amount=Decimal(str(sale.paid_amount or 0)),
            status=st,
            purchased_at=sale.sold_at or datetime.now(UTC),
            client_name=sale.client_name,
            client_phone=sale.client_phone,
        )
        stats["purchases"] += 1
        pays = (
            await db.execute(
                select(SalesKpiManualSalePayment).where(
                    SalesKpiManualSalePayment.sale_id == int(sale.id),
                ),
            )
        ).scalars().all()
        for pay in pays:
            await _upsert_payment(
                db,
                company_id=company_id,
                purchase_id=int(pur.id),
                source_type="kpi_payment",
                source_id=int(pay.id),
                amount=Decimal(str(pay.amount or 0)),
                is_refund=False,
                paid_at=pay.paid_at or datetime.now(UTC),
            )
            stats["payments"] += 1
        # Возврат пакета: payments остаются + один kpi_return (без двойного исключения sale)
        if st == "returned":
            paid_sum = sum((Decimal(str(p.amount or 0)) for p in pays), Decimal("0"))
            if paid_sum > 0:
                await _upsert_payment(
                    db,
                    company_id=company_id,
                    purchase_id=int(pur.id),
                    source_type="kpi_return",
                    source_id=int(sale.id),
                    amount=paid_sum,
                    is_refund=True,
                    paid_at=sale.returned_at or datetime.now(UTC),
                    note="KPI sale returned",
                )
                stats["payments"] += 1

    # --- Desk ---
    desk_rows = (
        await db.execute(select(ManagerDeskSale).where(ManagerDeskSale.company_id == company_id))
    ).scalars().all()
    for sale in desk_rows:
        st = (sale.status or "active").strip()
        status = "cancelled" if st == "cancelled" else "active"
        sa = Decimal(str(sale.service_amount or 0))
        pa = Decimal(str(sale.paid_amount or 0))
        pur = await _upsert_purchase(
            db,
            company_id=company_id,
            lead_id=None,
            pipeline_id=int(sale.pipeline_id) if sale.pipeline_id is not None else None,
            source_type="desk_sale",
            source_id=int(sale.id),
            product_kind="desk",
            product_name=str(sale.activity_sphere or "Продажа"),
            service_amount=sa,
            paid_amount=pa,
            status=status,
            purchased_at=sale.sold_at or datetime.now(UTC),
            client_name=sale.client_name,
            client_phone=sale.client_phone,
        )
        stats["purchases"] += 1
        if status != "cancelled":
            await _upsert_payment(
                db,
                company_id=company_id,
                purchase_id=int(pur.id),
                source_type="desk_payment",
                source_id=int(sale.id),
                amount=pa,
                is_refund=False,
                paid_at=sale.sold_at or datetime.now(UTC),
            )
            stats["payments"] += 1

    # --- Extra services ---
    extra_rows = (
        await db.execute(
            select(ExtraServiceSale, ExtraServiceType.name)
            .join(ExtraServiceType, ExtraServiceType.id == ExtraServiceSale.service_type_id)
            .where(ExtraServiceSale.company_id == company_id),
        )
    ).all()
    for sale, type_name in extra_rows:
        st = (sale.status or "active").strip()
        cancelled = st == "cancelled"
        status = "cancelled" if cancelled else "active"
        amount = Decimal(str(sale.amount or 0))
        pur = await _upsert_purchase(
            db,
            company_id=company_id,
            lead_id=None,
            pipeline_id=None,
            source_type="extra_service_sale",
            source_id=int(sale.id),
            product_kind="extra",
            product_name=str(type_name or "Доп. услуга"),
            service_amount=amount,
            paid_amount=amount if not cancelled else Decimal("0"),
            status=status,
            purchased_at=sale.sold_at or datetime.now(UTC),
            client_name=sale.client_name,
            client_phone=sale.client_phone,
        )
        stats["purchases"] += 1
        if not cancelled:
            await _upsert_payment(
                db,
                company_id=company_id,
                purchase_id=int(pur.id),
                source_type="extra_payment",
                source_id=int(sale.id),
                amount=amount,
                is_refund=False,
                paid_at=sale.sold_at or datetime.now(UTC),
            )
            stats["payments"] += 1

    await db.flush()
    return stats


async def load_lead_ltv(db: AsyncSession, *, company_id: int, lead_id: int) -> LeadLtvSnapshot:
    purchases = (
        await db.execute(
            select(PatientPurchase).where(
                PatientPurchase.company_id == company_id,
                PatientPurchase.lead_id == lead_id,
            ),
        )
    ).scalars().all()
    ids = [int(p.id) for p in purchases]
    payments: list[PatientPurchasePayment] = []
    if ids:
        payments = (
            await db.execute(
                select(PatientPurchasePayment).where(PatientPurchasePayment.purchase_id.in_(ids)),
            )
        ).scalars().all()
    snap = compute_lead_ltv(purchases, payments)
    return LeadLtvSnapshot(
        lead_id=lead_id,
        purchase_count=snap.purchase_count,
        paid_ltv=snap.paid_ltv,
        sales_value=snap.sales_value,
        outstanding=snap.outstanding,
        refunds_total=snap.refunds_total,
        first_purchase_at=snap.first_purchase_at,
        last_purchase_at=snap.last_purchase_at,
        lifetime_days=snap.lifetime_days,
    )
