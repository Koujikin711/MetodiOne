"""Калькулятор модулей CRM для пространства продаж (TJS / сомони)."""

from __future__ import annotations

from decimal import Decimal
from typing import Any

SALES_ITEMS = [
    ("cash", "Касса"),
    ("catalog", "Каталог"),
    ("roles", "Роли"),
    ("conversion", "Конвертация"),
    ("sales_reports", "Отчёты по продажам"),
    ("expense", "Расход"),
    ("payouts", "Выплаты"),
]

ACCOUNTING_BASE_ITEMS = [
    ("dds", "ДДС"),
    ("opiu", "ОПиУ"),
    ("balance", "Баланс"),
    ("warehouse", "Склад"),
]

ACCOUNTING_EXTRA_ITEMS = [
    ("roles", "Роли"),
    ("conversion", "Конвертация"),
    ("audit", "Аудит"),
]

PRODUCTION_ITEMS = [
    ("roles", "Роли"),
    ("tech_cards", "Техкарты"),
    ("warehouse", "Склад"),
    ("catalog", "Каталог"),
    ("cash", "Касса"),
]

REPORTS_ITEMS = [
    ("charts", "Диаграммы"),
    ("leads", "Лиды"),
    ("sales_qty", "Количество продаж"),
    ("answer_quality", "Качество ответов менеджеров"),
    ("conversion", "Конверсия"),
]

SERVICE_ITEMS = [
    ("gps", "GPS-трекер"),
    ("departments", "Отделы"),
    ("hr", "HR"),
    ("couriers", "Курьеры"),
    ("analytics", "Аналитика"),
    ("integration", "Интеграция"),
]

PRICE_SALES_ANY3 = Decimal("5000")
PRICE_SALES_ALL = Decimal("7000")
PRICE_ACCOUNTING = Decimal("7000")
PRICE_PRODUCTION = Decimal("10000")
PRICE_REPORTS = Decimal("7000")
PRICE_SERVICE_EACH = Decimal("1500")


def catalog() -> dict[str, Any]:
    return {
        "currency": "TJS",
        "modules": [
            {
                "id": "sales",
                "title": "Продажи",
                "pricing_hint": "Любые 3 пункта — 5000; все 7 — 7000. Минимум 3.",
                "min_selected": 3,
                "price_any3": float(PRICE_SALES_ANY3),
                "price_all": float(PRICE_SALES_ALL),
                "items": [{"id": i, "label": l} for i, l in SALES_ITEMS],
            },
            {
                "id": "accounting",
                "title": "Бухгалтерия",
                "pricing_hint": "Пакет 7000. База: ДДС, ОПиУ, Баланс, Склад. Можно добавить Роли, Конвертация, Аудит.",
                "fixed_price": float(PRICE_ACCOUNTING),
                "base_items": [{"id": i, "label": l} for i, l in ACCOUNTING_BASE_ITEMS],
                "extra_items": [{"id": i, "label": l} for i, l in ACCOUNTING_EXTRA_ITEMS],
            },
            {
                "id": "production",
                "title": "Производство",
                "pricing_hint": "Пакет 10000: Роли, Техкарты, Склад, Каталог, Касса.",
                "fixed_price": float(PRICE_PRODUCTION),
                "items": [{"id": i, "label": l} for i, l in PRODUCTION_ITEMS],
            },
            {
                "id": "reports",
                "title": "Отчёты",
                "pricing_hint": "Пакет 7000: диаграммы, лиды, кол-во продаж, качество ответов, конверсия.",
                "fixed_price": float(PRICE_REPORTS),
                "items": [{"id": i, "label": l} for i, l in REPORTS_ITEMS],
            },
            {
                "id": "services",
                "title": "Услуги",
                "pricing_hint": "Каждая галочка +1500.",
                "price_each": float(PRICE_SERVICE_EACH),
                "items": [{"id": i, "label": l} for i, l in SERVICE_ITEMS],
            },
        ],
    }


def _labels(pairs: list[tuple[str, str]], ids: list[str]) -> list[str]:
    m = dict(pairs)
    return [m[i] for i in ids if i in m]


def compute_quote(payload: dict[str, Any]) -> dict[str, Any]:
    """Считает сумму заказа по выбранным модулям."""
    lines: list[dict[str, Any]] = []
    total = Decimal("0")
    errors: list[str] = []

    sales_ids = [str(x) for x in (payload.get("sales_item_ids") or [])]
    sales_valid = {i for i, _ in SALES_ITEMS}
    sales_ids = [x for x in sales_ids if x in sales_valid]
    if sales_ids:
        n = len(sales_ids)
        if n < 3:
            errors.append("В модуле «Продажи» выберите минимум 3 пункта")
        elif n >= 7:
            amount = PRICE_SALES_ALL
            lines.append(
                {
                    "module": "sales",
                    "title": "Продажи (все пункты)",
                    "items": _labels(SALES_ITEMS, sales_ids),
                    "amount": float(amount),
                },
            )
            total += amount
        else:
            amount = PRICE_SALES_ANY3
            lines.append(
                {
                    "module": "sales",
                    "title": f"Продажи ({n} пункта)",
                    "items": _labels(SALES_ITEMS, sales_ids),
                    "amount": float(amount),
                },
            )
            total += amount

    accounting_enabled = bool(payload.get("accounting_enabled"))
    accounting_extras = [str(x) for x in (payload.get("accounting_extra_ids") or [])]
    extra_valid = {i for i, _ in ACCOUNTING_EXTRA_ITEMS}
    accounting_extras = [x for x in accounting_extras if x in extra_valid]
    if accounting_enabled:
        items = _labels(ACCOUNTING_BASE_ITEMS, [i for i, _ in ACCOUNTING_BASE_ITEMS])
        items += _labels(ACCOUNTING_EXTRA_ITEMS, accounting_extras)
        amount = PRICE_ACCOUNTING
        lines.append(
            {
                "module": "accounting",
                "title": "Бухгалтерия",
                "items": items,
                "amount": float(amount),
            },
        )
        total += amount
    elif accounting_extras:
        errors.append("Дополнения бухгалтерии доступны только при выбранном модуле «Бухгалтерия»")

    if bool(payload.get("production_enabled")):
        amount = PRICE_PRODUCTION
        lines.append(
            {
                "module": "production",
                "title": "Производство",
                "items": _labels(PRODUCTION_ITEMS, [i for i, _ in PRODUCTION_ITEMS]),
                "amount": float(amount),
            },
        )
        total += amount

    if bool(payload.get("reports_enabled")):
        amount = PRICE_REPORTS
        lines.append(
            {
                "module": "reports",
                "title": "Отчёты",
                "items": _labels(REPORTS_ITEMS, [i for i, _ in REPORTS_ITEMS]),
                "amount": float(amount),
            },
        )
        total += amount

    service_ids = [str(x) for x in (payload.get("service_ids") or [])]
    service_valid = {i for i, _ in SERVICE_ITEMS}
    service_ids = [x for x in service_ids if x in service_valid]
    for sid in service_ids:
        label = dict(SERVICE_ITEMS)[sid]
        amount = PRICE_SERVICE_EACH
        lines.append(
            {
                "module": "services",
                "title": f"Услуга: {label}",
                "items": [label],
                "amount": float(amount),
            },
        )
        total += amount

    if not lines and not errors:
        errors.append("Выберите хотя бы один модуль или услугу")

    return {
        "ok": len(errors) == 0,
        "errors": errors,
        "currency": "TJS",
        "total": float(total.quantize(Decimal("0.01"))),
        "lines": lines,
        "summary_text": _summary_text(lines, total) if not errors else "",
    }


def _summary_text(lines: list[dict[str, Any]], total: Decimal) -> str:
    parts: list[str] = []
    for line in lines:
        items = ", ".join(line.get("items") or [])
        parts.append(f"{line['title']}: {items} — {line['amount']:.0f} TJS")
    parts.append(f"ИТОГО: {total.quantize(Decimal('0.01'))} TJS")
    return "\n".join(parts)
