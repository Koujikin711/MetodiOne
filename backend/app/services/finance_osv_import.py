"""Парсинг CSV ОСВ и кассового CSV для загрузки в финансы."""

from __future__ import annotations

import csv
import io
import re
from dataclasses import dataclass
from datetime import date, datetime
from decimal import Decimal, InvalidOperation


_PERIOD_RE = re.compile(
    r"^\s*#\s*PERIOD\s*=\s*(\d{4}-\d{2}-\d{2})\s*\.\.\s*(\d{4}-\d{2}-\d{2})\s*$",
    re.IGNORECASE,
)


def _parse_date(s: str) -> date | None:
    s = s.strip()
    try:
        return datetime.strptime(s, "%Y-%m-%d").date()
    except ValueError:
        return None


def _parse_decimal(cell: str) -> Decimal:
    t = (cell or "").strip().replace(" ", "").replace("\u00a0", "")
    if not t:
        return Decimal("0")
    t = t.replace(",", ".")
    try:
        return Decimal(t).quantize(Decimal("0.01"))
    except InvalidOperation as e:
        raise ValueError(f"Не число: {cell!r}") from e


@dataclass
class OsvParsedRow:
    account_code: str
    debit: Decimal
    credit: Decimal


@dataclass
class OsvParseResult:
    period_from: date | None
    period_to: date | None
    rows: list[OsvParsedRow]
    warnings: list[str]


@dataclass
class OsvCashParsedRow:
    txn_date: date
    amount: Decimal
    bank: str | None
    short_kind: str | None
    article: str | None
    details: str | None
    basis: str | None
    counterparty: str | None


@dataclass
class OsvCashParseResult:
    period_from: date | None
    period_to: date | None
    rows: list[OsvCashParsedRow]
    warnings: list[str]


def parse_osv_csv_text(raw: str) -> OsvParseResult:
    """Поддерживается UTF-8 с BOM. Первая строка может быть #PERIOD=YYYY-MM-DD..YYYY-MM-DD.

    Далее CSV с разделителем `;` или `,` и колонками account_code / debit / credit
    (или русские заголовки: код счёта, дебет, кредит — без учёта регистра).
    """
    text = raw.lstrip("\ufeff").strip("\n").strip()
    if not text:
        return OsvParseResult(None, None, [], ["Файл пустой"])

    lines = text.splitlines()
    period_from: date | None = None
    period_to: date | None = None
    start_idx = 0
    for i, line in enumerate(lines):
        m = _PERIOD_RE.match(line.strip())
        if m:
            period_from = _parse_date(m.group(1))
            period_to = _parse_date(m.group(2))
            start_idx = i + 1
            break

    body = "\n".join(lines[start_idx:]).strip()
    if not body:
        return OsvParseResult(period_from, period_to, [], ["Нет строк данных после метки периода"])

    sample = body.splitlines()[0]
    delim = ";" if sample.count(";") >= sample.count(",") else ","

    reader = csv.reader(io.StringIO(body), delimiter=delim)
    rows_out: list[OsvParsedRow] = []
    warnings: list[str] = []
    header_map: dict[str, int] | None = None

    for row in reader:
        if not row or all(not (c or "").strip() for c in row):
            continue
        cells = [(c or "").strip() for c in row]
        if header_map is None:
            joined = " ".join(c.lower() for c in cells)
            if "account_code" in joined or "код" in joined or "счет" in joined or "счёт" in joined:
                header_map = {}
                for idx, h in enumerate(cells):
                    hl = h.lower()
                    if "account" in hl or "код" in hl or "счет" in hl or "счёт" in hl:
                        header_map["code"] = idx
                    elif "дебет" in hl or "debit" in hl:
                        header_map["debit"] = idx
                    elif "кредит" in hl or "credit" in hl:
                        header_map["credit"] = idx
                if not {"code", "debit", "credit"}.issubset(header_map.keys()):
                    raise ValueError("Заголовок CSV: нужны колонки кода счёта, дебета и кредита")
                continue

        if header_map is not None:
            code = cells[header_map["code"]].strip()
            d = _parse_decimal(cells[header_map["debit"]])
            c_ = _parse_decimal(cells[header_map["credit"]])
        else:
            if len(cells) < 3:
                raise ValueError("Ожидаются три колонки: код счёта; дебет; кредит")
            code = cells[0].strip()
            d = _parse_decimal(cells[1])
            c_ = _parse_decimal(cells[2])

        if not code:
            continue
        if d == 0 and c_ == 0:
            continue
        if d > 0 and c_ > 0:
            warnings.append(f"Счёт {code}: одновременно дебет и кредит — берём дебет, кредит обнуляем")
            c_ = Decimal("0")
        rows_out.append(OsvParsedRow(account_code=code, debit=d, credit=c_))

    return OsvParseResult(period_from, period_to, rows_out, warnings)


_RU_MONTHS: dict[str, int] = {
    "янв": 1,
    "январ": 1,
    "фев": 2,
    "февр": 2,
    "феврал": 2,
    "мар": 3,
    "март": 3,
    "апр": 4,
    "апрел": 4,
    "май": 5,
    "мая": 5,
    "июн": 6,
    "июнь": 6,
    "июл": 7,
    "июль": 7,
    "авг": 8,
    "август": 8,
    "сен": 9,
    "сент": 9,
    "сентябр": 9,
    "окт": 10,
    "октябр": 10,
    "ноя": 11,
    "нояб": 11,
    "ноябр": 11,
    "дек": 12,
    "декабр": 12,
}


def _month_ru_to_num(token: str) -> int | None:
    t = (token or "").strip().lower().replace(".", "")
    t = re.sub(r"[^a-zа-яё]", "", t)
    if not t:
        return None
    for k, v in _RU_MONTHS.items():
        if t.startswith(k):
            return v
    return None


def _parse_day_month_year(cell: str, default_year: int) -> date | None:
    s = (cell or "").strip()
    if not s:
        return None
    try:
        if re.match(r"^\d{4}-\d{2}-\d{2}$", s):
            return datetime.strptime(s, "%Y-%m-%d").date()
    except ValueError:
        pass
    m = re.match(r"^\s*(\d{1,2})\s+([^\s]+)\.?(?:\s+(\d{4}))?\s*$", s, flags=re.IGNORECASE)
    if not m:
        return None
    day = int(m.group(1))
    month = _month_ru_to_num(m.group(2))
    if month is None:
        return None
    year = int(m.group(3)) if m.group(3) else int(default_year)
    try:
        return date(year, month, day)
    except ValueError:
        return None


def _norm_header(h: str) -> str:
    x = (h or "").strip().lower()
    x = x.replace("\u00a0", " ")
    x = re.sub(r"\s+", " ", x)
    return x


def is_cash_osv_revenue_kind(short_kind: str | None, article: str | None) -> bool:
    """Определяет тип операции cash-OSV с приоритетом колонки "Кратко"."""
    sk = (short_kind or "").strip().lower()
    if sk:
        # Если "Кратко" заполнено, используем только его как источник типа операции.
        if any(k in sk for k in ("выруч", "поступ", "доход")):
            return True
        if any(k in sk for k in ("расход", "зарп", "фот")):
            return False
        # Неизвестное заполненное значение в "Кратко" считаем поступлением по умолчанию.
        return True

    t = (article or "").lower()
    if any(k in t for k in ("расход", "зарп", "фот")):
        return False
    if any(k in t for k in ("выруч", "поступ", "доход")):
        return True
    return True


def parse_osv_cash_csv_text(raw: str, *, default_year: int) -> OsvCashParseResult:
    """Парсер «кассового ОСВ»-CSV, как в файле с колонками Дата/Банк/Статья/Кратко.

    Поддерживает разделители `,` и `;`, русские даты формата `2 янв.` (год берётся из default_year).
    """
    text = raw.lstrip("\ufeff")
    if not text.strip():
        return OsvCashParseResult(None, None, [], ["Файл пустой"])
    lines = text.splitlines()
    sample = "\n".join(lines[:50])
    delim = ";" if sample.count(";") > sample.count(",") else ","
    reader = csv.reader(io.StringIO(text), delimiter=delim)
    rows = [r for r in reader]
    if not rows:
        return OsvCashParseResult(None, None, [], ["Файл пустой"])

    header_idx = -1
    for i, row in enumerate(rows[:80]):
        headers = [_norm_header(c) for c in row]
        joined = " ".join(headers)
        if "дата" in joined and "статья" in joined and "кратко" in joined:
            header_idx = i
            break
    if header_idx < 0:
        raise ValueError("Формат не распознан: нет заголовка с колонками Дата/Статья/Кратко")

    hdr = [_norm_header(c) for c in rows[header_idx]]
    idx_date = next((i for i, h in enumerate(hdr) if h.startswith("дата")), None)
    idx_bank = next((i for i, h in enumerate(hdr) if "банк" in h), None)
    idx_article = next((i for i, h in enumerate(hdr) if "статья" in h), None)
    idx_details = next((i for i, h in enumerate(hdr) if "подроб" in h), None)
    idx_short = next((i for i, h in enumerate(hdr) if "кратко" in h), None)
    idx_basis = next((i for i, h in enumerate(hdr) if "основание" in h), None)
    idx_counterparty = next((i for i, h in enumerate(hdr) if "контрагент" in h), None)
    if idx_date is None:
        raise ValueError("В файле не найдена колонка «Дата»")
    if idx_article is None and idx_short is None:
        raise ValueError("В файле не найдены колонки «Статья»/«Кратко»")

    idx_som_before_bank = [i for i, h in enumerate(hdr) if h == "som" and (idx_bank is None or i < idx_bank)]
    if not idx_som_before_bank:
        raise ValueError("В файле не найдены колонки суммы (SOM) перед колонкой «Банк»")
    primary_amount_idx = idx_som_before_bank[-1]
    fallback_amount_idx = idx_som_before_bank[:-1]

    out: list[OsvCashParsedRow] = []
    warnings: list[str] = []
    skipped_no_date = 0
    skipped_no_amount = 0

    for raw_row in rows[header_idx + 1 :]:
        if not raw_row or all(not (c or "").strip() for c in raw_row):
            continue
        row = raw_row + [""] * (len(hdr) - len(raw_row))

        d = _parse_day_month_year(row[idx_date], default_year=default_year)
        if d is None:
            skipped_no_date += 1
            continue

        amount_cell = row[primary_amount_idx] if primary_amount_idx < len(row) else ""
        amount: Decimal
        try:
            amount = _parse_decimal(amount_cell)
        except ValueError:
            amount = Decimal("0")
        if amount == 0:
            for alt_idx in reversed(fallback_amount_idx):
                try:
                    cand = _parse_decimal(row[alt_idx] if alt_idx < len(row) else "")
                except ValueError:
                    cand = Decimal("0")
                if cand != 0:
                    amount = cand
                    break
        if amount == 0:
            skipped_no_amount += 1
            continue

        def pick(i: int | None) -> str | None:
            if i is None or i >= len(row):
                return None
            v = (row[i] or "").strip()
            return v or None

        out.append(
            OsvCashParsedRow(
                txn_date=d,
                amount=amount,
                bank=pick(idx_bank),
                short_kind=pick(idx_short),
                article=pick(idx_article),
                details=pick(idx_details),
                basis=pick(idx_basis),
                counterparty=pick(idx_counterparty),
            )
        )

    if skipped_no_date > 0:
        warnings.append(f"Пропущено строк без даты/неизвестной даты: {skipped_no_date}")
    if skipped_no_amount > 0:
        warnings.append(f"Пропущено строк без суммы: {skipped_no_amount}")
    if not out:
        return OsvCashParseResult(None, None, [], warnings + ["Не найдено валидных операций"])
    p_from = min(r.txn_date for r in out)
    p_to = max(r.txn_date for r in out)
    return OsvCashParseResult(p_from, p_to, out, warnings)
