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


def test_course_debt_starts_one_month_after_first_payment():
    from app.services.sales_kpi_weighted import course_debt_is_due, first_course_payment_at

    first = paid_at_from_input(date(2026, 9, 14))
    before = paid_at_from_input(date(2026, 10, 13))
    on_day = paid_at_from_input(date(2026, 10, 14))
    assert course_debt_is_due(first, before) is False
    assert course_debt_is_due(first, on_day) is True
    assert first_course_payment_at(first, []).date() == first.date()
