"""Unit tests for evening archive reactivate helpers."""

from datetime import datetime
from zoneinfo import ZoneInfo

from app.services.archive_evening_reactivate import (
    EVENING_HOUR_LOCAL,
    FIRST_CONTACT_MIN_DAYS,
    LEADS_PER_MANAGER,
    _is_evening_window,
    get_latest_archive_evening_stats,
)


def test_evening_constants():
    assert LEADS_PER_MANAGER == 5
    assert FIRST_CONTACT_MIN_DAYS == 60
    assert EVENING_HOUR_LOCAL == 19


def test_evening_window_asia_dushanbe():
    tz = ZoneInfo("Asia/Dushanbe")
    assert _is_evening_window(datetime(2026, 8, 18, 19, 5, tzinfo=tz)) is True
    assert _is_evening_window(datetime(2026, 8, 18, 18, 59, tzinfo=tz)) is False
    assert _is_evening_window(datetime(2026, 8, 18, 20, 0, tzinfo=tz)) is False


def test_get_latest_stats_helper_importable():
    assert callable(get_latest_archive_evening_stats)
