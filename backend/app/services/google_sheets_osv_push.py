"""Дописывает оплаты и расходы CRM в конец Google-таблицы ОСВ.

Уже набранные строки не перезаписываются. Повтор той же операции не создаёт вторую строку:
в колонке «CRM ключ» лежит внешний ключ.
"""

from __future__ import annotations

import logging
import re
from datetime import date
from decimal import Decimal
from typing import Any
from urllib.parse import quote

import httpx
from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import FinanceCompanySettings, FinanceOsvRow
from app.services.finance_osv_parse import find_osv_header_row, normalize_header
from app.services.google_sheets_finance_sync import _resolve_sheet_name
from app.services.google_sheets_sync import (
    _GOOGLE_SHEETS_API,
    _extract_sheet_id,
    _google_access_token,
    _google_service_account_ready,
    _sheet_rows,
)

logger = logging.getLogger(__name__)

_RU_MONTHS = ("янв", "фев", "мар", "апр", "май", "июн", "июл", "авг", "сен", "окт", "ноя", "дек")

_FIELD_HEADERS: dict[str, tuple[str, ...]] = {
    "txn_date": ("дата", "date"),
    "revenue": ("выручка", "выручка - som", "выручка som"),
    "expense": ("расход", "расход - som", "расход som"),
    "bank": ("банк",),
    "basis": ("основание", "основание выручка/расход"),
    "counterparty": ("контрагенты", "контрагент"),
    "phone": ("телефон",),
    "via_person": ("через", "чрз"),
    "product_service": ("товар/услуги", "товар/услуга", "товар", "услуга"),
    "article": ("статьи", "статья"),
    "detail_category": ("подробно",),
    "brief_category": ("кратко",),
    "service_period": ("этап", "период оказания услуги"),
    "external_key": ("crm ключ", "ключ crm"),
}

_PUSH_KEY_SQL = or_(
    FinanceOsvRow.external_key.like("crm:%"),
    FinanceOsvRow.external_key.like("booking_refund:%"),
)


def format_osv_date(day: date) -> str:
    return f"{day.day} {_RU_MONTHS[day.month - 1]}."


def format_osv_amount(value: Decimal | int | float | str | None) -> str:
    amount = Decimal(str(value or 0)).quantize(Decimal("0.01"))
    if amount == 0:
        return ""
    sign = "-" if amount < 0 else ""
    return sign + f"{abs(amount):.2f}".replace(".", ",")


def money_cents(value: Decimal | int | float | str) -> int:
    return int((Decimal(str(value)).quantize(Decimal("0.01")) * 100).to_integral_value())


def booking_pay_key(appointment_id: int, prev_paid: Decimal | int | float | str, new_paid: Decimal | int | float | str) -> str:
    return f"crm:booking_pay:{appointment_id}:{money_cents(prev_paid)}:{money_cents(new_paid)}"


def bank_label(method: str | None) -> str:
    raw = (method or "").strip()
    low = raw.lower()
    if low in {"cash", "касса", "наличные", "наличка"}:
        return "КАССА"
    if low in {"alif", "алиф"}:
        return "Алиф"
    if low in {"dc", "дс", "ds"}:
        return "ДС"
    return raw[:64] if raw else "ДС"


def _header_index(headers: list[str], field: str) -> int | None:
    aliases = {normalize_header(name) for name in _FIELD_HEADERS[field]}
    for i, header in enumerate(headers):
        if normalize_header(header) in aliases:
            return i
    return None


def sheet_row_values(headers: list[str], payload: dict[str, Any], external_key: str) -> list[str]:
    key_idx = _header_index(headers, "external_key")
    width = len(headers) if key_idx is not None else len(headers) + 1
    if key_idx is None:
        key_idx = len(headers)
    row = [""] * width

    def put(field: str, text: str) -> None:
        idx = _header_index(headers, field)
        if idx is None or not text:
            return
        row[idx] = text

    txn = payload.get("txn_date")
    if isinstance(txn, date):
        put("txn_date", format_osv_date(txn))
    elif txn:
        put("txn_date", str(txn))
    put("revenue", format_osv_amount(payload.get("revenue")))
    put("expense", format_osv_amount(payload.get("expense")))
    for field in (
        "bank",
        "basis",
        "counterparty",
        "phone",
        "via_person",
        "product_service",
        "article",
        "detail_category",
        "brief_category",
        "service_period",
    ):
        put(field, str(payload.get(field) or "").strip())
    row[key_idx] = external_key
    return row


def _col_letter(index: int) -> str:
    n = index + 1
    letters = ""
    while n:
        n, rem = divmod(n - 1, 26)
        letters = chr(65 + rem) + letters
    return letters


def _a1(sheet_name: str, cell_range: str) -> str:
    if re.search(r"[^A-Za-z0-9_]", sheet_name):
        escaped = sheet_name.replace("'", "''")
        return f"'{escaped}'!{cell_range}"
    return f"{sheet_name}!{cell_range}"


def _clip(value: str | None, limit: int) -> str | None:
    text = (value or "").strip()
    if not text:
        return None
    return text[:limit]


async def save_osv_movement(
    db: AsyncSession,
    *,
    company_id: int,
    external_key: str,
    source: str,
    txn_date: date,
    revenue: Decimal = Decimal("0"),
    expense: Decimal = Decimal("0"),
    bank: str | None = None,
    basis: str | None = None,
    counterparty: str | None = None,
    phone: str | None = None,
    via_person: str | None = None,
    product_service: str | None = None,
    article: str | None = None,
    detail_category: str | None = None,
    brief_category: str | None = None,
) -> None:
    """Сохраняет движение и сразу пытается дописать его в таблицу. Ошибка Google не откатывает оплату."""
    exists = (
        await db.execute(
            select(FinanceOsvRow.id).where(
                FinanceOsvRow.company_id == company_id,
                FinanceOsvRow.external_key == external_key,
            ).limit(1),
        )
    ).scalar_one_or_none()
    if exists is None:
        db.add(
            FinanceOsvRow(
                company_id=company_id,
                txn_date=txn_date,
                revenue=revenue,
                expense=expense,
                bank=_clip(bank, 64),
                basis=_clip(basis, 255),
                counterparty=_clip(counterparty, 255),
                phone=_clip(phone, 64),
                via_person=_clip(via_person, 128),
                product_service=_clip(product_service, 255),
                article=_clip(article, 128),
                detail_category=_clip(detail_category, 128),
                brief_category=_clip(brief_category, 64),
                source=source,
                external_key=external_key,
            ),
        )
        await db.flush()
    try:
        await push_pending_osv_rows(db, company_id, only_key=external_key)
    except Exception as exc:
        logger.warning("osv sheet push key=%s failed: %s", external_key, exc)


def payload_from_row(row: FinanceOsvRow) -> dict[str, Any]:
    return {
        "txn_date": row.txn_date,
        "revenue": row.revenue,
        "expense": row.expense,
        "bank": row.bank,
        "basis": row.basis,
        "counterparty": row.counterparty,
        "phone": row.phone,
        "via_person": row.via_person,
        "product_service": row.product_service,
        "article": row.article,
        "detail_category": row.detail_category,
        "brief_category": row.brief_category,
        "service_period": row.service_period,
    }


async def push_pending_osv_rows(
    db: AsyncSession,
    company_id: int,
    *,
    only_key: str | None = None,
) -> int:
    """Дописывает в таблицу движения CRM, которых там ещё нет. Возвращает число новых строк."""
    if not _google_service_account_ready():
        return 0
    settings = (
        await db.execute(select(FinanceCompanySettings).where(FinanceCompanySettings.company_id == company_id))
    ).scalars().first()
    if settings is None or not (settings.osv_sheet_url or "").strip():
        return 0
    spreadsheet_id = _extract_sheet_id(settings.osv_sheet_url or "")
    if not spreadsheet_id:
        return 0

    query = select(FinanceOsvRow).where(
        FinanceOsvRow.company_id == company_id,
        _PUSH_KEY_SQL,
    )
    if only_key:
        query = query.where(FinanceOsvRow.external_key == only_key)
    rows = (await db.execute(query.order_by(FinanceOsvRow.txn_date, FinanceOsvRow.id))).scalars().all()
    pending = [row for row in rows if row.external_key]
    if not pending:
        return 0

    token = await _google_access_token()
    sheet_name = await _resolve_sheet_name(token, spreadsheet_id, settings.osv_sheet_name)
    grid = await _sheet_rows(token, spreadsheet_id, _a1(sheet_name, "A1:ZZ20000"))
    header_idx, _col_map = find_osv_header_row(grid)
    if header_idx is None:
        raise RuntimeError(f"На листе «{sheet_name}» нет строки заголовков ОСВ")
    headers = [str(cell or "") for cell in grid[header_idx]]
    key_idx = _header_index(headers, "external_key")
    if key_idx is None:
        key_idx = len(headers)
        await _write_values(
            token,
            spreadsheet_id,
            _a1(sheet_name, f"{_col_letter(key_idx)}{header_idx + 1}"),
            [["CRM ключ"]],
        )
        headers = [*headers, "CRM ключ"]

    present: set[str] = set()
    for line in grid[header_idx + 1 :]:
        if key_idx < len(line):
            marker = str(line[key_idx] or "").strip()
            if marker:
                present.add(marker)

    missing = [row for row in pending if str(row.external_key) not in present]
    if not missing:
        return 0

    last = header_idx
    for i, line in enumerate(grid):
        if any(str(cell or "").strip() for cell in line):
            last = i
    start = last + 2
    values = [sheet_row_values(headers, payload_from_row(row), str(row.external_key)) for row in missing]
    await _write_values(
        token,
        spreadsheet_id,
        _a1(sheet_name, f"A{start}"),
        values,
    )
    return len(values)


async def _write_values(token: str, spreadsheet_id: str, rng: str, values: list[list[str]]) -> None:
    url = (
        f"{_GOOGLE_SHEETS_API}/{quote(spreadsheet_id)}/values/{quote(rng, safe='')}"
        "?valueInputOption=USER_ENTERED"
    )
    async with httpx.AsyncClient(timeout=30.0) as client:
        response = await client.put(
            url,
            headers={"Authorization": f"Bearer {token}"},
            json={"range": rng, "majorDimension": "ROWS", "values": values},
        )
    if response.status_code == 403:
        raise RuntimeError(
            "Нет права записи в Google-таблицу. Откройте её сервисному аккаунту как редактору.",
        )
    response.raise_for_status()
