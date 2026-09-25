"""Refund normalization contract for Paid LTV."""

from __future__ import annotations

from datetime import UTC, datetime
from decimal import Decimal

from app.models.patient_purchase import PatientPurchase, PatientPurchasePayment
from app.services.patient_ltv import compute_lead_ltv, normalize_money_event


def test_normalize_payment_positive():
    e = normalize_money_event(amount=Decimal("100"), is_refund=False)
    assert e.signed_amount == Decimal("100")
    assert e.is_refund is False
    assert e.event_type == "payment"


def test_normalize_refund_negative_amount():
    e = normalize_money_event(amount=Decimal("-50"), is_refund=True)
    assert e.signed_amount == Decimal("-50")
    assert e.is_refund is True
    assert e.event_type == "refund"


def test_normalize_refund_positive_amount_flagged():
    """Источник мог отдать +N + is_refund — negate once на границе."""
    e = normalize_money_event(amount=Decimal("50"), is_refund=True)
    assert e.signed_amount == Decimal("-50")
    assert e.is_refund is True


def test_normalize_negative_without_flag_is_refund():
    e = normalize_money_event(amount=Decimal("-30"), is_refund=False)
    assert e.signed_amount == Decimal("-30")
    assert e.is_refund is True


def test_partial_refund_reduces_paid_ltv_once():
    purchases = [
        PatientPurchase(
            id=1,
            company_id=1,
            lead_id=1,
            source_type="booking_appointment",
            source_id=1,
            product_kind="other_service",
            product_name="Массаж",
            service_amount=Decimal("300"),
            paid_amount=Decimal("200"),
            status="completed",
            purchased_at=datetime(2026, 1, 1, tzinfo=UTC),
        ),
    ]
    payments = [
        PatientPurchasePayment(
            id=1,
            company_id=1,
            purchase_id=1,
            source_type="booking_payment",
            source_id=1,
            amount=Decimal("300"),
            is_refund=False,
            paid_at=datetime(2026, 1, 1, tzinfo=UTC),
        ),
        PatientPurchasePayment(
            id=2,
            company_id=1,
            purchase_id=1,
            source_type="booking_refund",
            source_id=99,
            amount=Decimal("100"),
            is_refund=True,
            paid_at=datetime(2026, 1, 5, tzinfo=UTC),
        ),
    ]
    snap = compute_lead_ltv(purchases, payments)
    assert snap.paid_ltv == Decimal("200")
    assert snap.refunds_total == Decimal("100")
    assert snap.sales_value == Decimal("300")
    assert snap.outstanding == Decimal("100")  # 300 - paid_amount cache 200
    assert snap.operational_debt == Decimal("0")  # 300 - 200 - 100; refund ≠ debt


def test_full_refund_paid_ltv_zero_events_distinguishable():
    purchases = [
        PatientPurchase(
            id=1,
            company_id=1,
            lead_id=1,
            source_type="booking_appointment",
            source_id=1,
            product_kind="other_service",
            product_name="QEEG",
            service_amount=Decimal("500"),
            paid_amount=Decimal("0"),
            status="completed",
            purchased_at=datetime(2026, 2, 1, tzinfo=UTC),
        ),
    ]
    payments = [
        PatientPurchasePayment(
            id=1,
            company_id=1,
            purchase_id=1,
            source_type="booking_payment",
            source_id=1,
            amount=Decimal("500"),
            is_refund=False,
            paid_at=datetime(2026, 2, 1, tzinfo=UTC),
        ),
        PatientPurchasePayment(
            id=2,
            company_id=1,
            purchase_id=1,
            source_type="booking_refund",
            source_id=10,
            amount=Decimal("-500"),
            is_refund=True,
            paid_at=datetime(2026, 2, 2, tzinfo=UTC),
        ),
    ]
    snap = compute_lead_ltv(purchases, payments)
    assert snap.paid_ltv == Decimal("0")
    assert snap.refunds_total == Decimal("500")
    assert len(payments) == 2
    assert snap.outstanding == Decimal("500")  # math sa − net
    assert snap.operational_debt == Decimal("0")  # full refund ≠ debt


def test_returned_kpi_no_double_subtract():
    """Payments остаются + один refund; Sales Value исключён; Paid LTV = net."""
    purchases = [
        PatientPurchase(
            id=1,
            company_id=1,
            lead_id=1,
            source_type="kpi_manual_sale",
            source_id=1,
            product_kind="main_course",
            product_name="Курс",
            service_amount=Decimal("5000"),
            paid_amount=Decimal("0"),
            status="returned",
            purchased_at=datetime(2026, 3, 1, tzinfo=UTC),
        ),
    ]
    payments = [
        PatientPurchasePayment(
            id=1,
            company_id=1,
            purchase_id=1,
            source_type="kpi_payment",
            source_id=1,
            amount=Decimal("2000"),
            is_refund=False,
            paid_at=datetime(2026, 3, 1, tzinfo=UTC),
        ),
        PatientPurchasePayment(
            id=2,
            company_id=1,
            purchase_id=1,
            source_type="kpi_return",
            source_id=1,
            amount=Decimal("2000"),
            is_refund=True,
            paid_at=datetime(2026, 3, 10, tzinfo=UTC),
        ),
    ]
    snap = compute_lead_ltv(purchases, payments)
    assert snap.sales_value == Decimal("0")
    assert snap.paid_ltv == Decimal("0")
    assert snap.refunds_total == Decimal("2000")
    assert snap.purchase_count == 0
    assert snap.outstanding == Decimal("0")
    assert snap.operational_debt == Decimal("0")


def test_debt_does_not_inflate_paid_ltv():
    purchases = [
        PatientPurchase(
            id=1,
            company_id=1,
            lead_id=1,
            source_type="kpi_manual_sale",
            source_id=1,
            product_kind="protocol",
            product_name="Протокол",
            service_amount=Decimal("10000"),
            paid_amount=Decimal("1000"),
            status="active",
            purchased_at=datetime(2026, 4, 1, tzinfo=UTC),
        ),
    ]
    payments = [
        PatientPurchasePayment(
            id=1,
            company_id=1,
            purchase_id=1,
            source_type="kpi_payment",
            source_id=1,
            amount=Decimal("1000"),
            is_refund=False,
            paid_at=datetime(2026, 4, 1, tzinfo=UTC),
        ),
    ]
    snap = compute_lead_ltv(purchases, payments)
    assert snap.paid_ltv == Decimal("1000")
    assert snap.sales_value == Decimal("10000")
    assert snap.outstanding == Decimal("9000")
    assert snap.operational_debt == Decimal("9000")
