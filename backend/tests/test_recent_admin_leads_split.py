"""Срез «вчера 00:00» для разовой раздачи с админа."""

from datetime import UTC, datetime
from zoneinfo import ZoneInfo

from app.services.recent_admin_leads_split import _since_utc


def test_since_utc_is_yesterday_midnight_dushanbe():
    # 3 ноября 2026 10:00 Душанбе → since = 2 ноября 00:00 Душанбе
    now = datetime(2026, 11, 3, 5, 0, tzinfo=UTC)  # 10:00 +05
    since = _since_utc(now=now)
    local = since.astimezone(ZoneInfo("Asia/Dushanbe"))
    assert local.year == 2026
    assert local.month == 11
    assert local.day == 2
    assert local.hour == 0
    assert local.minute == 0
