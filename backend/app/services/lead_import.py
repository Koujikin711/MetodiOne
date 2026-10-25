"""Парсинг CSV для импорта лидов (в т.ч. экспорт из Битрикс24)."""

from __future__ import annotations

import csv
import io
import re
from datetime import UTC, datetime
from typing import NamedTuple

# Экспорт Битрикс24 с десятками колонок легко превышает несколько мегабайт.
# Крупные базы — десятки тысяч лидов за одну выгрузку.
_MAX_ROWS = 25_000
_MAX_FILE_BYTES = 120 * 1024 * 1024


class ParsedLeadRow(NamedTuple):
    name: str
    phone: str | None
    email: str | None
    source: str | None
    extra_phones: tuple[str, ...] = ()
    stage_name: str | None = None
    manager_email: str | None = None
    manager_name: str | None = None
    refusal_reason: str | None = None
    created_at: datetime | None = None


def _norm_header(h: str) -> str:
    h = h.strip().strip("\ufeff").strip('"').strip("'").lower()
    h = re.sub(r"\s+", "_", h)
    return h


def decode_csv_text(data: bytes) -> str:
    if len(data) > _MAX_FILE_BYTES:
        max_mb = _MAX_FILE_BYTES // (1024 * 1024)
        raise ValueError(f"Файл слишком большой (максимум {max_mb} МБ)")
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


def norm_label(value: str | None) -> str:
    return " ".join((value or "").strip().casefold().replace("ё", "е").split())


def parse_backup_created_at(raw: str | None) -> datetime | None:
    s = (raw or "").strip()
    if not s:
        return None
    s = s.replace(" UTC", "+00:00").replace("Z", "+00:00")
    for fmt in ("%Y-%m-%d %H:%M:%S%z", "%Y-%m-%d %H:%M:%S", "%Y-%m-%d"):
        try:
            dt = datetime.strptime(s, fmt)
        except ValueError:
            continue
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=UTC)
        return dt.astimezone(UTC)
    try:
        dt = datetime.fromisoformat(s)
    except ValueError:
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=UTC)
    return dt.astimezone(UTC)


def split_extra_phones(raw: str | None) -> tuple[str, ...]:
    parts = [p.strip() for p in (raw or "").split(";")]
    return tuple(p[:64] for p in parts if p)


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
    full_name = _pick(row_map, "full_name", "фио", "клиент", "пациент")
    company = _pick(row_map, "company", "компания", "company_title", "название_компании")

    name: str
    if title:
        name = title[:255]
    elif first or last:
        name = f"{first} {last}".strip()[:255]
    elif full_name:
        name = full_name[:255]
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
    stage_raw = _pick(row_map, "stage", "стадия", "status", "статус")
    manager_email = _pick(row_map, "manager_email", "email_менеджера", "почта_менеджера")
    manager_name = _pick(row_map, "manager_name", "менеджер", "ответственный")
    refusal = _pick(row_map, "refusal_reason", "причина_отказа", "отказ")

    return ParsedLeadRow(
        name=name,
        phone=phone,
        email=email_raw[:320] if email_raw else None,
        source=source_raw[:120] if source_raw else None,
        extra_phones=split_extra_phones(_pick(row_map, "extra_phones", "доп_телефоны", "дополнительные_телефоны")),
        stage_name=stage_raw[:120] if stage_raw else None,
        manager_email=manager_email[:320] if manager_email else None,
        manager_name=manager_name[:255] if manager_name else None,
        refusal_reason=refusal[:2000] if refusal else None,
        created_at=parse_backup_created_at(_pick(row_map, "created_at", "дата", "создан")),
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
