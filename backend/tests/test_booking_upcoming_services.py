"""Unit tests: будущая загрузка Online Booking (Phase 6)."""

from __future__ import annotations

from datetime import UTC, date, datetime, timedelta
from zoneinfo import ZoneInfo

from app.services import booking_upcoming_services as svc


TZ = ZoneInfo("Asia/Dushanbe")


def _at(day: date, hour: int = 10, minute: int = 0) -> datetime:
    return datetime(day.year, day.month, day.day, hour, minute, tzinfo=TZ).astimezone(UTC)


def _appt(
    *,
    id: int,
    direction_id: int,
    day: date,
    status: str = "booked",
    lead_id: int | None = 1,
    hour: int = 10,
) -> svc.ApptLite:
    return svc.ApptLite(
        id=id,
        direction_id=direction_id,
        lead_id=lead_id,
        start_at=_at(day, hour),
        status=status,
    )


def test_period_bounds_today_subset_of_7_and_30():
    today = date(2026, 9, 25)
    t0, t1 = svc.period_bounds_utc("today", today=today)
    m0, m1 = svc.period_bounds_utc("tomorrow", today=today)
    s0, s1 = svc.period_bounds_utc("next_7_days", today=today)
    n0, n1 = svc.period_bounds_utc("next_30_days", today=today)
    assert t0 == s0 == n0
    assert t1 == m0
    assert m1 < s1
    assert s1 < n1
    assert (s1 - s0).days == 7
    assert (n1 - n0).days == 30


def test_past_dates_excluded_from_window():
    today = date(2026, 9, 25)
    appts = [
        _appt(id=1, direction_id=1, day=today - timedelta(days=1)),
        _appt(id=2, direction_id=1, day=today),
    ]
    assert svc.period_appointment_count(appts, "today", today=today) == 1
    assert svc.period_appointment_count(appts, "next_7_days", today=today) == 1
    assert svc.period_appointment_count(appts, "next_30_days", today=today) == 1


def test_cancelled_excluded_from_future_load():
    today = date(2026, 9, 25)
    appts = [
        _appt(id=1, direction_id=1, day=today + timedelta(days=1), status="booked"),
        _appt(id=2, direction_id=1, day=today + timedelta(days=1), status="cancelled"),
    ]
    assert svc.period_appointment_count(appts, "tomorrow", today=today) == 1


def test_today_completed_and_no_show_count_in_load():
    today = date(2026, 9, 25)
    appts = [
        _appt(id=1, direction_id=1, day=today, status="completed", hour=9),
        _appt(id=2, direction_id=1, day=today, status="no_show", hour=11),
        _appt(id=3, direction_id=1, day=today, status="booked", hour=15),
        _appt(id=4, direction_id=1, day=today, status="cancelled", hour=12),
    ]
    assert svc.period_appointment_count(appts, "today", today=today) == 3
    bd = svc.today_status_breakdown(appts, today=today)
    assert bd["completed"] == 1
    assert bd["no_show"] == 1
    assert bd["booked"] == 1
    assert bd["cancelled"] == 1
    assert bd["total_load"] == 3


def test_appointments_not_equal_unique_patients():
    today = date(2026, 9, 25)
    appts = [
        _appt(id=1, direction_id=1, day=today, lead_id=10, hour=9),
        _appt(id=2, direction_id=1, day=today, lead_id=10, hour=15),
        _appt(id=3, direction_id=1, day=today, lead_id=11, hour=16),
    ]
    assert svc.period_appointment_count(appts, "today", today=today) == 3
    assert svc.period_unique_count(appts, "today", today=today) == 2


def test_unique_patients_only_by_lead_id_no_phone_merge():
    today = date(2026, 9, 25)
    appts = [
        _appt(id=1, direction_id=1, day=today, lead_id=None, hour=9),
        _appt(id=2, direction_id=1, day=today, lead_id=None, hour=10),
        _appt(id=3, direction_id=1, day=today, lead_id=5, hour=11),
    ]
    assert svc.period_appointment_count(appts, "today", today=today) == 3
    assert svc.period_unique_count(appts, "today", today=today) == 1


def test_service_a_does_not_leak_into_service_b():
    today = date(2026, 9, 25)
    appts = [
        _appt(id=1, direction_id=1, day=today + timedelta(days=1)),
        _appt(id=2, direction_id=2, day=today + timedelta(days=1)),
    ]
    by = svc.aggregate_by_direction(appts, [1, 2], today=today)
    assert by[1]["tomorrow_appointments"] == 1
    assert by[2]["tomorrow_appointments"] == 1
    assert by[1]["today_appointments"] == 0


def test_zero_displays_as_zero():
    today = date(2026, 9, 25)
    by = svc.aggregate_by_direction([], [7], today=today)
    assert by[7]["today_appointments"] == 0
    assert by[7]["next_30_days_appointments"] == 0


def test_7_and_30_include_today_and_tomorrow():
    today = date(2026, 9, 25)
    appts = [
        _appt(id=1, direction_id=1, day=today),
        _appt(id=2, direction_id=1, day=today + timedelta(days=1)),
        _appt(id=3, direction_id=1, day=today + timedelta(days=6)),
        _appt(id=4, direction_id=1, day=today + timedelta(days=7)),  # outside 7d
        _appt(id=5, direction_id=1, day=today + timedelta(days=29)),
        _appt(id=6, direction_id=1, day=today + timedelta(days=30)),  # outside 30d
    ]
    assert svc.period_appointment_count(appts, "next_7_days", today=today) == 3
    assert svc.period_appointment_count(appts, "next_30_days", today=today) == 5


def test_midnight_boundary_in_booking_tz():
    today = date(2026, 9, 25)
    # 23:30 Dushanbe today vs 00:30 tomorrow
    late = datetime(2026, 9, 25, 23, 30, tzinfo=TZ).astimezone(UTC)
    early = datetime(2026, 9, 26, 0, 30, tzinfo=TZ).astimezone(UTC)
    appts = [
        svc.ApptLite(id=1, direction_id=1, lead_id=1, start_at=late, status="booked"),
        svc.ApptLite(id=2, direction_id=1, lead_id=1, start_at=early, status="booked"),
    ]
    assert svc.period_appointment_count(appts, "today", today=today) == 1
    assert svc.period_appointment_count(appts, "tomorrow", today=today) == 1


def test_daily_breakdown_matches_period_total():
    today = date(2026, 9, 25)
    appts = [
        _appt(id=1, direction_id=1, day=today, hour=9),
        _appt(id=2, direction_id=1, day=today, hour=11),
        _appt(id=3, direction_id=1, day=today + timedelta(days=2)),
    ]
    daily = svc.daily_breakdown(appts, "next_7_days", today=today)
    assert len(daily) == 7
    assert sum(n for _, n in daily) == 3
    assert daily[0] == (today.isoformat(), 2)
