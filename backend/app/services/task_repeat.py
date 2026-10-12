"""Повтор задачи эксперта каждый день в тот же час и признак, что час уже наступил."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from zoneinfo import ZoneInfo

from sqlalchemy import select
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


def is_due(deadline: datetime, now: datetime) -> bool:
    return _local(now) >= _local(deadline)


def warn_stage(deadline: datetime, now: datetime) -> str | None:
    """30 и 15 минут до часа, затем сам час. None — предупреждать ещё рано."""
    local_now = _local(now)
    local_deadline = _local(deadline)
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
                Task.repeats_daily.is_(True),
                Task.status == TaskStatus.pending,
                Task.deadline.is_not(None),
            )
        )
    ).all()
    changed = 0
    for task in rows:
        if task.deadline is None:
            continue
        moved = roll_to_today(task.deadline, moment)
        if moved is None:
            continue
        task.deadline = moved
        changed += 1
    return changed
