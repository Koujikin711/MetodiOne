"""Один специалист: до 4 активных записей в один час клиники."""

from datetime import datetime
from zoneinfo import ZoneInfo

from app.routers.booking import MAX_BOOKINGS_PER_SPECIALIST_HOUR, _hour_bounds_utc_for_booking_tz


def test_same_clock_hour_is_one_bucket():
    tz = ZoneInfo("Asia/Dushanbe")
    quarter = datetime(2026, 10, 21, 10, 15, tzinfo=tz)
    later = datetime(2026, 10, 21, 10, 45, tzinfo=tz)
    next_hour = datetime(2026, 10, 21, 11, 0, tzinfo=tz)
    assert _hour_bounds_utc_for_booking_tz(quarter) == _hour_bounds_utc_for_booking_tz(later)
    assert _hour_bounds_utc_for_booking_tz(quarter) != _hour_bounds_utc_for_booking_tz(next_hour)
    assert MAX_BOOKINGS_PER_SPECIALIST_HOUR == 4
