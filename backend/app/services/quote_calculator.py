"""Калькулятор модулей CRM для пространства продаж (TJS / сомони)."""

from __future__ import annotations

from decimal import Decimal
from typing import Any

# id, label, short description for UI
SALES_ITEMS = [
    ("cash", "Касса", "Приём оплат, чеки и кассовые смены по точкам"),
    ("catalog", "Каталог", "Товары и услуги с ценами, остатками и категориями"),
    ("roles", "Роли", "Права доступа: кассир, менеджер, владелец"),
    ("conversion", "Конвертация", "Валюты и курсы при продаже и отчётах"),
    ("sales_reports", "Отчёты по продажам", "Выручка, средний чек, динамика по дням"),
    ("expense", "Расход", "Фиксация операционных расходов точки"),
    ("payouts", "Выплаты", "Зарплаты, авансы и выдачи сотрудникам"),
]

ACCOUNTING_BASE_ITEMS = [
    ("dds", "ДДС", "Движение денежных средств: поступления и выплаты"),
    ("opiu", "ОПиУ", "Отчёт о прибылях и убытках за период"),
    ("balance", "Баланс", "Активы, обязательства и капитал на дату"),
    ("warehouse", "Склад", "Остатки, приход/расход, инвентаризация"),
]

ACCOUNTING_EXTRA_ITEMS = [
    ("roles", "Роли", "Разграничение доступа к фин.отчётам"),
    ("conversion", "Конвертация", "Мультивалютный учёт в отчётах"),
    ("audit", "Аудит", "Журнал изменений и контроль операций"),
]

PRODUCTION_ITEMS = [
    ("roles", "Роли", "Роли цеха, склада и контроля качества"),
    ("tech_cards", "Техкарты", "Рецепты, нормы сырья и себестоимость"),
    ("warehouse", "Склад", "Сырьё и готовая продукция с автосписанием"),
    ("catalog", "Каталог", "Номенклатура выпуска и полуфабрикатов"),
    ("cash", "Касса", "Оплата заказов производства и отгрузок"),
]

REPORTS_ITEMS = [
    ("charts", "Диаграммы", "Наглядные графики по ключевым метрикам"),
    ("leads", "Лиды", "Воронка лидов: источники, стадии, отвалы"),
    ("sales_qty", "Количество продаж", "Объём сделок и закрытых продаж"),
    ("answer_quality", "Качество ответов менеджеров", "Скорость и качество ответов в чатах"),
    ("conversion", "Конверсия", "Конверсия лид → сделка и по стадиям"),
]

SERVICE_ITEMS = [
    ("gps", "GPS-трекер", "Трекинг выездных сотрудников на карте"),
    ("departments", "Отделы", "Структура отделов и зоны ответственности"),
    ("hr", "HR", "Сотрудники, графики и кадровый контур"),
    ("couriers", "Курьеры", "Маршруты доставки и статусы заказов"),
    ("analytics", "Аналитика", "Доп.дашборды под ваш процесс"),
    ("integration", "Интеграция", "Подключение внешних систем и API"),
]

PRICE_SALES_ANY3 = Decimal("5000")
PRICE_SALES_ALL = Decimal("7000")
PRICE_ACCOUNTING = Decimal("7000")
PRICE_PRODUCTION = Decimal("10000")
PRICE_REPORTS = Decimal("7000")
PRICE_SERVICE_EACH = Decimal("1500")


def _item_dicts(rows: list[tuple[str, str, str]]) -> list[dict[str, str]]:
    return [{"id": i, "label": l, "description": d} for i, l, d in rows]


def catalog() -> dict[str, Any]:
    return {
        "currency": "TJS",
        "modules": [
            {
                "id": "sales",
                "title": "Продажи",
                "subtitle": "Точка продаж и операционный контур",
                "description": (
                    "Модуль для розницы и сервисных точек: от каталога и кассы до ролей, "
                    "расходов и выплат. Соберите нужный набор функций — от базовой кассы до полного контура."
                ),
                "pricing_hint": "Любые 3 пункта — 5000 TJS; все 7 — 7000 TJS. Минимум 3.",
                "min_selected": 3,
                "price_any3": float(PRICE_SALES_ANY3),
                "price_all": float(PRICE_SALES_ALL),
                "items": _item_dicts(SALES_ITEMS),
            },
            {
                "id": "accounting",
                "title": "Бухгалтерия",
                "subtitle": "Финансовый контур компании",
                "description": (
                    "Готовый пакет управленческого учёта: денежные потоки, прибыль, баланс и склад. "
                    "Опционально — роли, мультивалютность и аудит действий."
                ),
                "pricing_hint": "Пакет 7000 TJS. База входит целиком; дополнения — по желанию.",
                "fixed_price": float(PRICE_ACCOUNTING),
                "base_items": _item_dicts(ACCOUNTING_BASE_ITEMS),
                "extra_items": _item_dicts(ACCOUNTING_EXTRA_ITEMS),
            },
            {
                "id": "production",
                "title": "Производство",
                "subtitle": "Цех, техкарты и склад сырья",
                "description": (
                    "Для производства и кухни: техкарты с нормами, склад сырья с автосписанием, "
                    "каталог выпуска и касса по заказам. Роли разделяют цех, склад и контроль."
                ),
                "pricing_hint": "Фиксированный пакет 10 000 TJS — все блоки включены.",
                "fixed_price": float(PRICE_PRODUCTION),
                "items": _item_dicts(PRODUCTION_ITEMS),
            },
            {
                "id": "reports",
                "title": "Отчёты",
                "subtitle": "Аналитика продаж и команды",
                "description": (
                    "Сводная аналитика для руководства: воронка лидов, объём продаж, конверсия "
                    "и качество ответов менеджеров — с диаграммами для быстрых решений."
                ),
                "pricing_hint": "Фиксированный пакет 7000 TJS — полный набор отчётов.",
                "fixed_price": float(PRICE_REPORTS),
                "items": _item_dicts(REPORTS_ITEMS),
            },
            {
                "id": "services",
                "title": "Услуги",
                "subtitle": "Дополнения под вашу операционку",
                "description": (
                    "Отдельные сервисы поверх модулей: выездной GPS, курьеры, HR, отделы, "
                    "расширенная аналитика и интеграции с внешними системами."
                ),
                "pricing_hint": "Каждая услуга +1500 TJS к итогу.",
                "price_each": float(PRICE_SERVICE_EACH),
                "items": _item_dicts(SERVICE_ITEMS),
            },
        ],
    }


def _labels(pairs: list[tuple[str, str, str]], ids: list[str]) -> list[str]:
    m = {i: l for i, l, _ in pairs}
    return [m[i] for i in ids if i in m]


def compute_quote(payload: dict[str, Any]) -> dict[str, Any]:
    """Считает сумму заказа по выбранным модулям."""
    lines: list[dict[str, Any]] = []
    total = Decimal("0")
    errors: list[str] = []

    sales_ids = [str(x) for x in (payload.get("sales_item_ids") or [])]
    sales_valid = {i for i, _, _ in SALES_ITEMS}
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
    extra_valid = {i for i, _, _ in ACCOUNTING_EXTRA_ITEMS}
    accounting_extras = [x for x in accounting_extras if x in extra_valid]
    if accounting_enabled:
        items = _labels(ACCOUNTING_BASE_ITEMS, [i for i, _, _ in ACCOUNTING_BASE_ITEMS])
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
                "items": _labels(PRODUCTION_ITEMS, [i for i, _, _ in PRODUCTION_ITEMS]),
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
                "items": _labels(REPORTS_ITEMS, [i for i, _, _ in REPORTS_ITEMS]),
                "amount": float(amount),
            },
        )
        total += amount

    service_ids = [str(x) for x in (payload.get("service_ids") or [])]
    service_valid = {i for i, _, _ in SERVICE_ITEMS}
    service_ids = [x for x in service_ids if x in service_valid]
    for sid in service_ids:
        label = next(l for i, l, _ in SERVICE_ITEMS if i == sid)
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
