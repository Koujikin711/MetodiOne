"""Как владелец меняет уже записанную оплату курса, не стирая строки журнала."""

from __future__ import annotations

from dataclasses import dataclass
from decimal import Decimal

_Q = Decimal("0.01")


class PaidAdjustError(ValueError):
    """Сумма не встаёт на продажу: отрицательная, больше цены или не из чего снимать."""


@dataclass(frozen=True)
class PaidAdjustLine:
    id: int
    amount: Decimal
    is_first: bool = False


@dataclass(frozen=True)
class PaidAdjustChange:
    id: int
    old: Decimal
    new: Decimal
    is_first: bool


@dataclass(frozen=True)
class PaidAdjustPlan:
    target: Decimal
    changes: list[PaidAdjustChange]
    add_amount: Decimal


def _money(value: Decimal) -> Decimal:
    return Decimal(str(value or 0)).quantize(_Q)


def plan_paid_adjustment(
    *,
    paid: Decimal,
    service: Decimal,
    lines: list[PaidAdjustLine],
    mode: str,
    amount: Decimal,
) -> PaidAdjustPlan:
    """Снять или поставить итог оплаты.

    Снятие забирает деньги с самых новых подтверждённых строк. Новая большая
    сумма не раздувает старые строки — её дописывают отдельной доплатой.
    """
    paid_now = _money(paid)
    price = _money(service)
    asked = _money(amount)
    confirmed = [PaidAdjustLine(int(line.id), _money(line.amount), bool(line.is_first)) for line in lines if _money(line.amount) > 0]
    line_sum = sum((line.amount for line in confirmed), Decimal("0"))
    gap = paid_now - line_sum

    if mode == "subtract":
        if asked <= 0:
            raise PaidAdjustError("Сумма снятия должна быть больше нуля")
        target = _money(paid_now - asked)
    elif mode == "set":
        if asked < 0:
            raise PaidAdjustError("Сумма не может быть отрицательной")
        target = asked
    else:
        raise PaidAdjustError("Неизвестный способ правки")

    if target < 0:
        raise PaidAdjustError(f"Снять можно не больше оплаченного ({paid_now})")
    if price > 0 and target > price:
        raise PaidAdjustError(f"Оплата не может быть больше стоимости ({price})")
    if price <= 0 and target > 0:
        raise PaidAdjustError("У продажи нет стоимости")
    if target == paid_now and (gap >= 0 or line_sum <= target):
        raise PaidAdjustError("Сумма не изменилась")

    delta = _money(target - paid_now)
    if delta > 0:
        return PaidAdjustPlan(target=target, changes=[], add_amount=delta)

    need = _money(paid_now - target)
    removable = line_sum + (gap if gap > 0 else Decimal("0"))
    if need > removable:
        raise PaidAdjustError(f"В журнале нет такой суммы: оплачено {paid_now}")

    # Если строки толще итога, уводим их не выше новой оплаты.
    remove_from_lines = min(line_sum, max(need, _money(line_sum - target)))
    changes: list[PaidAdjustChange] = []
    left = remove_from_lines
    for line in sorted(confirmed, key=lambda item: item.id, reverse=True):
        if left <= 0:
            break
        cut = min(line.amount, left)
        new_amount = _money(line.amount - cut)
        left = _money(left - cut)
        if new_amount != line.amount:
            changes.append(
                PaidAdjustChange(id=line.id, old=line.amount, new=new_amount, is_first=line.is_first),
            )
    if left > 0:
        raise PaidAdjustError("Не удалось разложить снятие по строкам журнала")
    return PaidAdjustPlan(target=target, changes=changes, add_amount=Decimal("0"))
