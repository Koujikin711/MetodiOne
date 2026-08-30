"""Keep chat_threads.last_message_direction in sync with latest message."""

from __future__ import annotations

from datetime import UTC, datetime

from app.models import ChatThread


def touch_thread_on_message(thread: ChatThread, direction: str) -> None:
    """Update denormalized reply-bucket fields when a message is written."""
    d = (direction or "").strip().lower()
    if d in ("in", "out"):
        thread.last_message_direction = d
    thread.updated_at = datetime.now(UTC)
