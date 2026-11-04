"""Сопоставление телефонов с учётом кода страны и локального формата."""

from __future__ import annotations

import json
import re

_PHONE_DIGITS_RE = re.compile(r"\d+")


def phone_digits(value: str | None) -> str:
    if not value:
        return ""
    return "".join(_PHONE_DIGITS_RE.findall(str(value)))


def whatsapp_e164_digits(value: str | None, *, default_cc: str = "992") -> str:
    """Цифры для WhatsApp chatId (Green API): локальный 918… → 992918…."""
    digits = phone_digits(value)
    if not digits:
        return ""
    cc = phone_digits(default_cc) or "992"
    if digits.startswith(cc) and len(digits) >= len(cc) + 9:
        return digits
    # 09xxxxxxxx → 9xxxxxxxx
    if len(digits) == 10 and digits.startswith("0"):
        digits = digits[1:]
    # Локальный мобильный TJ: 9 цифр (часто начинают с 9)
    if len(digits) == 9:
        return f"{cc}{digits}"
    return digits


def phone_search_digit_variants(value: str | None) -> list[str]:
    """Варианты цифр для поиска: TJ/РФ/США и др. (полный, локальный, 8↔7)."""
    digits = phone_digits(value)
    if len(digits) < 7:
        return []
    out: list[str] = []
    seen: set[str] = set()

    def add(d: str) -> None:
        d = phone_digits(d)
        if len(d) < 7 or d in seen:
            return
        seen.add(d)
        out.append(d)

    add(digits)
    # Россия: 8XXXXXXXXXX ↔ 7XXXXXXXXXX
    if len(digits) == 11 and digits[0] == "8":
        add("7" + digits[1:])
    if len(digits) == 11 and digits[0] == "7":
        add("8" + digits[1:])
    # США/Канада: 1 + 10 цифр — ищем и без ведущей 1
    if len(digits) == 11 and digits[0] == "1":
        add(digits[1:])
    if len(digits) == 10:
        add("1" + digits)
    # Хвосты: локальный номер без кода страны (TJ 9, RU/US 10, короткий 7–8)
    for n in (10, 9, 8, 7):
        if len(digits) > n:
            add(digits[-n:])
    return out


def phones_equivalent(a: str, b: str) -> bool:
    """Считает эквивалентными +992… / 992… / локальный, +7/+8, +1 и т.п."""
    da = phone_digits(a)
    db = phone_digits(b)
    if not da or not db:
        return False
    if da == db:
        return True
    short, long = (da, db) if len(da) <= len(db) else (db, da)
    if len(short) >= 7 and long.endswith(short):
        return True
    # Общий хвост 7–10 цифр (разные коды стран)
    for n in (10, 9, 8, 7):
        if len(da) >= n and len(db) >= n and da[-n:] == db[-n:]:
            return True
    # РФ 8↔7
    if len(da) == 11 and len(db) == 11 and {da[0], db[0]} <= {"7", "8"} and da[1:] == db[1:]:
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
