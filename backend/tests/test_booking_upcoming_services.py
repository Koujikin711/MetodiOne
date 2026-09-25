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


def test_calendar_week_is_monday_to_sunday():
    # 2026-09-25 = Friday → week Mon 21 … Sun 27
    today = date(2026, 9, 25)
    w0, w1 = svc.calendar_week_span(today)
    assert w0 == date(2026, 9, 21)
    assert w1 == date(2026, 9, 27)
    s0, s1 = svc.period_bounds_utc("next_7_days", today=today)
    assert (s1 - s0).days == 7
    from_ymd, to_ymd = svc.period_ymd_span("next_7_days", today=today)
    assert from_ymd == "2026-09-21"
    assert to_ymd == "2026-09-27"


def test_calendar_month_first_to_last():
    today = date(2026, 9, 25)
    m0, m1 = svc.calendar_month_span(today)
    assert m0 == date(2026, 9, 1)
    assert m1 == date(2026, 9, 30)
    from_ymd, to_ymd = svc.period_ymd_span("next_30_days", today=today)
    assert from_ymd == "2026-09-01"
    assert to_ymd == "2026-09-30"
    s0, s1 = svc.period_bounds_utc("next_30_days", today=today)
    assert (s1 - s0).days == 30


def test_past_monday_included_in_week_not_in_rolling_sense():
    today = date(2026, 9, 25)  # Friday
    appts = [
        _appt(id=1, direction_id=1, day=date(2026, 9, 22)),  # Tue this week
        _appt(id=2, direction_id=1, day=today),
        _appt(id=3, direction_id=1, day=date(2026, 9, 28)),  # next Mon — outside week
    ]
    assert svc.period_appointment_count(appts, "next_7_days", today=today) == 2


def test_month_excludes_next_month_and_includes_first():
    today = date(2026, 9, 25)
    appts = [
        _appt(id=1, direction_id=1, day=date(2026, 9, 1)),
        _appt(id=2, direction_id=1, day=date(2026, 9, 30)),
        _appt(id=3, direction_id=1, day=date(2026, 10, 1)),
    ]
    assert svc.period_appointment_count(appts, "next_30_days", today=today) == 2


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


def test_daily_breakdown_week_has_seven_days():
    today = date(2026, 9, 25)
    appts = [
        _appt(id=1, direction_id=1, day=date(2026, 9, 22), hour=9),
        _appt(id=2, direction_id=1, day=today, hour=11),
    ]
    daily = svc.daily_breakdown(appts, "next_7_days", today=today)
    assert len(daily) == 7
    assert sum(n for _, n in daily) == 2
    assert daily[0][0] == "2026-09-21"


def test_midnight_boundary_in_booking_tz():
    today = date(2026, 9, 25)
    late = datetime(2026, 9, 25, 23, 30, tzinfo=TZ).astimezone(UTC)
    early = datetime(2026, 9, 26, 0, 30, tzinfo=TZ).astimezone(UTC)
    appts = [
        svc.ApptLite(id=1, direction_id=1, lead_id=1, start_at=late, status="booked"),
        svc.ApptLite(id=2, direction_id=1, lead_id=1, start_at=early, status="booked"),
    ]
    assert svc.period_appointment_count(appts, "today", today=today) == 1
    assert svc.period_appointment_count(appts, "tomorrow", today=today) == 1
