"""Unit tests Phase 1: product classify, double-count guard, Paid LTV formula."""

from __future__ import annotations

from datetime import UTC, datetime
from decimal import Decimal

from app.models.patient_purchase import PatientPurchase, PatientPurchasePayment
from app.services.patient_ltv import (
    booking_counts_as_purchase,
    classify_product_kind,
    compute_lead_ltv,
)


def test_classify_course_15_and_protocol():
    assert classify_product_kind("Курс 15") == "course_15"
    assert classify_product_kind("Протокол") == "protocol"
    assert classify_product_kind("Курс") == "main_course"
    assert classify_product_kind("Массаж") == "other_service"


def test_booking_course_protocol_excluded_from_purchase():
    assert booking_counts_as_purchase("Курс") is False
    assert booking_counts_as_purchase("Протокол") is False
    assert booking_counts_as_purchase("Курс 15") is True
    assert booking_counts_as_purchase("Массаж") is True


def test_paid_ltv_sales_value_outstanding_and_lifetime():
    purchases = [
        PatientPurchase(
            id=1,
            company_id=1,
            lead_id=10,
            source_type="booking_appointment",
            source_id=1,
            product_kind="other_service",
            product_name="Массаж",
            service_amount=Decimal("300"),
            paid_amount=Decimal("300"),
            status="completed",
            purchased_at=datetime(2026, 1, 1, tzinfo=UTC),
        ),
        PatientPurchase(
            id=2,
            company_id=1,
            lead_id=10,
            source_type="kpi_manual_sale",
            source_id=2,
            product_kind="course_15",
            product_name="Курс 15",
            service_amount=Decimal("1300"),
            paid_amount=Decimal("500"),
            status="active",
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
            amount=Decimal("300"),
            is_refund=False,
            paid_at=datetime(2026, 1, 1, tzinfo=UTC),
        ),
        PatientPurchasePayment(
            id=2,
            company_id=1,
            purchase_id=2,
            source_type="kpi_payment",
            source_id=2,
            amount=Decimal("500"),
            is_refund=False,
            paid_at=datetime(2026, 2, 1, tzinfo=UTC),
        ),
        PatientPurchasePayment(
            id=3,
            company_id=1,
            purchase_id=1,
            source_type="booking_refund",
            source_id=99,
            amount=Decimal("-100"),
            is_refund=True,
            paid_at=datetime(2026, 1, 10, tzinfo=UTC),
        ),
    ]
    snap = compute_lead_ltv(purchases, payments)
    assert snap.purchase_count == 2
    assert snap.sales_value == Decimal("1600")
    assert snap.paid_ltv == Decimal("700")  # 300+500-100
    assert snap.outstanding == Decimal("800")  # 1300-500
    assert snap.refunds_total == Decimal("100")
    assert snap.first_purchase_at is not None
    assert snap.last_purchase_at is not None
    assert snap.lifetime_days == 31


def test_returned_purchase_excluded_from_sales_value():
    purchases = [
        PatientPurchase(
            id=1,
            company_id=1,
            lead_id=1,
            source_type="kpi_manual_sale",
            source_id=1,
            product_kind="protocol",
            product_name="Протокол",
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
            amount=Decimal("1000"),
            is_refund=False,
            paid_at=datetime(2026, 3, 1, tzinfo=UTC),
        ),
        PatientPurchasePayment(
            id=2,
            company_id=1,
            purchase_id=1,
            source_type="kpi_return",
            source_id=1,
            amount=Decimal("-1000"),
            is_refund=True,
            paid_at=datetime(2026, 3, 5, tzinfo=UTC),
        ),
    ]
    snap = compute_lead_ltv(purchases, payments)
    assert snap.purchase_count == 0
    assert snap.sales_value == Decimal("0")
    assert snap.paid_ltv == Decimal("0")
    assert snap.outstanding == Decimal("0")
