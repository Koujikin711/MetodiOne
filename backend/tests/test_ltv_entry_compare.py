"""Entry compare diff is scoped to the selected cohort window."""

from __future__ import annotations

from datetime import UTC, datetime
from decimal import Decimal

from app.models.patient_purchase import PatientPurchase
from app.services.ltv_entry_compare import cohort_entry_diff


def _p(**kw) -> PatientPurchase:
    base = dict(
        company_id=1,
        lead_id=1,
        source_type="booking_appointment",
        source_id=1,
        product_kind="course_15",
        product_name="Курс 15",
        service_amount=Decimal("1300"),
        paid_amount=Decimal("1300"),
        status="active",
        purchased_at=datetime(2026, 9, 10, tzinfo=UTC),
    )
    base.update(kw)
    return PatientPurchase(**base)


SEPT_FROM = datetime(2026, 9, 1, tzinfo=UTC)
SEPT_TO = datetime(2026, 10, 1, tzinfo=UTC)


def test_september_window_ignores_patients_outside_it():
    """August entry must not inflate the September footnote (213 vs cohort 77)."""
    august = {
        1: [
            _p(
                lead_id=1,
                source_id=1,
                paid_amount=Decimal("300"),
                service_amount=Decimal("1300"),
                purchased_at=datetime(2026, 8, 2, tzinfo=UTC),
            ),
            _p(
                lead_id=1,
                id=2,
                source_id=2,
                product_kind="other_service",
                product_name="Массаж",
                service_amount=Decimal("150"),
                paid_amount=Decimal("150"),
                purchased_at=datetime(2026, 8, 20, tzinfo=UTC),
            ),
        ],
    }
    diff = cohort_entry_diff(august, cohort_from=SEPT_FROM, cohort_to=SEPT_TO)
    assert diff == {
        "first_at_changed_patients": 0,
        "entry_only_under_current": 0,
        "entry_only_under_target": 0,
    }


def test_window_counts_only_current_partial_and_shifted_full():
    by_lead = {
        10: [
            _p(
                lead_id=10,
                source_id=10,
                paid_amount=Decimal("300"),
                service_amount=Decimal("1300"),
                purchased_at=datetime(2026, 9, 5, tzinfo=UTC),
            ),
        ],
        11: [
            _p(
                lead_id=11,
                source_id=11,
                paid_amount=Decimal("0"),
                service_amount=Decimal("0"),
                purchased_at=datetime(2026, 8, 1, tzinfo=UTC),
            ),
            _p(
                lead_id=11,
                id=12,
                source_id=12,
                purchased_at=datetime(2026, 9, 12, tzinfo=UTC),
            ),
        ],
        12: [
            _p(
                lead_id=12,
                source_id=13,
                paid_amount=Decimal("300"),
                service_amount=Decimal("1300"),
                purchased_at=datetime(2026, 9, 1, tzinfo=UTC),
            ),
            _p(
                lead_id=12,
                id=14,
                source_id=14,
                purchased_at=datetime(2026, 9, 20, tzinfo=UTC),
            ),
        ],
        13: [
            _p(
                lead_id=13,
                source_id=15,
                purchased_at=datetime(2026, 9, 8, tzinfo=UTC),
            ),
        ],
    }
    diff = cohort_entry_diff(by_lead, cohort_from=SEPT_FROM, cohort_to=SEPT_TO)
    # Нулевой августовский визит лида 11 не задаёт CURRENT-вход: оба режима видят сентябрь.
    assert diff["entry_only_under_current"] == 1
    assert diff["entry_only_under_target"] == 0
    assert diff["first_at_changed_patients"] == 2
