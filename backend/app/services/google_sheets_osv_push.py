"""Дописывает оплаты и расходы CRM в конец Google-таблицы ОСВ.

Уже набранные строки не перезаписываются. Повтор той же операции не создаёт вторую строку:
в колонке «CRM ключ» лежит внешний ключ.
"""

from __future__ import annotations

import logging
import re
from datetime import UTC, date, datetime
from decimal import Decimal
from typing import Any
from urllib.parse import quote
from zoneinfo import ZoneInfo

import httpx
from sqlalchemy import delete, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import aliased

from app.config import settings as app_settings
from app.models import (
    BookingAppointment,
    BookingDirection,
    FinanceCompanySettings,
    FinanceOsvRow,
    SalesKpiManualSale,
    SalesKpiManualSalePayment,
    SalesKpiPlanItem,
    User,
)
from app.services.finance_osv_parse import find_osv_header_row, normalize_header, parse_date
from app.services.google_sheets_finance_sync import _resolve_sheet_name
from app.services.google_sheets_sync import (
    _GOOGLE_SHEETS_API,
    _extract_sheet_id,
    _google_access_token,
    _google_service_account_ready,
    _sheet_rows,
)

logger = logging.getLogger(__name__)

_RU_MONTHS = ("янв", "фев", "мар", "апр", "май", "июн", "июл", "авг", "сент", "окт", "ноя", "дек")

# Расходы на листе руками набраны по 5 октября 2026. Выручки за октябрь в листе нет:
# её дописываем с 1 октября. Более ранние месяцы уже лежат в таблице.
HAND_TYPED_THROUGH = date(2026, 10, 5)
SHEET_REVENUE_FROM = date(2026, 10, 1)

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
    "partner_amount": ("детализация", "детализац", "договор", "маблаги партном"),
    "external_key": ("crm ключ", "ключ crm"),
}

# В лист пишем только новые кассовые строки. Сводку «вся оплата визита одной строкой»
# (crm:appt / crm:deal) не пишем: эти деньги в таблице уже набраны руками.
_PUSH_KEY_SQL = or_(
    FinanceOsvRow.external_key.like("crm:booking_pay:%"),
    FinanceOsvRow.external_key.like("crm:kpi_pay:%"),
    FinanceOsvRow.external_key.like("crm:expense:%"),
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


def _booking_id_from_key(key: str) -> int | None:
    parts = key.split(":")
    if len(parts) < 3 or parts[0] != "crm" or parts[1] != "booking_pay":
        return None
    try:
        return int(parts[2])
    except ValueError:
        return None


def _as_date(txn_date: date | datetime | None) -> date | None:
    if isinstance(txn_date, datetime):
        return txn_date.date()
    if isinstance(txn_date, date):
        return txn_date
    return None


def clinic_day(moment: datetime | None, tz: ZoneInfo) -> date | None:
    if moment is None:
        return None
    if moment.tzinfo is None:
        moment = moment.replace(tzinfo=UTC)
    return moment.astimezone(tz).date()


def is_sheet_sync_day(day: date | None) -> bool:
    """В лист попадает операция, сохранённая с 1 октября 2026 и в любой день после."""
    return day is not None and day >= SHEET_REVENUE_FROM


def cash_receipt_day(*, created_at: datetime | None, tz: ZoneInfo) -> date | None:
    """День, когда операцию сохранили в программе. День визита сюда не входит."""
    return clinic_day(created_at, tz)


def should_append_to_sheet(
    txn_date: date | datetime | None,
    *,
    revenue: Decimal | int | float | str = 0,
    expense: Decimal | int | float | str = 0,
) -> bool:
    """Выручка с 1 октября и дальше дописывается. Расход по 5 октября уже набран руками."""
    day = _as_date(txn_date)
    if day is None:
        return False
    rev = Decimal(str(revenue or 0))
    exp = Decimal(str(expense or 0))
    if exp > 0 and rev == 0:
        return day > HAND_TYPED_THROUGH
    return day >= SHEET_REVENUE_FROM


# Цвета строк листа: дата оранжевая, договор и этап жёлтые, выручка голубая,
# расход и остальные поля зелёные, остаток персиковый. «Основание» без заливки.
_ROW_FILL_HEX: dict[int, str] = {
    0: "F1C232",
    1: "FFF2CC",
    2: "FFF2CC",
    3: "D0E0E3",
    4: "CCFFCC",
    5: "CCFFCC",
    7: "CCFFCC",
    8: "CCFFCC",
    9: "CCFFCC",
    10: "CCFFCC",
    11: "CCFFCC",
    12: "CCFFCC",
    13: "CCFFCC",
    14: "F7CAAC",
}


def hex_to_sheet_color(value: str) -> dict[str, float]:
    raw = value.removeprefix("#")
    if len(raw) == 8:
        raw = raw[2:]
    red = int(raw[0:2], 16) / 255
    green = int(raw[2:4], 16) / 255
    blue = int(raw[4:6], 16) / 255
    return {"red": red, "green": green, "blue": blue}


def crm_row_spans(grid: list[list[Any]]) -> list[tuple[int, int]]:
    """Сплошные диапазоны строк, которые дописала программа. Конец не входит в диапазон."""
    indexes = [
        index
        for index, line in enumerate(grid)
        if any(str(cell or "").strip().startswith(("crm:", "booking_refund:")) for cell in line)
    ]
    if not indexes:
        return []
    spans: list[tuple[int, int]] = []
    start = previous = indexes[0]
    for index in indexes[1:]:
        if index == previous + 1:
            previous = index
            continue
        spans.append((start, previous + 1))
        start = previous = index
    spans.append((start, previous + 1))
    return spans


def october_sort_bounds(grid: list[list[Any]], header_idx: int, date_idx: int) -> tuple[int, int] | None:
    """Срез с первой октябрьской строки до последней заполненной. Более ранние месяцы не входят."""
    start: int | None = None
    last = header_idx
    for index, line in enumerate(grid):
        if index <= header_idx:
            continue
        if any(str(cell or "").strip() for cell in line):
            last = index
        raw = line[date_idx] if date_idx < len(line) else ""
        parsed = parse_date(raw)
        if start is None and parsed is not None and parsed >= SHEET_REVENUE_FROM:
            start = index
    if start is None or last < start:
        return None
    return start, last + 1


def chronological_sort_keys(
    grid: list[list[Any]],
    start: int,
    end: int,
    date_idx: int,
) -> list[int] | None:
    """Ключи порядка для строк [start, end). None, если даты уже идут по календарю."""
    last_ord = 0
    keys: list[int] = []
    dated: list[date] = []
    for index in range(start, end):
        line = grid[index] if index < len(grid) else []
        raw = line[date_idx] if date_idx < len(line) else ""
        parsed = parse_date(raw)
        if parsed is not None:
            last_ord = parsed.toordinal()
            dated.append(parsed)
        keys.append(last_ord * 1_000_000 + index)
    if len(dated) < 2 or dated == sorted(dated):
        return None
    return keys


def rows_appended_in_hand_period(grid: list[list[Any]]) -> list[int]:
    """Номера строк листа, которые программа дописала за дни, уже набранные руками."""
    header_idx, _col_map = find_osv_header_row(grid)
    if header_idx is None:
        return []
    headers = [str(cell or "") for cell in grid[header_idx]]
    key_idx = _header_index(headers, "external_key")
    date_idx = _header_index(headers, "txn_date")
    if key_idx is None:
        return []
    found: list[int] = []
    for offset, line in enumerate(grid[header_idx + 1 :], start=header_idx + 1):
        marker = str(line[key_idx] or "").strip() if key_idx < len(line) else ""
        if not (marker.startswith("crm:") or marker.startswith("booking_refund:")):
            continue
        raw_date = line[date_idx] if date_idx is not None and date_idx < len(line) else ""
        parsed = parse_date(raw_date)
        if parsed is None or parsed < SHEET_REVENUE_FROM:
            found.append(offset)
    return found


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


def sheet_phone(raw: str | None) -> str:
    digits = re.sub(r"\D+", "", raw or "")
    if digits.startswith("992") and len(digits) > 9:
        digits = digits[3:]
    return digits


def som_amount_indexes(headers: list[str], above: list[Any] | None) -> tuple[int | None, int | None]:
    """Левая SOM под «ВЫРУЧКА», правая SOM под «РАСХОД». Колонку «Ост факт» не трогаем."""
    som = [i for i, header in enumerate(headers) if normalize_header(header) in {"som", "сом"}]
    if not som:
        return _header_index(headers, "revenue"), _header_index(headers, "expense")
    above_row = list(above or [])

    def label_at(needles: tuple[str, ...]) -> int | None:
        for i, cell in enumerate(above_row):
            name = normalize_header(str(cell or ""))
            if any(needle in name for needle in needles):
                return i
        return None

    rev_at = label_at(("выручка",))
    exp_at = label_at(("расход",))
    bal_at = label_at(("ост факт", "остаток"))

    def pick(start: int | None, end: int | None) -> int | None:
        for idx in som:
            if start is not None and idx < start:
                continue
            if end is not None and idx >= end:
                continue
            return idx
        return None

    revenue_idx = pick(rev_at, exp_at) if rev_at is not None else som[0]
    if exp_at is not None:
        end = bal_at if bal_at is not None and bal_at > exp_at else None
        expense_idx = pick(exp_at, end)
    elif len(som) > 1:
        expense_idx = som[1]
    else:
        expense_idx = None
    return revenue_idx, expense_idx


def sheet_row_values(
    headers: list[str],
    payload: dict[str, Any],
    external_key: str,
    *,
    above: list[Any] | None = None,
) -> list[str]:
    key_idx = _header_index(headers, "external_key")
    width = len(headers) if key_idx is not None else len(headers) + 1
    if key_idx is None:
        key_idx = len(headers)
    row = [""] * max(width, key_idx + 1)

    def put_at(idx: int | None, text: str) -> None:
        if idx is None or not text:
            return
        if idx >= len(row):
            row.extend([""] * (idx + 1 - len(row)))
        row[idx] = text

    def put(field: str, text: str) -> None:
        put_at(_header_index(headers, field), text)

    txn = payload.get("txn_date")
    if isinstance(txn, date):
        put("txn_date", format_osv_date(txn))
    elif txn:
        put("txn_date", str(txn))

    revenue = Decimal(str(payload.get("revenue") or 0))
    expense = Decimal(str(payload.get("expense") or 0))
    # Возврат в программе лежит отрицательным расходом, в таблице это минус к выручке.
    if expense < 0 and revenue == 0:
        revenue = expense
        expense = Decimal("0")
    revenue_idx, expense_idx = som_amount_indexes(headers, above)
    put_at(revenue_idx, format_osv_amount(revenue))
    put_at(expense_idx, format_osv_amount(expense))
    put("partner_amount", format_osv_amount(payload.get("partner_amount")))
    put("bank", str(payload.get("bank") or "").strip())
    put("basis", str(payload.get("basis") or "").strip())
    put("counterparty", str(payload.get("counterparty") or "").strip())
    put("phone", sheet_phone(str(payload.get("phone") or "")))
    put("via_person", str(payload.get("via_person") or "").strip())
    put("product_service", str(payload.get("product_service") or "").strip())
    put("article", str(payload.get("article") or "").strip())
    put("detail_category", str(payload.get("detail_category") or "").strip())
    put("brief_category", str(payload.get("brief_category") or "").strip())
    put("service_period", str(payload.get("service_period") or "").strip())
    put_at(key_idx, external_key)
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


async def drop_bulk_crm_mirrors(db: AsyncSession, company_id: int) -> None:
    """Убирает старую выгрузку «весь визит одной строкой», чтобы она не задвоила лист и отчёты."""
    await db.execute(
        delete(FinanceOsvRow).where(
            FinanceOsvRow.company_id == company_id,
            or_(
                FinanceOsvRow.external_key.like("crm:appt:%"),
                FinanceOsvRow.external_key.like("crm:deal:%"),
            ),
        )
    )


async def save_osv_movement(
    db: AsyncSession,
    *,
    company_id: int,
    external_key: str,
    source: str,
    txn_date: date,
    revenue: Decimal = Decimal("0"),
    expense: Decimal = Decimal("0"),
    partner_amount: Decimal | None = None,
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
                partner_amount=partner_amount if partner_amount and partner_amount > 0 else None,
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
        "partner_amount": row.partner_amount,
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


async def backfill_october_revenue(db: AsyncSession, company_id: int) -> tuple[dict[str, date], set[str]]:
    """Кладёт в журнал оплаты с 1 октября и дальше. Возвращает даты для листа и ключи, которые надо убрать.

    Дата строки — день, когда операцию сохранили. Сентябрь не дописывается и уже набранные сентябрьские строки не меняются.
    """
    tz = ZoneInfo(app_settings.booking_timezone or "Asia/Dushanbe")
    start_utc = datetime(2026, 9, 1, tzinfo=tz).astimezone(UTC)
    manager = aliased(User)
    cashier = aliased(User)
    appt_rows = (
        await db.execute(
            select(BookingAppointment, BookingDirection.name, manager.full_name, cashier.full_name)
            .join(BookingDirection, BookingDirection.id == BookingAppointment.direction_id)
            .outerjoin(manager, manager.id == BookingAppointment.responsible_manager_id)
            .outerjoin(cashier, cashier.id == BookingAppointment.created_by_user_id)
            .where(
                BookingAppointment.company_id == company_id,
                BookingAppointment.paid_amount > 0,
                or_(
                    BookingAppointment.paid_at >= start_utc,
                    BookingAppointment.created_at >= start_utc,
                    BookingAppointment.start_at >= start_utc,
                ),
            )
        )
    ).all()
    kpi_rows = (
        await db.execute(
            select(
                SalesKpiManualSalePayment,
                SalesKpiManualSale,
                SalesKpiPlanItem.name,
                User.full_name,
            )
            .join(SalesKpiManualSale, SalesKpiManualSale.id == SalesKpiManualSalePayment.sale_id)
            .join(SalesKpiPlanItem, SalesKpiPlanItem.id == SalesKpiManualSale.plan_item_id)
            .outerjoin(User, User.id == SalesKpiManualSale.manager_user_id)
            .where(
                SalesKpiManualSalePayment.company_id == company_id,
                SalesKpiManualSalePayment.amount > 0,
                SalesKpiManualSalePayment.created_at >= datetime(2026, 10, 1, tzinfo=tz).astimezone(UTC),
            )
        )
    ).all()

    candidates: list[FinanceOsvRow] = []

    def remember(row: FinanceOsvRow) -> None:
        if not row.external_key:
            return
        candidates.append(row)

    loaded_ids = {int(appt.id) for appt, *_rest in appt_rows}
    for appt, direction_name, manager_name, cashier_name in appt_rows:
        day = cash_receipt_day(created_at=appt.created_at, tz=tz)
        if not is_sheet_sync_day(day):
            continue
        paid = Decimal(str(appt.paid_amount or 0)).quantize(Decimal("0.01"))
        if paid <= 0:
            continue
        price = Decimal(str(appt.service_amount or 0)).quantize(Decimal("0.01"))
        service = (appt.service_title or direction_name or "").strip() or "Онлайн-запись"
        remember(
            FinanceOsvRow(
                company_id=company_id,
                txn_date=day,
                revenue=paid,
                expense=Decimal("0"),
                partner_amount=price if price > 0 else None,
                bank=bank_label(appt.payment_method),
                basis=_clip(cashier_name, 255),
                counterparty=_clip(appt.patient_name, 255),
                phone=_clip(appt.patient_phone, 64),
                via_person=_clip(manager_name, 128),
                product_service=_clip(service, 255),
                article="Поступления",
                detail_category="Медицина",
                brief_category="Выручка",
                source="booking_payment",
                external_key=booking_pay_key(int(appt.id), 0, paid),
            )
        )

    for pay, sale, item_name, manager_name in kpi_rows:
        day = cash_receipt_day(created_at=pay.created_at, tz=tz)
        if not is_sheet_sync_day(day):
            continue
        amount = Decimal(str(pay.amount or 0)).quantize(Decimal("0.01"))
        if amount <= 0:
            continue
        price = Decimal(str(sale.service_amount or 0)).quantize(Decimal("0.01"))
        remember(
            FinanceOsvRow(
                company_id=company_id,
                txn_date=day,
                revenue=amount,
                expense=Decimal("0"),
                partner_amount=price if price > 0 else None,
                bank="ДС",
                basis=None,
                counterparty=_clip(sale.client_name, 255),
                phone=_clip(sale.client_phone, 64),
                via_person=_clip(manager_name, 128),
                product_service=_clip(str(item_name or ""), 255),
                article="Поступления",
                detail_category="Медицина",
                brief_category="Выручка",
                source="kpi_payment",
                external_key=f"crm:kpi_pay:{pay.id}",
            )
        )

    date_by_key = {str(row.external_key): row.txn_date for row in candidates if row.external_key}
    desired = set(date_by_key)
    stored_rows = (
        await db.execute(
            select(FinanceOsvRow).where(
                FinanceOsvRow.company_id == company_id,
                FinanceOsvRow.external_key.like("crm:booking_pay:%"),
            )
        )
    ).scalars().all()
    drop_keys: set[str] = set()
    redated = 0
    orphans: dict[int, list[FinanceOsvRow]] = {}
    for stored in stored_rows:
        key = str(stored.external_key or "")
        appt_id = _booking_id_from_key(key)
        if appt_id is None:
            continue
        if appt_id not in loaded_ids:
            orphans.setdefault(appt_id, []).append(stored)
            continue
        if key in desired:
            if stored.txn_date != date_by_key[key]:
                stored.txn_date = date_by_key[key]
                redated += 1
            continue
        drop_keys.add(key)
        await db.delete(stored)
    if orphans:
        extra = (
            await db.execute(
                select(BookingAppointment.id, BookingAppointment.created_at).where(
                    BookingAppointment.id.in_(list(orphans)),
                )
            )
        ).all()
        created_by_id = {int(appt_id): created_at for appt_id, created_at in extra}
        for appt_id, rows in orphans.items():
            day = cash_receipt_day(created_at=created_by_id.get(appt_id), tz=tz)
            if is_sheet_sync_day(day):
                for stored in rows:
                    marker = str(stored.external_key or "")
                    date_by_key[marker] = day
                    if stored.txn_date != day:
                        stored.txn_date = day
                        redated += 1
                continue
            for stored in rows:
                drop_keys.add(str(stored.external_key or ""))
                await db.delete(stored)
    stored_kpi = (
        await db.execute(
            select(FinanceOsvRow).where(
                FinanceOsvRow.company_id == company_id,
                FinanceOsvRow.external_key.like("crm:kpi_pay:%"),
            )
        )
    ).scalars().all()
    for stored in stored_kpi:
        key = str(stored.external_key or "")
        if key in desired:
            if stored.txn_date != date_by_key[key]:
                stored.txn_date = date_by_key[key]
                redated += 1
            continue
        drop_keys.add(key)
        await db.delete(stored)
    existing = {str(row.external_key) for row in stored_rows}
    existing.update(str(row.external_key) for row in stored_kpi)
    added = 0
    for row in candidates:
        if row.external_key in existing or row.external_key in drop_keys:
            continue
        existing.add(str(row.external_key))
        db.add(row)
        added += 1
    if added or drop_keys or redated:
        await db.flush()
        logger.info(
            "osv october revenue backfill company=%s added=%s redated=%s removed=%s",
            company_id,
            added,
            len(date_by_key),
            len(drop_keys),
        )
    return date_by_key, drop_keys


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
    date_by_key: dict[str, date] = {}
    drop_keys: set[str] = set()
    if only_key:
        query = query.where(FinanceOsvRow.external_key == only_key)
    elif spreadsheet_id:
        date_by_key, drop_keys = await backfill_october_revenue(db, company_id)
    rows = (await db.execute(query.order_by(FinanceOsvRow.txn_date, FinanceOsvRow.id))).scalars().all()
    pending = [
        row
        for row in rows
        if row.external_key and should_append_to_sheet(row.txn_date, revenue=row.revenue, expense=row.expense)
    ]
    if only_key is not None and not pending:
        return 0

    token = await _google_access_token()
    sheet_name = await _resolve_sheet_name(token, spreadsheet_id, settings.osv_sheet_name)
    sheet_gid: int | None = None
    if only_key is None:
        sheet_gid, grid = await _aligned_sheet_rows(token, spreadsheet_id, sheet_name)
        drop_idxs = rows_appended_in_hand_period(grid)
        if drop_idxs:
            await _delete_row_indexes(token, spreadsheet_id, sheet_gid, drop_idxs)
            logger.info(
                "osv sheet removed hand-period rows company=%s n=%s",
                company_id,
                len(drop_idxs),
            )
            dropped = set(drop_idxs)
            grid = [line for index, line in enumerate(grid) if index not in dropped]
        if await _apply_recorded_dates(
            token,
            spreadsheet_id,
            sheet_gid,
            sheet_name,
            grid,
            date_by_key,
            drop_keys,
        ):
            sheet_gid, grid = await _aligned_sheet_rows(token, spreadsheet_id, sheet_name)
    else:
        grid = await _sheet_rows(token, spreadsheet_id, _a1(sheet_name, "A1:ZZ20000"))
    if not pending:
        if sheet_gid is not None:
            await _sort_sheet_from_october(token, spreadsheet_id, sheet_name, grid)
            await _paint_row_spans(token, spreadsheet_id, sheet_gid, crm_row_spans(grid))
        return 0
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
        if sheet_gid is not None:
            await _sort_sheet_from_october(token, spreadsheet_id, sheet_name, grid)
            await _paint_row_spans(token, spreadsheet_id, sheet_gid, crm_row_spans(grid))
        return 0

    last = header_idx
    for i, line in enumerate(grid):
        if any(str(cell or "").strip() for cell in line):
            last = i
    start = last + 2
    above = list(grid[header_idx - 1]) if header_idx > 0 else None
    values = [
        sheet_row_values(headers, payload_from_row(row), str(row.external_key), above=above)
        for row in missing
    ]
    await _write_values(
        token,
        spreadsheet_id,
        _a1(sheet_name, f"A{start}"),
        values,
    )
    if sheet_gid is None:
        sheet_gid = await _sheet_gid(token, spreadsheet_id, sheet_name)
    written = (start - 1, start - 1 + len(values))
    if only_key is None:
        insert_at = start - 1
        while len(grid) < insert_at:
            grid.append([])
        for offset, row in enumerate(values):
            idx = insert_at + offset
            if idx < len(grid):
                grid[idx] = row
            else:
                grid.append(row)
        await _sort_sheet_from_october(token, spreadsheet_id, sheet_name, grid)
    await _paint_row_spans(token, spreadsheet_id, sheet_gid, [*crm_row_spans(grid), written])
    return len(values)


def ordered_october_rows(
    grid: list[list[Any]],
    start: int,
    end: int,
    date_idx: int,
    width: int,
) -> list[list[str]] | None:
    """Строки среза в календарном порядке. None, если даты уже идут подряд."""
    keys = chronological_sort_keys(grid, start, end, date_idx)
    if keys is None:
        return None
    indexes = sorted(range(start, end), key=lambda index: keys[index - start])
    ordered: list[list[str]] = []
    for index in indexes:
        line = [str(cell or "") for cell in (grid[index] if index < len(grid) else [])]
        if len(line) < width:
            line.extend([""] * (width - len(line)))
        ordered.append(line[:width])
    return ordered


async def _sort_sheet_from_october(
    token: str,
    spreadsheet_id: str,
    sheet_name: str,
    grid: list[list[Any]],
) -> None:
    """Ставит октябрь и следующие дни по календарю. Январь–сентябрь не двигает."""
    header_idx, _col_map = find_osv_header_row(grid)
    if header_idx is None:
        return
    headers = [str(cell or "") for cell in grid[header_idx]]
    date_idx = _header_index(headers, "txn_date")
    if date_idx is None:
        return
    bounds = october_sort_bounds(grid, header_idx, date_idx)
    if bounds is None:
        return
    start, end = bounds
    key_idx = _header_index(headers, "external_key")
    width = max(19, (key_idx + 1) if key_idx is not None else 19)
    width = min(width, 26)
    ordered = ordered_october_rows(grid, start, end, date_idx, width)
    if ordered is None:
        return
    await _write_values(
        token,
        spreadsheet_id,
        _a1(sheet_name, f"A{start + 1}:{_col_letter(width - 1)}{end}"),
        ordered,
    )
    grid[start:end] = ordered


async def _apply_recorded_dates(
    token: str,
    spreadsheet_id: str,
    sheet_gid: int,
    sheet_name: str,
    grid: list[list[Any]],
    date_by_key: dict[str, date],
    drop_keys: set[str],
) -> bool:
    """Ставит в листе день сохранения операции и убирает строки не из октября."""
    if not date_by_key and not drop_keys:
        return False
    header_idx, _col_map = find_osv_header_row(grid)
    if header_idx is None:
        return False
    headers = [str(cell or "") for cell in grid[header_idx]]
    date_idx = _header_index(headers, "txn_date")
    key_idx = _header_index(headers, "external_key")
    if date_idx is None or key_idx is None:
        return False
    updates: list[tuple[int, str]] = []
    delete_idxs: list[int] = []
    for index, line in enumerate(grid):
        marker = str(line[key_idx] or "").strip() if key_idx < len(line) else ""
        if not marker:
            continue
        if marker in drop_keys:
            delete_idxs.append(index)
            continue
        day = date_by_key.get(marker)
        if day is None:
            continue
        text = format_osv_date(day)
        current = str(line[date_idx] or "").strip() if date_idx < len(line) else ""
        if current != text:
            updates.append((index, text))
    if updates:
        await _write_dates(token, spreadsheet_id, sheet_name, date_idx, updates)
    if delete_idxs:
        await _delete_row_indexes(token, spreadsheet_id, sheet_gid, delete_idxs)
    return bool(updates or delete_idxs)


async def _write_dates(
    token: str,
    spreadsheet_id: str,
    sheet_name: str,
    date_idx: int,
    updates: list[tuple[int, str]],
) -> None:
    column = _col_letter(date_idx)
    data = [
        {"range": _a1(sheet_name, f"{column}{index + 1}"), "values": [[text]]}
        for index, text in updates
    ]
    url = f"{_GOOGLE_SHEETS_API}/{quote(spreadsheet_id)}/values:batchUpdate"
    async with httpx.AsyncClient(timeout=60.0) as client:
        response = await client.post(
            url,
            headers={"Authorization": f"Bearer {token}"},
            json={"valueInputOption": "USER_ENTERED", "data": data},
        )
    if response.status_code == 403:
        raise RuntimeError(
            "Нет права записи в Google-таблицу. Откройте её сервисному аккаунту как редактору.",
        )
    response.raise_for_status()


async def _sheet_gid(token: str, spreadsheet_id: str, title: str) -> int:
    url = f"{_GOOGLE_SHEETS_API}/{quote(spreadsheet_id)}/?fields=sheets(properties(sheetId,title))"
    async with httpx.AsyncClient(timeout=20.0) as client:
        response = await client.get(url, headers={"Authorization": f"Bearer {token}"})
    response.raise_for_status()
    payload = response.json() if isinstance(response.json(), dict) else {}
    for sheet in payload.get("sheets") or []:
        props = sheet.get("properties") if isinstance(sheet, dict) else None
        if isinstance(props, dict) and str(props.get("title") or "").strip() == title:
            return int(props["sheetId"])
    raise RuntimeError(f"Лист «{title}» не найден")


async def _paint_row_spans(
    token: str,
    spreadsheet_id: str,
    sheet_gid: int,
    spans: list[tuple[int, int]],
) -> None:
    requests = []
    for start, end in spans:
        if end <= start:
            continue
        for column, hex_color in _ROW_FILL_HEX.items():
            requests.append(
                {
                    "repeatCell": {
                        "range": {
                            "sheetId": sheet_gid,
                            "startRowIndex": start,
                            "endRowIndex": end,
                            "startColumnIndex": column,
                            "endColumnIndex": column + 1,
                        },
                        "cell": {"userEnteredFormat": {"backgroundColor": hex_to_sheet_color(hex_color)}},
                        "fields": "userEnteredFormat.backgroundColor",
                    }
                }
            )
    if not requests:
        return
    url = f"{_GOOGLE_SHEETS_API}/{quote(spreadsheet_id)}:batchUpdate"
    async with httpx.AsyncClient(timeout=60.0) as client:
        response = await client.post(
            url,
            headers={"Authorization": f"Bearer {token}"},
            json={"requests": requests},
        )
    if response.status_code == 403:
        raise RuntimeError(
            "Нет права записи в Google-таблицу. Откройте её сервисному аккаунту как редактору.",
        )
    response.raise_for_status()


async def _aligned_sheet_rows(token: str, spreadsheet_id: str, sheet_name: str) -> tuple[int, list[list[str]]]:
    """Строки листа с настоящими номерами: пустые строки не схлопываются."""
    rng = _a1(sheet_name, "A1:AZ8000")
    url = (
        f"{_GOOGLE_SHEETS_API}/{quote(spreadsheet_id)}"
        f"?ranges={quote(rng, safe='')}"
        "&includeGridData=true"
        "&fields=sheets(properties(sheetId,title),data(startRow,rowData(values(formattedValue))))"
    )
    async with httpx.AsyncClient(timeout=120.0) as client:
        response = await client.get(url, headers={"Authorization": f"Bearer {token}"})
    response.raise_for_status()
    payload = response.json() if isinstance(response.json(), dict) else {}
    for sheet in payload.get("sheets") or []:
        props = sheet.get("properties") if isinstance(sheet, dict) else None
        if not isinstance(props, dict) or str(props.get("title") or "").strip() != sheet_name:
            continue
        data_blocks = sheet.get("data") or []
        block = data_blocks[0] if data_blocks else {}
        start = int(block.get("startRow") or 0)
        rows: list[list[str]] = [[] for _ in range(start)]
        for raw_row in block.get("rowData") or []:
            cells: list[str] = []
            if isinstance(raw_row, dict):
                for cell in raw_row.get("values") or []:
                    text = cell.get("formattedValue") if isinstance(cell, dict) else ""
                    cells.append(str(text or ""))
            rows.append(cells)
        return int(props["sheetId"]), rows
    raise RuntimeError(f"Лист «{sheet_name}» не найден")


async def _delete_row_indexes(token: str, spreadsheet_id: str, sheet_gid: int, indexes: list[int]) -> None:
    requests = [
        {
            "deleteDimension": {
                "range": {
                    "sheetId": sheet_gid,
                    "dimension": "ROWS",
                    "startIndex": idx,
                    "endIndex": idx + 1,
                }
            }
        }
        for idx in sorted(set(indexes), reverse=True)
    ]
    if not requests:
        return
    url = f"{_GOOGLE_SHEETS_API}/{quote(spreadsheet_id)}:batchUpdate"
    async with httpx.AsyncClient(timeout=30.0) as client:
        response = await client.post(
            url,
            headers={"Authorization": f"Bearer {token}"},
            json={"requests": requests},
        )
    if response.status_code == 403:
        raise RuntimeError(
            "Нет права записи в Google-таблицу. Откройте её сервисному аккаунту как редактору.",
        )
    response.raise_for_status()


async def _write_values(token: str, spreadsheet_id: str, rng: str, values: list[list[str]]) -> None:
    url = (
        f"{_GOOGLE_SHEETS_API}/{quote(spreadsheet_id)}/values/{quote(rng, safe='')}"
        "?valueInputOption=USER_ENTERED"
    )
    async with httpx.AsyncClient(timeout=60.0) as client:
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
