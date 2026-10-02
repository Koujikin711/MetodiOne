"""Сколько секунд пользователь был в сети. Считается по heartbeat, пока вкладка открыта."""

from __future__ import annotations

from datetime import datetime, timedelta

ONLINE_WINDOW = timedelta(minutes=2)


def presence_gap_seconds(
    prev: datetime | None,
    now: datetime,
    *,
    window: timedelta = ONLINE_WINDOW,
) -> int:
    """Секунды между двумя heartbeat, если разрыв не длиннее окна «в сети».

    Пауза дольше окна — человек ушёл, этот промежуток в день не входит.
    """
    if prev is None:
        return 0
    left = prev if prev.tzinfo else prev.replace(tzinfo=now.tzinfo)
    right = now if now.tzinfo else now.replace(tzinfo=left.tzinfo)
    gap = (right - left).total_seconds()
    if gap <= 0 or gap > window.total_seconds():
        return 0
    return int(gap)


def online_seconds_so_far(
    *,
    stored: int,
    last_seen_at: datetime | None,
    now: datetime,
    is_online: bool,
    window: timedelta = ONLINE_WINDOW,
) -> int:
    """Накопленное за день плюс хвост с последнего heartbeat, если человек ещё в сети."""
    base = max(0, int(stored))
    if not is_online:
        return base
    return base + presence_gap_seconds(last_seen_at, now, window=window)
