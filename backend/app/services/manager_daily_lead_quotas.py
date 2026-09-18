"""Персональные квоты: Мавлуда Алибекзода — 3 новых лида в день.

Архив ей идёт как остальным (LEADS_PER_MANAGER), без отдельного лимита 3.
"""

from __future__ import annotations

import logging
import re
import unicodedata
from datetime import UTC, datetime
from zoneinfo import ZoneInfo

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.models import Lead, User, UserRole

logger = logging.getLogger(__name__)

MAVLUDA_DAILY_NEW_QUOTA = 3


def _norm_name(value: str | None) -> str:
    raw = unicodedata.normalize("NFKC", (value or "")).casefold()
    raw = raw.replace("ё", "е")
    return re.sub(r"\s+", " ", raw).strip()


def is_mavluda_alibek(full_name: str | None) -> bool:
    """Мавлуда Алибекзода / Алибекова / Alibekzoda."""
    n = _norm_name(full_name)
    if not n:
        return False
    has_mavluda = "мавлуд" in n or "mavlud" in n
    has_alibek = "алибек" in n or "alibek" in n
    return has_mavluda and has_alibek


def _booking_tz() -> ZoneInfo:
    try:
        return ZoneInfo(settings.booking_timezone or "Asia/Dushanbe")
    except Exception:
        return ZoneInfo("Asia/Dushanbe")


def local_day_start_utc(now: datetime | None = None) -> datetime:
    """Начало текущего календарного дня (Asia/Dushanbe) в UTC."""
    clock = now or datetime.now(UTC)
    if clock.tzinfo is None:
        clock = clock.replace(tzinfo=UTC)
    local = clock.astimezone(_booking_tz())
    start_local = local.replace(hour=0, minute=0, second=0, microsecond=0)
    return start_local.astimezone(UTC)


async def apply_mavluda_daily_archive_quota(db: AsyncSession) -> dict[str, int]:
    """Включает Мавлуде новые лиды и снимает старый архивный лимит 3.

    Архив — общая дневная квота. Идемпотентно на каждом старте.
    """
    managers = (
        await db.execute(
            select(User).where(
                User.role == UserRole.manager,
                User.is_active.is_(True),
            ),
        )
    ).scalars().all()

    target = next((u for u in managers if is_mavluda_alibek(u.full_name)), None)
    if target is None:
        logger.warning("mavluda_daily_quota: менеджер Мавлуда Алибек* не найдена — пропуск")
        return {"found": 0, "updated": 0}

    changed = 0
    if target.daily_archive_leads_quota is not None:
        target.daily_archive_leads_quota = None
        changed = 1
    if not bool(target.accepts_new_leads):
        target.accepts_new_leads = True
        changed = 1

    await db.flush()
    if changed:
        logger.info(
            "mavluda_daily_quota: user_id=%s name=%r archive_quota=%s accepts_new_leads=%s new_quota=%s",
            target.id,
            target.full_name,
            target.daily_archive_leads_quota,
            target.accepts_new_leads,
            MAVLUDA_DAILY_NEW_QUOTA,
        )
    return {
        "found": 1,
        "updated": changed,
        "user_id": int(target.id),
        "new_leads_quota": MAVLUDA_DAILY_NEW_QUOTA,
    }


async def count_new_leads_today(
    db: AsyncSession,
    *,
    manager_id: int,
    company_id: int,
) -> int:
    """Сколько лидов создано сегодня и назначено менеджеру (новые входящие)."""
    day_start = local_day_start_utc()
    cnt = await db.scalar(
        select(func.count(Lead.id)).where(
            Lead.company_id == company_id,
            Lead.manager_id == manager_id,
            Lead.created_at >= day_start,
        ),
    )
    return int(cnt or 0)


async def filter_managers_by_new_leads_quota(
    db: AsyncSession,
    *,
    company_id: int,
    manager_ids: list[int],
) -> list[int]:
    """Убирает менеджеров, у кого персональная дневная квота новых лидов уже исчерпана.

    Сейчас: только Мавлуда Алибек* → MAVLUDA_DAILY_NEW_QUOTA (3).
    Остальные без лимита.
    """
    if not manager_ids:
        return []

    users = (
        await db.execute(select(User).where(User.id.in_(manager_ids)))
    ).scalars().all()
    by_id = {int(u.id): u for u in users}

    out: list[int] = []
    for mid in manager_ids:
        user = by_id.get(int(mid))
        if user is None:
            continue
        if is_mavluda_alibek(user.full_name):
            already = await count_new_leads_today(
                db, manager_id=int(mid), company_id=company_id
            )
            if already >= MAVLUDA_DAILY_NEW_QUOTA:
                logger.info(
                    "mavluda_new_quota: skip user_id=%s today=%s quota=%s",
                    mid,
                    already,
                    MAVLUDA_DAILY_NEW_QUOTA,
                )
                continue
        out.append(int(mid))
    return out
