"""Пометки сбора дебиторки: дата обещания и порядок утреннего обзвона."""

from __future__ import annotations

import re
from datetime import date, datetime
from decimal import Decimal, InvalidOperation
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


_AUDIT_ADD = re.compile(r"add_payment=([^;]+)")
_AUDIT_PREV = re.compile(r"prev_paid=([^;]+)")
_AUDIT_NEW = re.compile(r"new_paid=([^;]+)")


def _audit_decimal(raw: str) -> Decimal | None:
    text = (raw or "").strip()
    if not text or text == "None":
        return None
    try:
        return Decimal(text)
    except (InvalidOperation, ValueError):
        return None


def receipt_amount_from_audit_details(details: str | None) -> Decimal | None:
    """Сумма одного поступления из текста аудита записи. Нет суммы — None."""
    text = details or ""
    add_m = _AUDIT_ADD.search(text)
    added = _audit_decimal(add_m.group(1) if add_m else "")
    if added is not None and added > 0:
        return added
    prev_m = _AUDIT_PREV.search(text)
    new_m = _AUDIT_NEW.search(text)
    if prev_m is None or new_m is None:
        return None
    prev = _audit_decimal(prev_m.group(1))
    new = _audit_decimal(new_m.group(1))
    if prev is None or new is None:
        return None
    delta = new - prev
    return delta if delta > 0 else None


def manual_debtor_receipts(
    payments: list,
    *,
    paid_amount: Decimal,
    sold_at: datetime | None,
) -> list[tuple[datetime, Decimal, str]]:
    """Журнал оплат курса/протокола, новые сверху. Дыру до paid_amount закрывает одна строка."""
    rows: list[tuple[datetime, Decimal, str]] = []
    covered = Decimal("0")
    has_first = False
    for payment in payments:
        amount = Decimal(str(getattr(payment, "amount", 0) or 0))
        if amount <= 0:
            continue
        paid_at = getattr(payment, "paid_at", None) or sold_at
        if paid_at is None:
            continue
        is_first = bool(getattr(payment, "is_first", False))
        has_first = has_first or is_first
        covered += amount
        rows.append((paid_at, amount, "first" if is_first else "topup"))
    gap = Decimal(str(paid_amount or 0)) - covered
    if gap > Decimal("0.009") and sold_at is not None:
        rows.append((sold_at, gap, "first" if not has_first else "topup"))
    rows.sort(key=lambda item: item[0], reverse=True)
    return rows


def booking_debtor_receipts(
    events: list[tuple[datetime, str | None]],
    *,
    paid_amount: Decimal,
    paid_at: datetime | None,
    start_at: datetime | None,
) -> list[tuple[datetime, Decimal, str]]:
    """Доплаты записи из аудита. Если журнала нет — одна строка с датой оплаты."""
    rows: list[tuple[datetime, Decimal, str]] = []
    for created_at, details in events:
        amount = receipt_amount_from_audit_details(details)
        if amount is None or created_at is None:
            continue
        rows.append((created_at, amount, "topup"))
    if rows:
        rows.sort(key=lambda item: item[0], reverse=True)
        return rows
    paid = Decimal(str(paid_amount or 0))
    when = paid_at or start_at
    if paid > 0 and when is not None:
        return [(when, paid, "receipt")]
    return []
