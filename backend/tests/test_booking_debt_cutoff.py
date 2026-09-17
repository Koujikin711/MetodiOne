"""Дебиторка записи: только прошедшие явки."""

from datetime import UTC, datetime

from app.services.sales_kpi_weighted import booking_debt_cutoff


def test_cutoff_current_month_uses_now():
    end = datetime(2026, 10, 1, tzinfo=UTC)
    now = datetime(2026, 9, 17, 12, 0, tzinfo=UTC)
    assert booking_debt_cutoff(end, now=now) == now


def test_cutoff_past_month_uses_month_end():
    end = datetime(2026, 9, 1, tzinfo=UTC)
    now = datetime(2026, 9, 17, 12, 0, tzinfo=UTC)
    assert booking_debt_cutoff(end, now=now) == end
