"""Оплата и долг карточек «Менеджеры» — тот же набор визитов, что у вкладки «Услуги».

Пакет «Курс» / «Протокол» в записи не прибавляем: эти деньги уже в оплате KPI.
Отмена не входит. «Курс 15» остаётся визитом.
"""

from __future__ import annotations

from decimal import Decimal

from app.services.booking_directions import is_admin_only_booking_direction_name

PRIOR_VISIT_DEBT_NAME = "Долг прошлых месяцев"


def overview_visit_money(rows: list[tuple]) -> tuple[Decimal, Decimal]:
    """rows: (paid, service_amount, status, direction_name) → (оплачено, долг)."""
    paid_total = Decimal("0")
    debt_total = Decimal("0")
    for paid_raw, service_raw, status_raw, direction in rows:
        if is_admin_only_booking_direction_name(direction):
            continue
        if (status_raw or "").strip() == "cancelled":
            continue
        paid = Decimal(str(paid_raw or 0))
        service = Decimal(str(service_raw or 0))
        paid_total += paid
        if service > paid:
            debt_total += service - paid
    return paid_total, debt_total


def prior_visit_debt(card_total: Decimal, shown_in_rows: Decimal) -> Decimal:
    """Хвост дебиторки карточки, которого нет в строках выбранного месяца."""
    gap = Decimal(str(card_total or 0)) - Decimal(str(shown_in_rows or 0))
    if gap <= Decimal("0.009"):
        return Decimal("0")
    return gap.quantize(Decimal("0.01"))
