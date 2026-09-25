"""Phase 8A: dual LTV Entry eligibility (CURRENT purchase / TARGET fully_paid)."""

from __future__ import annotations

from datetime import UTC, datetime
from decimal import Decimal

from app.models.patient_purchase import PatientPurchase
from app.services.ltv_entry_eligibility import (
    ENTRY_MODE_FULLY_PAID,
    ENTRY_MODE_PURCHASE,
    PRODUCTION_ENTRY_MODE,
    entry_purchase_count,
    first_entry_at,
    first_entry_purchase,
    purchase_is_fully_paid_for_entry,
)


def _p(**kw) -> PatientPurchase:
    base = dict(
        company_id=1,
        lead_id=1,
        source_type="kpi_manual_sale",
        source_id=1,
        product_kind="course_15",
        product_name="Курс 15",
        service_amount=Decimal("1300"),
        paid_amount=Decimal("0"),
        status="active",
        purchased_at=datetime(2026, 6, 1, tzinfo=UTC),
    )
    base.update(kw)
    return PatientPurchase(**base)


def test_production_mode_is_purchase():
    assert PRODUCTION_ENTRY_MODE == ENTRY_MODE_PURCHASE


def test_clear_partial_not_fully_paid_entry():
    """CASE: sa=1300 pa=300 — Purchase Event yes; TARGET Entry no."""
    p = _p(paid_amount=Decimal("300"), service_amount=Decimal("1300"))
    assert purchase_is_fully_paid_for_entry(p) is False
    assert first_entry_purchase([p], ENTRY_MODE_PURCHASE) is p
    assert first_entry_purchase([p], ENTRY_MODE_FULLY_PAID) is None


def test_clear_full_relative_to_actual_amount():
    """Individual contracted amount 1100 fully paid → TARGET Entry."""
    p = _p(service_amount=Decimal("1100"), paid_amount=Decimal("1100"))
    assert purchase_is_fully_paid_for_entry(p) is True
    assert first_entry_at([p], ENTRY_MODE_FULLY_PAID) == p.purchased_at


def test_technically_full_possible_deposit_still_passes_predicate():
    """sa=pa=300 passes money predicate — Deposit DQ (8F) must classify; no hardcode 1300."""
    p = _p(service_amount=Decimal("300"), paid_amount=Decimal("300"))
    assert purchase_is_fully_paid_for_entry(p) is True


def test_zero_service_amount_not_entry_even_if_completed():
    p = _p(
        service_amount=Decimal("0"),
        paid_amount=Decimal("0"),
        status="completed",
        source_type="booking_appointment",
    )
    assert purchase_is_fully_paid_for_entry(p) is False
    assert first_entry_purchase([p], ENTRY_MODE_FULLY_PAID) is None
    # CURRENT still counts purchase events
    assert first_entry_purchase([p], ENTRY_MODE_PURCHASE) is p


def test_first_entry_shifts_when_deposit_then_full():
    deposit = _p(
        id=1,
        source_id=1,
        paid_amount=Decimal("300"),
        service_amount=Decimal("1300"),
        purchased_at=datetime(2026, 1, 1, tzinfo=UTC),
    )
    massage = _p(
        id=2,
        source_id=2,
        product_kind="other_service",
        product_name="Массаж",
        service_amount=Decimal("150"),
        paid_amount=Decimal("150"),
        purchased_at=datetime(2026, 2, 1, tzinfo=UTC),
    )
    assert first_entry_purchase([deposit, massage], ENTRY_MODE_PURCHASE) is deposit
    assert first_entry_purchase([deposit, massage], ENTRY_MODE_FULLY_PAID) is massage
    assert first_entry_at([deposit, massage], ENTRY_MODE_PURCHASE) != first_entry_at(
        [deposit, massage], ENTRY_MODE_FULLY_PAID,
    )


def test_returned_excluded_from_fully_paid_entry():
    p = _p(
        service_amount=Decimal("1300"),
        paid_amount=Decimal("1300"),
        status="returned",
    )
    assert purchase_is_fully_paid_for_entry(p) is False


def test_entry_purchase_count_modes():
    partial = _p(id=1, source_id=1, paid_amount=Decimal("300"), service_amount=Decimal("1300"))
    full = _p(
        id=2,
        source_id=2,
        product_kind="other_service",
        product_name="ЭЭГ",
        service_amount=Decimal("400"),
        paid_amount=Decimal("400"),
        purchased_at=datetime(2026, 3, 1, tzinfo=UTC),
    )
    assert entry_purchase_count([partial, full], ENTRY_MODE_PURCHASE) == 2
    assert entry_purchase_count([partial, full], ENTRY_MODE_FULLY_PAID) == 1


def test_no_hardcoded_course15_price_in_predicate():
    """1300 is not special — 1200 fully paid is Entry; 1300/300 is not."""
    assert purchase_is_fully_paid_for_entry(
        _p(service_amount=Decimal("1200"), paid_amount=Decimal("1200")),
    )
    assert not purchase_is_fully_paid_for_entry(
        _p(service_amount=Decimal("1300"), paid_amount=Decimal("300")),
    )
