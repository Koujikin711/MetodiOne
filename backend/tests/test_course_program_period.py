"""Phase 8E: Course 90-day program period (no Booking-as-end)."""

from __future__ import annotations

from datetime import UTC, date, datetime, timedelta
from decimal import Decimal

from app.models.patient_purchase import PatientPurchase
from app.services.course_program_period import (
    COURSE_DURATION_DAYS,
    classify_course_program_period,
    resolve_course_program_start,
)


def _p(
    *,
    id: int,
    kind: str = "main_course",
    name: str = "Курс",
    source_id: int | None = None,
    source_type: str = "kpi_manual_sale",
    status: str = "active",
    at: datetime,
) -> PatientPurchase:
    return PatientPurchase(
        id=id,
        company_id=1,
        lead_id=10,
        source_type=source_type,
        source_id=source_id if source_id is not None else id,
        product_kind=kind,
        product_name=name,
        service_amount=Decimal("17000"),
        paid_amount=Decimal("17000"),
        status=status,
        purchased_at=at,
    )


def test_duration_is_90_days():
    assert COURSE_DURATION_DAYS == 90


def test_canonical_start_prefers_kpi_sale_match():
    joined = date(2026, 6, 10)
    purchase_at = datetime(2026, 6, 1, tzinfo=UTC)
    other_at = datetime(2026, 5, 1, tzinfo=UTC)
    started, source, pid = resolve_course_program_start(
        joined_on=joined,
        kpi_sale_id=55,
        purchases=[
            _p(id=1, source_id=99, at=other_at),
            _p(id=2, source_id=55, at=purchase_at),
        ],
    )
    assert started == date(2026, 6, 1)
    assert source == "purchase"
    assert pid == 2


def test_canonical_start_closest_purchase_when_no_kpi():
    joined = date(2026, 6, 10)
    started, source, pid = resolve_course_program_start(
        joined_on=joined,
        kpi_sale_id=None,
        purchases=[
            _p(id=1, at=datetime(2026, 1, 1, tzinfo=UTC)),
            _p(id=2, at=datetime(2026, 6, 8, tzinfo=UTC)),
        ],
    )
    assert started == date(2026, 6, 8)
    assert source == "purchase"
    assert pid == 2


def test_canonical_start_falls_back_to_joined_on():
    started, source, pid = resolve_course_program_start(
        joined_on=date(2026, 7, 1),
        kpi_sale_id=None,
        purchases=[_p(id=1, kind="protocol", name="Протокол", at=datetime(2026, 7, 1, tzinfo=UTC))],
    )
    assert started == date(2026, 7, 1)
    assert source == "membership_joined"
    assert pid is None


def test_ignores_cancelled_and_returned_purchases():
    started, source, _ = resolve_course_program_start(
        joined_on=date(2026, 6, 1),
        kpi_sale_id=None,
        purchases=[
            _p(id=1, status="cancelled", at=datetime(2026, 6, 1, tzinfo=UTC)),
            _p(id=2, status="returned", at=datetime(2026, 6, 2, tzinfo=UTC)),
        ],
    )
    assert source == "membership_joined"
    assert started == date(2026, 6, 1)


def test_active_mid_term():
    start = date(2026, 6, 1)
    now = start + timedelta(days=30)
    info = classify_course_program_period(
        joined_on=start,
        purchases=[_p(id=1, at=datetime(2026, 6, 1, tzinfo=UTC))],
        now=now,
        ending_soon_days=14,
    )
    assert info["program_status"] == "active"
    assert info["program_days_remaining"] == 60
    assert info["program_expected_end_on"] == date(2026, 8, 30)
    assert info["program_day_index"] == 31


def test_ending_soon_configurable():
    start = date(2026, 6, 1)
    now = start + timedelta(days=80)  # 10 days left of 90
    info = classify_course_program_period(
        joined_on=start,
        purchases=[_p(id=1, at=datetime(2026, 6, 1, tzinfo=UTC))],
        now=now,
        ending_soon_days=14,
    )
    assert info["program_status"] == "ending_soon"
    assert info["program_days_remaining"] == 10


def test_ended_still_derived_without_booking():
    """Absence of Booking must NOT be required to mark program ended — only +90d."""
    start = date(2026, 1, 1)
    now = start + timedelta(days=100)
    info = classify_course_program_period(
        joined_on=start,
        purchases=[],  # no purchases, no bookings — still ended by calendar
        now=now,
        ending_soon_days=14,
    )
    assert info["program_start_source"] == "membership_joined"
    assert info["program_status"] == "ended"
    assert info["program_days_remaining"] < 0
