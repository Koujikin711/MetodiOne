"""Персональные квоты дневной раздачи архива (Мавлуда Алибекзода → 2 лида/день)."""

from __future__ import annotations

import logging
import re
import unicodedata

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import User, UserRole

logger = logging.getLogger(__name__)

MAVLUDA_DAILY_QUOTA = 2


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


async def apply_mavluda_daily_archive_quota(db: AsyncSession) -> dict[str, int]:
    """Ставит Мавлуде daily_archive_leads_quota=2 и включает accepts_new_leads.

    Идемпотентно: можно вызывать на каждом старте.
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
    if int(target.daily_archive_leads_quota or 0) != MAVLUDA_DAILY_QUOTA:
        target.daily_archive_leads_quota = MAVLUDA_DAILY_QUOTA
        changed = 1
    if not bool(target.accepts_new_leads):
        target.accepts_new_leads = True
        changed = 1

    await db.flush()
    if changed:
        logger.info(
            "mavluda_daily_quota: user_id=%s name=%r quota=%s accepts_new_leads=%s",
            target.id,
            target.full_name,
            target.daily_archive_leads_quota,
            target.accepts_new_leads,
        )
    return {"found": 1, "updated": changed, "user_id": int(target.id)}
