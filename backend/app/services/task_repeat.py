"""Повтор задачи: каждый день или в выбранные дни недели, в тот же час."""

from __future__ import annotations

import json
from datetime import UTC, date, datetime, timedelta
from zoneinfo import ZoneInfo

from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Task, TaskStatus

_TZ = ZoneInfo("Asia/Dushanbe")


def _local(value: datetime) -> datetime:
    # Без пояса это местное время клиники: так срок приходит из формы.
    if value.tzinfo is None:
        return value.replace(tzinfo=_TZ)
    return value.astimezone(_TZ)


def as_clinic_naive(value: datetime | None) -> datetime | None:
    """Срок хранится без пояса: это местные часы клиники, SQLite пояс не держит."""
    if value is None:
        return None
    return _local(value).replace(tzinfo=None)


def roll_to_today(deadline: datetime, now: datetime) -> datetime | None:
    """Если повторный срок остался на прошлом дне — переносит его на сегодня, час тот же."""
    local = _local(deadline)
    today = _local(now)
    if local.date() >= today.date():
        return None
    return local.replace(year=today.year, month=today.month, day=today.day, tzinfo=None)


def same_hour_tomorrow(deadline: datetime) -> datetime:
    return (_local(deadline) + timedelta(days=1)).replace(tzinfo=None)


def normalize_weekdays(raw: object) -> list[int]:
    """0 = понедельник … 6 = воскресенье, как график специалистов."""
    if raw is None:
        return []
    if isinstance(raw, str):
        text = raw.strip()
        if not text:
            return []
        try:
            raw = json.loads(text)
        except json.JSONDecodeError:
            return []
    if not isinstance(raw, (list, tuple)):
        return []
    out: list[int] = []
    for item in raw:
        try:
            day = int(item)
        except (TypeError, ValueError):
            continue
        if 0 <= day <= 6 and day not in out:
            out.append(day)
    out.sort()
    return out


def _on_weekday(clock: datetime, weekdays: list[int], start: date) -> datetime | None:
    days = set(weekdays)
    local = _local(clock)
    for add in range(0, 14):
        cand = start + timedelta(days=add)
        if cand.weekday() in days:
            return local.replace(year=cand.year, month=cand.month, day=cand.day, tzinfo=None)
    return None


def align_weekday_deadline(deadline: datetime, weekdays: list[int], now: datetime) -> datetime | None:
    """Ставит срок на ближайший выбранный день. Сегодня — если сегодня один из этих дней."""
    days = normalize_weekdays(weekdays)
    if not days:
        return None
    local = _local(deadline)
    today = _local(now).date()
    if local.date() >= today and local.weekday() in days:
        return None
    moved = _on_weekday(local, days, today)
    if moved is None:
        return None
    if moved.date() == local.date() and (moved.hour, moved.minute) == (local.hour, local.minute):
        return None
    return moved


def next_weekday_after(deadline: datetime, weekdays: list[int]) -> datetime:
    """Следующий выбранный день после текущего срока, час тот же."""
    days = set(normalize_weekdays(weekdays))
    local = _local(deadline)
    for add in range(1, 8):
        cand = local + timedelta(days=add)
        if cand.weekday() in days:
            return cand.replace(tzinfo=None)
    return (local + timedelta(days=1)).replace(tzinfo=None)


def is_due(deadline: datetime, now: datetime) -> bool:
    return _local(now) >= _local(deadline)


def warn_stage(deadline: datetime, now: datetime) -> str | None:
    """30 и 15 минут до часа, затем сам час. None — предупреждать ещё рано."""
    local_now = _local(now)
    local_deadline = _local(deadline)
    # Вчерашние и более старые не держат полосу на каждой странице.
    if local_deadline.date() < local_now.date():
        return None
    if local_now >= local_deadline:
        return "due"
    left = local_deadline - local_now
    if left <= timedelta(minutes=15):
        return "15"
    if left <= timedelta(minutes=30):
        return "30"
    return None


async def roll_repeating_tasks(db: AsyncSession, company_id: int, now: datetime | None = None) -> int:
    moment = now or datetime.now(UTC)
    rows = (
        await db.scalars(
            select(Task).where(
                Task.company_id == company_id,
                Task.status == TaskStatus.pending,
                Task.deadline.is_not(None),
                or_(Task.repeats_daily.is_(True), Task.repeat_weekdays.is_not(None)),
            )
        )
    ).all()
    changed = 0
    for task in rows:
        if task.deadline is None:
            continue
        days = normalize_weekdays(getattr(task, "repeat_weekdays", None))
        if days:
            moved = align_weekday_deadline(task.deadline, days, moment)
        elif task.repeats_daily:
            moved = roll_to_today(task.deadline, moment)
        else:
            continue
        if moved is None:
            continue
        task.deadline = moved
        changed += 1
    return changed
