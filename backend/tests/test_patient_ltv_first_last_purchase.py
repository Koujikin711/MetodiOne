"""Additive first/last purchase projection — no LTV formula changes."""

from __future__ import annotations

from datetime import UTC, datetime
from decimal import Decimal

from app.models.patient_purchase import PatientPurchase
from app.services.patient_ltv_analytics import first_last_purchase_fields, purchase_event_identity


def test_purchase_event_identity_program_kinds():
    assert purchase_event_identity("course_15", "Курс 15") == ("course_15", "Курс 15")
    assert purchase_event_identity("main_course", "Здоровый ребёнок")[0] == "main_course"
    assert purchase_event_identity("protocol", "Протокол #2")[0] == "protocol"


def test_purchase_event_identity_catalog_name():
    key, name = purchase_event_identity("other_service", "Q-ЭЭГ")
    assert key == "Q-ЭЭГ"
    assert name == "Q-ЭЭГ"


def test_first_last_from_chronology():
    purchases = [
        PatientPurchase(
            id=2,
            company_id=1,
            lead_id=1,
            source_type="booking_appointment",
            source_id=2,
            product_kind="other_service",
            product_name="Массаж",
            service_amount=Decimal("150"),
            paid_amount=Decimal("150"),
            status="completed",
            purchased_at=datetime(2026, 3, 1, tzinfo=UTC),
        ),
        PatientPurchase(
            id=1,
            company_id=1,
            lead_id=1,
            source_type="booking_appointment",
            source_id=1,
            product_kind="other_service",
            product_name="Консультация",
            service_amount=Decimal("300"),
            paid_amount=Decimal("300"),
            status="completed",
            purchased_at=datetime(2026, 1, 1, tzinfo=UTC),
        ),
        PatientPurchase(
            id=3,
            company_id=1,
            lead_id=1,
            source_type="kpi_manual_sale",
            source_id=3,
            product_kind="protocol",
            product_name="Протокол #1",
            service_amount=Decimal("5000"),
            paid_amount=Decimal("1000"),
            status="active",
            purchased_at=datetime(2026, 2, 1, tzinfo=UTC),
        ),
    ]
    fields = first_last_purchase_fields(purchases)
    assert fields["first_purchase_product_key"] == "Консультация"
    assert fields["first_purchase_product_name"] == "Консультация"
    assert fields["last_purchase_product_key"] == "Массаж"
    assert fields["last_purchase_product_name"] == "Массаж"


def test_returned_excluded_from_first_last():
    purchases = [
        PatientPurchase(
            id=1,
            company_id=1,
            lead_id=1,
            source_type="kpi_manual_sale",
            source_id=1,
            product_kind="main_course",
            product_name="Здоровый ребёнок",
            service_amount=Decimal("10000"),
            paid_amount=Decimal("0"),
            status="returned",
            purchased_at=datetime(2026, 1, 1, tzinfo=UTC),
        ),
        PatientPurchase(
            id=2,
            company_id=1,
            lead_id=1,
            source_type="booking_appointment",
            source_id=2,
            product_kind="course_15",
            product_name="Курс 15",
            service_amount=Decimal("1300"),
            paid_amount=Decimal("1300"),
            status="completed",
            purchased_at=datetime(2026, 2, 1, tzinfo=UTC),
        ),
    ]
    fields = first_last_purchase_fields(purchases)
    assert fields["first_purchase_product_key"] == "course_15"
    assert fields["last_purchase_product_key"] == "course_15"
