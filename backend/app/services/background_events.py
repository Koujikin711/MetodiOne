"""Кольцевой журнал последних событий фоновых задач (WhatsApp, Google Sheets) для UI «Интеграции»."""

from __future__ import annotations

from collections import deque
from datetime import UTC, datetime
from threading import Lock
from typing import Any

_MAX = 120
_events: deque[dict[str, Any]] = deque(maxlen=_MAX)
_lock = Lock()


def record_background_event(
    *,
    source: str,
    ok: bool,
    message: str,
    detail: str | None = None,
) -> None:
    row = {
        "ts": datetime.now(UTC).isoformat(),
        "source": source,
        "ok": ok,
        "message": message[:500],
        "detail": (detail or "")[:2000] or None,
    }
    with _lock:
        _events.append(row)


def list_background_events(limit: int = 50) -> list[dict[str, Any]]:
    lim = max(1, min(100, limit))
    with _lock:
        lst = list(_events)
    # новые сверху
    return list(reversed(lst[-lim:]))
