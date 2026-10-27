from datetime import UTC, date, datetime, timedelta
from decimal import Decimal

from app.services.meta_ads_sync import (
    _jsonable,
    period_key,
    resolve_preset_bounds,
    snapshot_is_fresh,
)


def test_period_key_stable():
    assert period_key("month", date(2026, 10, 1), date(2026, 10, 27)) == "month:2026-10-01:2026-10-27"


def test_resolve_preset_bounds_month_week_day():
    today = date(2026, 10, 27)  # вторник
    assert resolve_preset_bounds("day", today=today) == ("day", today, today)
    assert resolve_preset_bounds("week", today=today) == ("week", date(2026, 10, 26), today)
    assert resolve_preset_bounds("month", today=today) == ("month", date(2026, 10, 1), today)


def test_snapshot_freshness_window():
    now = datetime(2026, 10, 27, 12, 0, tzinfo=UTC)
    fresh = now - timedelta(hours=3)
    stale = now - timedelta(hours=6)
    assert snapshot_is_fresh(fresh, now=now) is True
    assert snapshot_is_fresh(stale, now=now) is False
    assert snapshot_is_fresh(None, now=now) is False


def test_jsonable_decimal():
    payload = _jsonable({"spend": Decimal("12.50"), "rows": [{"cpl": Decimal("0.40")}]})
    assert payload["spend"] == "12.50"
    assert payload["rows"][0]["cpl"] == "0.40"
