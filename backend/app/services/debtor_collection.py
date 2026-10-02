"""Пометки сбора дебиторки: дата обещания и порядок утреннего обзвона."""

from __future__ import annotations

from datetime import date, datetime
from zoneinfo import ZoneInfo

from app.config import settings


def clinic_today() -> date:
    try:
        tz = ZoneInfo(settings.booking_timezone or "Asia/Dushanbe")
    except Exception:
        tz = ZoneInfo("Asia/Dushanbe")
    return datetime.now(tz).date()


def promise_is_overdue(promised_on: date | None, today: date) -> bool:
    """Красная строка — только если дата обещания уже прошла. Сегодня ещё не просрочка."""
    return promised_on is not None and promised_on < today


def promise_needs_call(promised_on: date | None, today: date) -> bool:
    """Звонить сегодня: дата обещания сегодня или раньше."""
    return promised_on is not None and promised_on <= today


def sort_debtors_for_calls(rows: list, today: date) -> list:
    """Сначала кому звонить (старые даты выше), остальные в прежнем порядке."""
    due: list[tuple[date, int, object]] = []
    rest: list = []
    for index, row in enumerate(rows):
        promised = getattr(row, "promised_on", None)
        if promise_needs_call(promised, today):
            due.append((promised, index, row))
        else:
            rest.append(row)
    due.sort(key=lambda item: (item[0], item[1]))
    return [item[2] for item in due] + rest
