"""Сборка read-only ЭМК из booking / journey / журнала. Без финансов."""

from __future__ import annotations

import re
from collections import Counter
from datetime import date, datetime
from typing import Iterable

from app.services.lead_card import VISIT_STATUS

_CHIP_ORDER = (
    ("consult", "Консультации"),
    ("eeg", "ЭЭГ / Q-ЭЭГ"),
    ("massage", "Массаж"),
    ("tms", "ТМС"),
    ("osteo", "Остеопатия"),
    ("other", "Другие"),
)

_COMPLAINT_LABELS = {
    "temperature": "Температура",
    "vomiting": "Рвота",
    "stool": "Стул",
    "sleep": "Сон",
    "nutrition": "Питание",
    "medication": "Лекарства",
    "recommendations": "Рекомендации",
    "weight": "Вес",
    "pain": "Боль",
    "rash_or_allergy": "Сыпь / аллергия",
    "other": "Другое",
}


def classify_service(direction: str | None, title: str | None) -> str:
    text = f"{direction or ''} {title or ''}".lower()
    if re.search(r"ээг|eeg|q-?ээг|qeeg", text):
        return "eeg"
    if "массаж" in text:
        return "massage"
    if re.search(r"\bтмс\b|\btms\b", text):
        return "tms"
    if "остеопат" in text:
        return "osteo"
    if any(x in text for x in ("консульт", "невролог", "эндокрин", "приём", "прием", "осмотр")):
        return "consult"
    return "other"


def visit_kind(direction: str | None, title: str | None) -> str:
    key = classify_service(direction, title)
    if key == "eeg":
        return "diag"
    if key in {"massage", "tms", "osteo"}:
        return "proc"
    text = f"{direction or ''} {title or ''}".lower()
    if "курс" in text:
        return "course"
    return "visit"


def build_service_chips(rows: Iterable[tuple[str | None, str | None, str]]) -> list[dict]:
    """rows: (direction_name, service_title, status). Считает только completed."""
    counts: Counter[str] = Counter()
    for direction, title, status in rows:
        if (status or "") != "completed":
            continue
        counts[classify_service(direction, title)] += 1
    out: list[dict] = []
    for key, label in _CHIP_ORDER:
        n = int(counts.get(key, 0))
        if n > 0 or key in {"consult", "other"}:
            out.append({"key": key, "label": label, "count": n})
    # не тащим пустые «другие», если все нули — оставим consult/other с 0 для UI
    if sum(c["count"] for c in out) == 0:
        return [{"key": k, "label": lab, "count": 0} for k, lab in _CHIP_ORDER]
    return [c for c in out if c["count"] > 0 or c["key"] == "consult"]


def age_label(born: date | None, today: date | None = None) -> str | None:
    if born is None:
        return None
    today = today or date.today()
    years = today.year - born.year - ((today.month, today.day) < (born.month, born.day))
    months = today.month - born.month - (today.day < born.day)
    if months < 0:
        months += 12
    if years < 0:
        return None
    if years == 0:
        return f"{months} мес"
    return f"{years} лет {months} мес"


def visit_status_label(code: str) -> str:
    return VISIT_STATUS.get(code, code)


def complaint_label(category: str) -> str:
    return _COMPLAINT_LABELS.get(category, category)


def derive_stages(course_15_status: str, has_completed_visit: bool, has_any_visit: bool) -> tuple[list[str], str | None]:
    stages = ["1-й приём", "Обследования", "2-й приём", "Курс 15", "Заключение"]
    if course_15_status == "completed":
        return stages, "Заключение"
    if course_15_status == "active":
        return stages, "Курс 15"
    if has_completed_visit:
        return stages, "2-й приём"
    if has_any_visit:
        return stages, "1-й приём"
    return stages, None


def format_complaint_value(
    *,
    numeric_value: float | None,
    unit: str | None,
    count_value: int | None,
    text_value: str | None,
) -> str | None:
    parts: list[str] = []
    if numeric_value is not None:
        parts.append(f"{numeric_value:g}{(' ' + unit) if unit else ''}".strip())
    if count_value is not None:
        parts.append(str(count_value))
    if text_value and text_value.strip():
        parts.append(text_value.strip())
    return " · ".join(parts) if parts else None


def iso_dt(value: datetime | None) -> datetime | None:
    return value
