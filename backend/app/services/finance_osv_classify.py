"""Классификация строк ОСВ для ДДС и ОПиУ (как в Google Sheets)."""

from __future__ import annotations

from dataclasses import dataclass
from decimal import Decimal

from app.models import FinanceOsvRow


def _norm(s: str | None) -> str:
    return (s or "").strip().lower()


@dataclass(frozen=True)
class OsvClassification:
    dds_section: str
    dds_group: str
    dds_line: str
    opiu_line: str
    cash_sign: int  # +1 поступление, -1 расход


def classify_osv_row(row: FinanceOsvRow) -> OsvClassification:
    article = _norm(row.article)
    brief = _norm(row.brief_category)
    detail = _norm(row.detail_category)
    basis = _norm(row.basis)
    product = (row.product_service or "").strip() or "Прочее"
    counterparty = (row.counterparty or "").strip() or "Без контрагента"
    rev = Decimal(row.revenue or 0)
    exp = Decimal(row.expense or 0)

    if rev > 0:
        line = product if product != "Прочее" else (row.basis or "Выручка")
        opiu = "revenue_other" if "проч" in basis or "проч" in article else "revenue_clinic"
        return OsvClassification("operating", "receipts", line, opiu, 1)

    # расходы
    if "возврат" in article or "возврат" in brief or "возврат" in basis:
        return OsvClassification("operating", "refunds", row.basis or "Возврат", "revenue_clinic", -1)

    if "фот" in article or "зарплат" in brief or "зарплат" in article:
        line = counterparty if counterparty != "Без контрагента" else (row.via_person or product or "ФОТ")
        opiu = "fixed_salary" if "оклад" in detail or "админ" in product.lower() else "variable_piecework"
        return OsvClassification("operating", "payroll", line, opiu, -1)

    if "маркетинг" in article or "маркетинг" in detail or "рек" in product.lower():
        return OsvClassification("operating", "marketing", product or row.basis or "Маркетинг", "fixed_marketing", -1)

    if "аренда" in article or "аренда" in detail or "аренда" in basis:
        return OsvClassification("operating", "rent_utilities", "Аренда", "fixed_rent", -1)

    if "коммун" in article or "коммун" in detail:
        return OsvClassification("operating", "rent_utilities", "Коммунальные услуги", "fixed_utilities", -1)

    if "налог" in article or "налог" in brief or "налог" in detail:
        return OsvClassification("operating", "taxes", "Налог", "taxes", -1)

    if any(x in detail for x in ("препарат", "материал")) or "препарат" in product.lower():
        return OsvClassification("operating", "admin", product or "Препараты и материалы", "variable_materials", -1)

    if any(x in product.lower() for x in ("канц", "обед", "гсм", "хоз")) or "обед" in basis:
        return OsvClassification(
            "operating",
            "admin",
            product or row.basis or "Административные",
            "fixed_admin",
            -1,
        )

    if any(x in product.lower() for x in ("связь", "интернет")) or "связь" in detail:
        return OsvClassification("operating", "admin", "Связь и Интернет", "fixed_comms", -1)

    if any(x in article for x in ("инвест", "ос ")) or product.startswith("ОС "):
        return OsvClassification("investing", "assets", product or "ОС", "fixed_admin", -1)

    if "финанс" in article or counterparty != "Без контрагента" and exp > 0 and "займ" in basis:
        return OsvClassification("financing", "flows", counterparty, "fixed_admin", -1)

    label = product or row.basis or counterparty or "Прочие расходы"
    opiu = "fixed_admin"
    if exp > 0:
        return OsvClassification("operating", "admin", label, opiu, -1)
    return OsvClassification("operating", "receipts", label, "revenue_other", 1)
