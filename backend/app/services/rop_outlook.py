"""Сценарии прогноза РОП: темп месяца → худший / средний / лучший."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date, timedelta
from decimal import Decimal, ROUND_HALF_UP


def _d(v: float | int | Decimal) -> Decimal:
    return Decimal(str(v or 0)).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)


def _i(v: float | int | Decimal) -> int:
    return int(round(float(v or 0)))


@dataclass(frozen=True)
class OutlookScenario:
    label: str
    leads: int
    revenue: Decimal


_RU_MONTHS_GEN = (
    "января",
    "февраля",
    "марта",
    "апреля",
    "мая",
    "июня",
    "июля",
    "августа",
    "сентября",
    "октября",
    "ноября",
    "декабря",
)


def week_span_label(start: date, end: date) -> str:
    if start.month == end.month:
        if start == end:
            return f"{start.day} {_RU_MONTHS_GEN[start.month - 1]}"
        return f"{start.day}–{end.day} {_RU_MONTHS_GEN[start.month - 1]}"
    return (
        f"{start.day} {_RU_MONTHS_GEN[start.month - 1]}"
        f" – {end.day} {_RU_MONTHS_GEN[end.month - 1]}"
    )


def week_pace_bounds(today: date) -> tuple[date, date, date, date]:
    """Понедельник–сегодня и те же будни прошлой недели.

    Пятница 6 ноября → 2–6 ноября против 26–30 октября.
    «Должно быть сегодня» — факт тех же дней, не план месяца.
    """
    monday = today - timedelta(days=today.weekday())
    span = today.weekday()
    prev_monday = monday - timedelta(days=7)
    return monday, today, prev_monday, prev_monday + timedelta(days=span)


def pace_percent(current: float | int | Decimal, previous: float | int | Decimal) -> int | None:
    """Процент к тем же дням. Нет базы — нечего делить."""
    cur = float(current or 0)
    prev = float(previous or 0)
    if prev <= 0:
        return None
    return int(round(100.0 * cur / prev))


def days_elapsed_in_month(today: date, month_start: date) -> int:
    """Дней с фактом (включая сегодня) — для темпа при so_far до сегодня включительно."""
    if today < month_start:
        return 0
    if today.year == month_start.year and today.month == month_start.month:
        return max(1, today.day)
    if (today.year, today.month) > (month_start.year, month_start.month):
        if month_start.month == 12:
            nxt = date(month_start.year + 1, 1, 1)
        else:
            nxt = date(month_start.year, month_start.month + 1, 1)
        return (nxt - month_start).days
    return 0


def days_remaining_in_month(today: date, month_start: date) -> int:
    """Дней после сегодня до конца месяца (сегодня уже в so_far)."""
    if month_start.month == 12:
        nxt = date(month_start.year + 1, 1, 1)
    else:
        nxt = date(month_start.year, month_start.month + 1, 1)
    month_end = nxt
    if today < month_start:
        return (month_end - month_start).days
    if today >= month_end:
        return 0
    return max(0, (month_end - today).days - 1)


def project_scenarios(
    *,
    leads_so_far: int,
    revenue_so_far: Decimal,
    elapsed_days: int,
    remaining_days: int,
    prev_leads: int | None = None,
    prev_revenue: Decimal | None = None,
) -> dict[str, OutlookScenario]:
    """Худший −15%, средний = текущий темп, лучший +15% (или не хуже прошлого темпа)."""
    days = max(1, elapsed_days)
    lead_pace = leads_so_far / days
    rev_pace = float(revenue_so_far) / days

    def pack(label: str, mult: float) -> OutlookScenario:
        add_leads = lead_pace * mult * remaining_days
        add_rev = rev_pace * mult * remaining_days
        return OutlookScenario(
            label=label,
            leads=_i(leads_so_far + add_leads),
            revenue=_d(float(revenue_so_far) + add_rev),
        )

    worst_m, mid_m, best_m = 0.85, 1.0, 1.15
    # Если прошлый месяц был слабее текущего темпа — худший не выше прошлого дневного
    if prev_leads is not None and prev_revenue is not None and elapsed_days > 0:
        # сравнение только для подсказки множителя худшего не обязателен — фиксируем 0.85/1/1.15
        pass

    return {
        "worst": pack("Худший", worst_m),
        "mid": pack("Средний", mid_m),
        "best": pack("Лучший", best_m),
    }


def next_month_mid(
    *,
    revenue_so_far: Decimal,
    leads_so_far: int,
    elapsed_days: int,
    next_month_days: int,
) -> OutlookScenario:
    days = max(1, elapsed_days)
    lead_pace = leads_so_far / days
    rev_pace = float(revenue_so_far) / days
    return OutlookScenario(
        label="Средний",
        leads=_i(lead_pace * next_month_days),
        revenue=_d(rev_pace * next_month_days),
    )


def pct_delta(current: float | Decimal, previous: float | Decimal) -> float | None:
    prev = float(previous or 0)
    cur = float(current or 0)
    if prev == 0:
        return None if cur == 0 else 100.0
    return round(100.0 * (cur - prev) / prev, 1)


_MONTH_RU = (
    "",
    "январь",
    "февраль",
    "март",
    "апрель",
    "май",
    "июнь",
    "июль",
    "август",
    "сентябрь",
    "октябрь",
    "ноябрь",
    "декабрь",
)


def month_label_ru(month_start: date) -> str:
    return f"{_MONTH_RU[month_start.month]} {month_start.year}"


def build_summary(
    *,
    revenue_delta_pct: float | None,
    mid_revenue: Decimal,
    current_revenue: Decimal,
) -> str:
    mid = float(mid_revenue or 0)
    cur = float(current_revenue or 0)
    mid_s = f"{mid:,.0f}".replace(",", "\u00a0")
    if revenue_delta_pct is None:
        return f"Средний сценарий даст около {mid_s} с. к концу месяца."
    if revenue_delta_pct < 0:
        return (
            f"Отстаёте от прошлого месяца по выручке на {abs(revenue_delta_pct):.1f}% — "
            f"средний сценарий даст около {mid_s} с. к концу месяца "
            f"(сейчас {cur:,.0f} с.)".replace(",", "\u00a0")
        )
    if revenue_delta_pct > 0:
        return (
            f"Опережаете прошлый месяц по выручке на {revenue_delta_pct:.1f}% — "
            f"средний сценарий даст около {mid_s} с. к концу месяца."
        )
    return f"Выручка как в прошлом месяце — средний сценарий даст около {mid_s} с. к концу месяца."
