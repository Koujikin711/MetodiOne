"""Дебиторка записи: только прошедшие явки."""

from datetime import UTC, datetime

from app.services.sales_kpi_weighted import (
    BOOKING_OPEN_DEBT_STATUSES,
    booking_debt_cutoff,
    booking_status_is_creditor_prepay,
    booking_status_is_open_debt,
)


def test_cutoff_current_month_uses_now():
    end = datetime(2026, 10, 1, tzinfo=UTC)
    now = datetime(2026, 9, 17, 12, 0, tzinfo=UTC)
    assert booking_debt_cutoff(end, now=now) == now


def test_cutoff_past_month_uses_month_end():
    end = datetime(2026, 9, 1, tzinfo=UTC)
    now = datetime(2026, 9, 17, 12, 0, tzinfo=UTC)
    assert booking_debt_cutoff(end, now=now) == end


def test_no_show_is_never_open_debt():
    """Канон: неявка не долг — иначе снова попадёт в Дебиторку."""
    assert not booking_status_is_open_debt("no_show")
    assert "no_show" not in BOOKING_OPEN_DEBT_STATUSES
    assert booking_status_is_creditor_prepay("no_show")
    assert booking_status_is_open_debt("completed")
    assert not booking_status_is_open_debt("cancelled")
    assert not booking_status_is_open_debt("booked")
