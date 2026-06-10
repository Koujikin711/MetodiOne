"""Построение ДДС и ОПиУ из таблицы ОСВ."""

from __future__ import annotations

import calendar
from collections import defaultdict
from datetime import date
from decimal import Decimal

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import FinanceOsvRow
from app.schemas.finance_v2 import (
    FinanceDdsReportRead,
    FinanceOpiuReportRead,
    FinanceOsvRowRead,
    FinanceOsvSummaryRead,
    FinanceReportCellRow,
    FinanceReportGroup,
    FinanceReportSection,
)
from app.services.finance_osv_classify import classify_osv_row

_MONTH_LABELS = [
    "Январь",
    "Февраль",
    "Март",
    "Апрель",
    "Май",
    "Июнь",
    "Июль",
    "Август",
    "Сентябрь",
    "Октябрь",
    "Ноябрь",
    "Декабрь",
]

_DDS_GROUPS: list[tuple[str, str, str]] = [
    ("operating", "receipts", "Поступления (Выручка)"),
    ("operating", "payroll", "ФОТ (Зарплата)"),
    ("operating", "marketing", "Маркетинг"),
    ("operating", "rent_utilities", "Аренда и коммуналка"),
    ("operating", "admin", "Административные расходы"),
    ("operating", "taxes", "Налоги"),
    ("operating", "refunds", "Возвраты"),
    ("investing", "assets", "ИНВЕСТИЦИОННАЯ ДЕЯТЕЛЬНОСТЬ"),
    ("financing", "flows", "ФИНАНСОВАЯ ДЕЯТЕЛЬНОСТЬ"),
]

_OPIU_LINES: list[tuple[str, str, bool]] = [
    ("revenue_clinic", "Услуги клиники", False),
    ("revenue_other", "Прочие доходы", False),
    ("revenue_total", "ИТОГО ВЫРУЧКА", True),
    ("variable_materials", "Препараты и материалы", False),
    ("variable_piecework", "Сдельная з/п персонала", False),
    ("variable_total", "ИТОГО ПЕРЕМЕННЫЕ РАСХОДЫ", True),
    ("margin", "МАРЖИНАЛЬНАЯ ПРИБЫЛЬ", True),
    ("fixed_rent", "Аренда помещения", False),
    ("fixed_utilities", "Коммунальные услуги", False),
    ("fixed_salary", "Зарплата (окладная часть)", False),
    ("fixed_marketing", "Маркетинг и реклама", False),
    ("fixed_admin", "Хозяйственные расходы", False),
    ("fixed_comms", "Связь и интернет", False),
    ("fixed_total", "ИТОГО ПОСТОЯННЫЕ РАСХОДЫ", True),
    ("ebitda", "EBITDA (Опер. прибыль)", True),
    ("taxes", "НАЛОГИ И СБОРЫ", False),
    ("net_profit", "ЧИСТАЯ ПРИБЫЛЬ", True),
    ("margin_pct", "Рентабельность по ЧП, %", True),
]


def _zeros() -> list[Decimal]:
    return [Decimal("0")] * 12


def _month_idx(d) -> int:
    return int(d.month) - 1


async def load_osv_summary(
    db: AsyncSession,
    *,
    company_id: int,
    year: int | None = None,
    month: int | None = None,
    limit: int = 500,
) -> FinanceOsvSummaryRead:
    q = select(FinanceOsvRow).where(FinanceOsvRow.company_id == company_id)
    if year is not None:
        q = q.where(
            FinanceOsvRow.txn_date >= date(year, 1, 1),
            FinanceOsvRow.txn_date <= date(year, 12, 31),
        )
    if month is not None and year is not None:
        last_day = calendar.monthrange(year, month)[1]
        q = q.where(
            FinanceOsvRow.txn_date >= date(year, month, 1),
            FinanceOsvRow.txn_date <= date(year, month, last_day),
        )
    q = q.order_by(FinanceOsvRow.txn_date.asc(), FinanceOsvRow.id.asc()).limit(limit)
    rows = (await db.execute(q)).scalars().all()
    rev = sum((Decimal(r.revenue or 0) for r in rows), Decimal("0"))
    exp = sum((Decimal(r.expense or 0) for r in rows), Decimal("0"))
    return FinanceOsvSummaryRead(
        revenue_total=rev,
        expense_total=exp,
        balance=rev - exp,
        rows=[FinanceOsvRowRead.model_validate(r) for r in rows],
    )


async def build_dds_report(db: AsyncSession, *, company_id: int, year: int) -> FinanceDdsReportRead:
    rows = (
        await db.execute(
            select(FinanceOsvRow).where(
                FinanceOsvRow.company_id == company_id,
                FinanceOsvRow.txn_date >= date(year, 1, 1),
                FinanceOsvRow.txn_date <= date(year, 12, 31),
            ),
        )
    ).scalars().all()

    bucket: dict[tuple[str, str, str], list[Decimal]] = defaultdict(_zeros)
    for row in rows:
        cls = classify_osv_row(row)
        mi = _month_idx(row.txn_date)
        amt = Decimal(row.revenue or 0) if cls.cash_sign > 0 else Decimal(row.expense or 0)
        if amt <= 0:
            amt = Decimal(row.revenue or 0) or Decimal(row.expense or 0)
        bucket[(cls.dds_section, cls.dds_group, cls.dds_line)][mi] += amt * cls.cash_sign

    month_net = _zeros()
    for vals in bucket.values():
        for i, v in enumerate(vals):
            month_net[i] += v

    opening = _zeros()
    closing = _zeros()
    running = Decimal("0")
    for i in range(12):
        opening[i] = running
        running += month_net[i]
        closing[i] = running

    sections_out: list[FinanceReportSection] = []
    for section_key, section_title in (
        ("operating", "ОПЕРАЦИОННАЯ ДЕЯТЕЛЬНОСТЬ"),
        ("investing", "ИНВЕСТИЦИОННАЯ ДЕЯТЕЛЬНОСТЬ"),
        ("financing", "ФИНАНСОВАЯ ДЕЯТЕЛЬНОСТЬ"),
    ):
        groups: list[FinanceReportGroup] = []
        for sec, grp, title in _DDS_GROUPS:
            if sec != section_key:
                continue
            line_keys = sorted({k[2] for k in bucket if k[0] == sec and k[1] == grp})
            line_rows: list[FinanceReportCellRow] = []
            for label in line_keys:
                vals = bucket.get((sec, grp, label), _zeros())
                line_rows.append(
                    FinanceReportCellRow(
                        key=f"{sec}:{grp}:{label}",
                        label=label,
                        values=[abs(v) for v in vals],
                        total=sum((abs(v) for v in vals), Decimal("0")),
                    ),
                )
            if line_rows:
                groups.append(FinanceReportGroup(key=grp, label=title, rows=line_rows))
        if groups:
            sections_out.append(FinanceReportSection(key=section_key, label=section_title, groups=groups))

    labels = [f"{m} {year}" for m in _MONTH_LABELS]
    return FinanceDdsReportRead(
        year=year,
        month_labels=labels,
        opening_balance=opening,
        closing_balance=closing,
        sections=sections_out,
    )


async def build_opiu_report(db: AsyncSession, *, company_id: int, year: int) -> FinanceOpiuReportRead:
    rows = (
        await db.execute(
            select(FinanceOsvRow).where(
                FinanceOsvRow.company_id == company_id,
                FinanceOsvRow.txn_date >= date(year, 1, 1),
                FinanceOsvRow.txn_date <= date(year, 12, 31),
            ),
        )
    ).scalars().all()

    bucket: dict[str, list[Decimal]] = defaultdict(_zeros)
    for row in rows:
        cls = classify_osv_row(row)
        mi = _month_idx(row.txn_date)
        if cls.opiu_line == "revenue_clinic" or cls.opiu_line == "revenue_other":
            bucket[cls.opiu_line][mi] += Decimal(row.revenue or 0)
        elif cls.opiu_line == "taxes":
            bucket["taxes"][mi] += Decimal(row.expense or 0)
        else:
            bucket[cls.opiu_line][mi] += Decimal(row.expense or 0)

    def row_vals(key: str) -> list[Decimal]:
        return bucket.get(key, _zeros())

    def sum_rows(*keys: str) -> list[Decimal]:
        out = _zeros()
        for k in keys:
            for i, v in enumerate(row_vals(k)):
                out[i] += v
        return out

    revenue_total = sum_rows("revenue_clinic", "revenue_other")
    variable_total = sum_rows("variable_materials", "variable_piecework")
    margin = [revenue_total[i] - variable_total[i] for i in range(12)]
    fixed_total = sum_rows(
        "fixed_rent",
        "fixed_utilities",
        "fixed_salary",
        "fixed_marketing",
        "fixed_admin",
        "fixed_comms",
    )
    ebitda = [margin[i] - fixed_total[i] for i in range(12)]
    taxes = row_vals("taxes")
    net = [ebitda[i] - taxes[i] for i in range(12)]
    margin_pct = [
        (net[i] / revenue_total[i] * Decimal("100")) if revenue_total[i] else Decimal("0") for i in range(12)
    ]

    computed: dict[str, list[Decimal]] = {
        "revenue_total": revenue_total,
        "variable_total": variable_total,
        "margin": margin,
        "fixed_total": fixed_total,
        "ebitda": ebitda,
        "net_profit": net,
        "margin_pct": margin_pct,
    }

    out_rows: list[FinanceReportCellRow] = []
    for key, label, bold in _OPIU_LINES:
        vals = computed.get(key, row_vals(key))
        total = sum(vals, Decimal("0"))
        out_rows.append(
            FinanceReportCellRow(
                key=key,
                label=label,
                values=vals,
                total=total,
                bold=bold,
                indent=0 if bold else 1,
            ),
        )

    labels = [f"{m} {year}" for m in _MONTH_LABELS]
    return FinanceOpiuReportRead(year=year, month_labels=labels, rows=out_rows)
