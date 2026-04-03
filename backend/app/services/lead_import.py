"""Парсинг CSV для импорта лидов (в т.ч. экспорт из Битрикс24)."""

from __future__ import annotations

import csv
import io
import re
from typing import NamedTuple

_MAX_ROWS = 2000
_MAX_FILE_BYTES = 5 * 1024 * 1024


class ParsedLeadRow(NamedTuple):
    name: str
    phone: str | None
    email: str | None
    source: str | None


def _norm_header(h: str) -> str:
    h = h.strip().strip("\ufeff").strip('"').strip("'").lower()
    h = re.sub(r"\s+", "_", h)
    return h


def decode_csv_text(data: bytes) -> str:
    if len(data) > _MAX_FILE_BYTES:
        raise ValueError("Файл слишком большой (максимум 5 МБ)")
    for enc in ("utf-8-sig", "utf-8", "cp1251"):
        try:
            return data.decode(enc)
        except UnicodeDecodeError:
            continue
    raise ValueError("Не удалось распознать кодировку (нужен UTF-8 или Windows-1251)")


def _detect_delimiter(first_line: str) -> str:
    if not first_line:
        return ","
    semi = first_line.count(";")
    comma = first_line.count(",")
    return ";" if semi > comma else ","


def _pick(d: dict[str, str], *keys: str) -> str:
    for k in keys:
        v = d.get(k)
        if v is not None and str(v).strip():
            return str(v).strip()
    return ""


def row_to_parsed_lead(row_map: dict[str, str]) -> ParsedLeadRow | None:
    """Из строки CSV (ключи — нормализованные заголовки) извлекает поля лида."""

    title = _pick(
        row_map,
        "title",
        "название",
        "lead_title",
        "тема",
        "subject",
    )
    first = _pick(row_map, "name", "имя", "first_name", "firstname")
    last = _pick(row_map, "last_name", "lastname", "фамилия")
    company = _pick(row_map, "company", "компания", "company_title", "название_компании")

    name: str
    if title:
        name = title[:255]
    elif first or last:
        name = f"{first} {last}".strip()[:255]
    elif company:
        name = company[:255]
    else:
        return None

    phone_raw = _pick(
        row_map,
        "phone",
        "телефон",
        "mobile",
        "мобильный",
        "мобильный_телефон",
        "work_phone",
        "рабочий_телефон",
        "work_phone_work",
    )
    phone: str | None = None
    if phone_raw:
        compact = re.sub(r"\s+", "", phone_raw)[:64]
        phone = compact if compact else None
        if phone and len(phone) > 64:
            phone = phone[:64]

    email_raw = _pick(
        row_map,
        "email",
        "e_mail",
        "e-mail",
        "почта",
        "mail",
    )

    source_raw = _pick(
        row_map,
        "source",
        "источник",
        "source_description",
        "utm_source",
        "origin_id",
    )

    return ParsedLeadRow(
        name=name,
        phone=phone,
        email=email_raw[:320] if email_raw else None,
        source=source_raw[:120] if source_raw else None,
    )


def parse_csv_rows(text: str) -> tuple[list[dict[str, str]], list[str]]:
    """Возвращает список строк как dict[нормализованный_заголовок -> значение] и список заголовков."""
    lines = text.splitlines()
    if not lines:
        raise ValueError("Пустой файл")
    delim = _detect_delimiter(lines[0])
    reader = csv.reader(io.StringIO(text), delimiter=delim)
    rows = list(reader)
    if not rows:
        raise ValueError("Пустой файл")
    raw_headers = rows[0]
    headers = [_norm_header(h) for h in raw_headers]
    if not any(headers):
        raise ValueError("Не найдена строка заголовков")
    out: list[dict[str, str]] = []
    for row in rows[1:]:
        if not row or all(not (c or "").strip() for c in row):
            continue
        m: dict[str, str] = {}
        for i, h in enumerate(headers):
            if not h:
                continue
            m[h] = row[i] if i < len(row) else ""
        out.append(m)
        if len(out) > _MAX_ROWS:
            raise ValueError(f"Слишком много строк (максимум {_MAX_ROWS})")
    return out, headers


def normalize_email_strict(raw: str | None) -> str | None:
    from app.schemas.email_types import _normalize_email

    if not raw or not str(raw).strip():
        return None
    try:
        return _normalize_email(str(raw).strip())
    except ValueError:
        return None
