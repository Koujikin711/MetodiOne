"""Unit tests for archive daytime reactivate helpers."""

from datetime import datetime
from zoneinfo import ZoneInfo

from app.services.archive_evening_reactivate import (
    FIRST_CONTACT_MIN_DAYS,
    LEADS_PER_MANAGER,
    REACTIVATE_HOUR_END,
    REACTIVATE_HOUR_START,
    _is_reactivate_window,
    get_latest_archive_evening_stats,
)


def test_reactivate_constants():
    assert LEADS_PER_MANAGER == 5
    assert FIRST_CONTACT_MIN_DAYS == 60
    assert REACTIVATE_HOUR_START == 10
    assert REACTIVATE_HOUR_END == 14


def test_reactivate_window_asia_dushanbe():
    tz = ZoneInfo("Asia/Dushanbe")
    assert _is_reactivate_window(datetime(2026, 8, 18, 10, 5, tzinfo=tz)) is True
    assert _is_reactivate_window(datetime(2026, 8, 18, 13, 30, tzinfo=tz)) is True
    assert _is_reactivate_window(datetime(2026, 8, 18, 14, 59, tzinfo=tz)) is True
    assert _is_reactivate_window(datetime(2026, 8, 18, 9, 59, tzinfo=tz)) is False
    assert _is_reactivate_window(datetime(2026, 8, 18, 15, 0, tzinfo=tz)) is False


def test_get_latest_stats_helper_importable():
    assert callable(get_latest_archive_evening_stats)


def test_reclassify_lead_by_activity_importable():
    from app.services.lead_sales_stages import reclassify_lead_by_activity

    assert callable(reclassify_lead_by_activity)
