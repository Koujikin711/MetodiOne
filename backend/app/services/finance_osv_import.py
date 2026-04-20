"""Парсинг CSV ОСВ (обороты по счетам) и подготовка строк для загрузки в журнал."""

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
