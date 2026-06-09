"""Сопоставление телефонов с учётом кода страны и локального формата."""

from __future__ import annotations

import json
import re

_PHONE_DIGITS_RE = re.compile(r"\d+")


def phone_digits(value: str | None) -> str:
    if not value:
        return ""
    return "".join(_PHONE_DIGITS_RE.findall(str(value)))


def phones_equivalent(a: str, b: str) -> bool:
    """Считает эквивалентными +992901234567, 992901234567, 901234567 и т.п."""
    da = phone_digits(a)
    db = phone_digits(b)
    if not da or not db:
        return False
    if da == db:
        return True
    short, long = (da, db) if len(da) <= len(db) else (db, da)
    if len(short) >= 9 and long.endswith(short):
        return True
    if len(da) >= 9 and len(db) >= 9 and da[-9:] == db[-9:]:
        return True
    return False


def parse_allowed_phones_json(raw: str | None) -> list[str]:
    if not raw or not str(raw).strip():
        return []
    try:
        data = json.loads(raw)
    except json.JSONDecodeError:
        return [line.strip() for line in str(raw).splitlines() if line.strip()]
    if not isinstance(data, list):
        return []
    return [str(x).strip() for x in data if str(x).strip()]


def serialize_allowed_phones(phones: list[str] | None) -> str | None:
    cleaned: list[str] = []
    seen: set[str] = set()
    for item in phones or []:
        for part in re.split(r"[\n,;]+", str(item)):
            p = part.strip()
            if not p:
                continue
            key = phone_digits(p) or p
            if key in seen:
                continue
            seen.add(key)
            cleaned.append(p)
    return json.dumps(cleaned, ensure_ascii=False) if cleaned else None
