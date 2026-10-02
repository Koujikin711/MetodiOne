"""Время в сети: короткий разрыв heartbeat входит в день, длинный — нет."""

from datetime import UTC, datetime, timedelta

from app.services.presence_time import ONLINE_WINDOW, online_seconds_so_far, presence_gap_seconds


def test_gap_inside_window_is_counted():
    now = datetime(2026, 10, 2, 9, 0, tzinfo=UTC)
    prev = now - timedelta(seconds=30)
    assert presence_gap_seconds(prev, now) == 30


def test_gap_longer_than_window_is_offline():
    now = datetime(2026, 10, 2, 9, 0, tzinfo=UTC)
    prev = now - (ONLINE_WINDOW + timedelta(seconds=1))
    assert presence_gap_seconds(prev, now) == 0


def test_first_heartbeat_adds_nothing():
    now = datetime(2026, 10, 2, 9, 0, tzinfo=UTC)
    assert presence_gap_seconds(None, now) == 0


def test_open_session_adds_the_tail():
    now = datetime(2026, 10, 2, 9, 0, tzinfo=UTC)
    seen = now - timedelta(seconds=20)
    assert online_seconds_so_far(stored=90, last_seen_at=seen, now=now, is_online=True) == 110


def test_offline_does_not_add_the_tail():
    now = datetime(2026, 10, 2, 9, 0, tzinfo=UTC)
    seen = now - timedelta(minutes=30)
    assert online_seconds_so_far(stored=90, last_seen_at=seen, now=now, is_online=False) == 90
