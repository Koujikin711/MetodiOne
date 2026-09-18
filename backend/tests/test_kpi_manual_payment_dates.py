"""Даты платежей курсов KPI → месяц выручки."""

from datetime import date, datetime, timezone

from app.services.sales_kpi_weighted import paid_at_from_input


def test_paid_at_date_uses_dushanbe_noon():
    dt = paid_at_from_input(date(2026, 8, 13))
    assert dt.tzinfo is not None
    # 12:00 Asia/Dushanbe (+05) → 07:00 UTC
    assert dt.astimezone(timezone.utc).hour == 7
    assert dt.astimezone(timezone.utc).month == 8


def test_paid_at_none_falls_back():
    fb = datetime(2026, 9, 13, 10, 0, tzinfo=timezone.utc)
    assert paid_at_from_input(None, fallback=fb) == fb


def test_second_month_differs_from_first():
    aug = paid_at_from_input(date(2026, 8, 13))
    sep = paid_at_from_input(date(2026, 9, 13))
    assert aug.astimezone(timezone.utc).month == 8
    assert sep.astimezone(timezone.utc).month == 9
