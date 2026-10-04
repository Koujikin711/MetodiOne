"""Сборка карточки пациента из уже сохранённых касаний. Без догадок по телефону."""

from __future__ import annotations

import re
from datetime import datetime

_FROM = re.compile(r"from_manager_id=(\d+)")
_TO = re.compile(r"to_manager_id=(\d+)")

VISIT_STATUS = {
    "booked": "Запись",
    "completed": "Пришёл",
    "no_show": "Неявка",
    "cancelled": "Отмена",
}

SALE_STATUS = {
    "active": "активна",
    "returned": "возврат",
    "refused": "отказ",
    "completed": "завершена",
}


def build_manager_steps(
    created_at: datetime | None,
    current_manager_id: int | None,
    events: list[tuple[datetime, str | None]],
) -> list[tuple[datetime | None, int, str]]:
    """Первый менеджер и каждая смена из аудита. Имя подставляет вызывающий код."""
    parsed: list[tuple[datetime, int | None, int | None]] = []
    for at, details in events:
        text = details or ""
        fm = _FROM.search(text)
        tm = _TO.search(text)
        parsed.append((at, int(fm.group(1)) if fm else None, int(tm.group(1)) if tm else None))
    parsed.sort(key=lambda row: row[0])
    steps: list[tuple[datetime | None, int, str]] = []
    if not parsed:
        if current_manager_id is not None:
            steps.append((created_at, int(current_manager_id), "с первого касания"))
        return steps
    first_from = parsed[0][1]
    if first_from is not None:
        steps.append((created_at, first_from, "первый менеджер"))
    for at, _from_id, to_id in parsed:
        if to_id is not None:
            steps.append((at, to_id, "сменился"))
    return steps
