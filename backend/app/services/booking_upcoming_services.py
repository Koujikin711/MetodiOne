"""Будущая загрузка по услугам (Online Booking Phase 6).

Периоды и статусы считаются одинаково для summary и drill-down.
Timezone: settings.booking_timezone (календарные сутки клиники).
"""

from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass
from datetime import UTC, date, datetime, time, timedelta
from decimal import Decimal
from typing import Iterable, Literal
from zoneinfo import ZoneInfo

from app.config import settings

PeriodKey = Literal["today", "tomorrow", "next_7_days", "next_30_days"]

# Future load: cancelled не входит в counts.
LOAD_STATUSES = frozenset({"booked", "completed", "no_show"})


def booking_tz() -> ZoneInfo:
    return ZoneInfo(settings.booking_timezone or "Asia/Dushanbe")


def local_today(*, now: datetime | None = None) -> date:
    n = now or datetime.now(UTC)
    if n.tzinfo is None:
        n = n.replace(tzinfo=UTC)
    return n.astimezone(booking_tz()).date()


def day_bounds_utc(day: date) -> tuple[datetime, datetime]:
    tz = booking_tz()
    local_start = datetime.combine(day, time.min, tzinfo=tz)
    local_end = local_start + timedelta(days=1)
    return local_start.astimezone(UTC), local_end.astimezone(UTC)


def calendar_week_span(d0: date) -> tuple[date, date]:
    """Календарная неделя пн–вс, содержащая d0."""
    monday = d0 - timedelta(days=d0.weekday())
    sunday = monday + timedelta(days=6)
    return monday, sunday


def calendar_month_span(d0: date) -> tuple[date, date]:
    """Календарный месяц: 1-е … последний день месяца d0."""
    start = d0.replace(day=1)
    if start.month == 12:
        end = date(start.year + 1, 1, 1) - timedelta(days=1)
    else:
        end = date(start.year, start.month + 1, 1) - timedelta(days=1)
    return start, end


def period_bounds_utc(
    period: PeriodKey,
    *,
    today: date | None = None,
) -> tuple[datetime, datetime]:
    """Inclusive calendar start, exclusive end — в UTC."""
    d0 = today or local_today()
    if period == "today":
        return day_bounds_utc(d0)
    if period == "tomorrow":
        return day_bounds_utc(d0 + timedelta(days=1))
    if period == "next_7_days":
        # Календарная неделя (пн–вс)
        w0, w1 = calendar_week_span(d0)
        start, _ = day_bounds_utc(w0)
        _, end = day_bounds_utc(w1)
        return start, end
    if period == "next_30_days":
        # Календарный месяц (1 … конец месяца)
        m0, m1 = calendar_month_span(d0)
        start, _ = day_bounds_utc(m0)
        _, end = day_bounds_utc(m1)
        return start, end
    raise ValueError(f"Unknown period: {period}")


def period_ymd_span(period: PeriodKey, *, today: date | None = None) -> tuple[str, str]:
    """Даты периода для UI (включительно)."""
    d0 = today or local_today()
    if period == "today":
        return d0.isoformat(), d0.isoformat()
    if period == "tomorrow":
        t = d0 + timedelta(days=1)
        return t.isoformat(), t.isoformat()
    if period == "next_7_days":
        a, b = calendar_week_span(d0)
        return a.isoformat(), b.isoformat()
    if period == "next_30_days":
        a, b = calendar_month_span(d0)
        return a.isoformat(), b.isoformat()
    raise ValueError(f"Unknown period: {period}")


def report_window_utc(*, today: date | None = None) -> tuple[datetime, datetime]:
    """Горизонт загрузки: объединение недели и месяца (плюс today/tomorrow внутри)."""
    d0 = today or local_today()
    w0, w1 = calendar_week_span(d0)
    m0, m1 = calendar_month_span(d0)
    start_d = min(w0, m0, d0)
    end_d = max(w1, m1, d0 + timedelta(days=1))
    start, _ = day_bounds_utc(start_d)
    _, end = day_bounds_utc(end_d)
    return start, end


def ymd_in_booking_tz(dt: datetime) -> str:
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=UTC)
    return dt.astimezone(booking_tz()).date().isoformat()


def counts_as_load(status: str | None) -> bool:
    return (status or "").strip() in LOAD_STATUSES


@dataclass(frozen=True)
class ApptLite:
    id: int
    direction_id: int
    lead_id: int | None
    start_at: datetime
    status: str


def _in_range(start_at: datetime, start: datetime, end: datetime) -> bool:
    if start_at.tzinfo is None:
        start_at = start_at.replace(tzinfo=UTC)
    return start <= start_at.astimezone(UTC) < end


def filter_period(
    appts: Iterable[ApptLite],
    period: PeriodKey,
    *,
    today: date | None = None,
) -> list[ApptLite]:
    start, end = period_bounds_utc(period, today=today)
    return [a for a in appts if counts_as_load(a.status) and _in_range(a.start_at, start, end)]


def unique_patient_count(appts: Iterable[ApptLite]) -> int:
    """Только Lead.id; без lead_id — не мержим по телефону."""
    ids = {int(a.lead_id) for a in appts if a.lead_id is not None}
    return len(ids)


def period_appointment_count(appts: Iterable[ApptLite], period: PeriodKey, *, today: date | None = None) -> int:
    return len(filter_period(appts, period, today=today))


def period_unique_count(appts: Iterable[ApptLite], period: PeriodKey, *, today: date | None = None) -> int:
    return unique_patient_count(filter_period(appts, period, today=today))


def today_status_breakdown(appts: Iterable[ApptLite], *, today: date | None = None) -> dict[str, int]:
    """Разбивка сегодня: все (load) + по статусам включая cancelled на сегодня."""
    start, end = period_bounds_utc("today", today=today)
    today_rows = [a for a in appts if _in_range(a.start_at, start, end)]
    out = {
        "total_load": 0,
        "booked": 0,
        "completed": 0,
        "no_show": 0,
        "cancelled": 0,
    }
    for a in today_rows:
        st = (a.status or "").strip()
        if st in out:
            out[st] += 1
        if counts_as_load(st):
            out["total_load"] += 1
    return out


def aggregate_by_direction(
    appts: Iterable[ApptLite],
    direction_ids: list[int],
    *,
    today: date | None = None,
) -> dict[int, dict[str, int]]:
    """direction_id → counts for appointments/unique per period."""
    rows = [a for a in appts if counts_as_load(a.status)]
    by_dir: dict[int, list[ApptLite]] = defaultdict(list)
    for a in rows:
        by_dir[int(a.direction_id)].append(a)

    result: dict[int, dict[str, int]] = {}
    for did in direction_ids:
        bucket = by_dir.get(int(did), [])
        result[int(did)] = {
            "today_appointments": period_appointment_count(bucket, "today", today=today),
            "today_unique_patients": period_unique_count(bucket, "today", today=today),
            "tomorrow_appointments": period_appointment_count(bucket, "tomorrow", today=today),
            "tomorrow_unique_patients": period_unique_count(bucket, "tomorrow", today=today),
            "next_7_days_appointments": period_appointment_count(bucket, "next_7_days", today=today),
            "next_7_days_unique_patients": period_unique_count(bucket, "next_7_days", today=today),
            "next_30_days_appointments": period_appointment_count(bucket, "next_30_days", today=today),
            "next_30_days_unique_patients": period_unique_count(bucket, "next_30_days", today=today),
        }
    return result


def daily_breakdown(
    appts: Iterable[ApptLite],
    period: PeriodKey,
    *,
    today: date | None = None,
) -> list[tuple[str, int]]:
    """Список (YYYY-MM-DD, count) для дней периода (только load statuses)."""
    d0 = today or local_today()
    if period == "today":
        days = [d0]
    elif period == "tomorrow":
        days = [d0 + timedelta(days=1)]
    elif period == "next_7_days":
        w0, w1 = calendar_week_span(d0)
        days = [w0 + timedelta(days=i) for i in range((w1 - w0).days + 1)]
    else:
        m0, m1 = calendar_month_span(d0)
        days = [m0 + timedelta(days=i) for i in range((m1 - m0).days + 1)]

    filtered = filter_period(appts, period, today=today)
    counts: dict[str, int] = {d.isoformat(): 0 for d in days}
    for a in filtered:
        ymd = ymd_in_booking_tz(a.start_at)
        if ymd in counts:
            counts[ymd] += 1
    return [(d.isoformat(), counts[d.isoformat()]) for d in days]


def money_remainder(service_amount: Decimal | float | None, paid_amount: Decimal | float | None) -> Decimal:
    sa = Decimal(str(service_amount or 0))
    pa = Decimal(str(paid_amount or 0))
    return max(sa - pa, Decimal("0"))
