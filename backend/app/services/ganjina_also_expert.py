"""Ганчина Замири — админ и окно эксперта на одной учётке."""

from __future__ import annotations

import logging
import re
import unicodedata

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import User, UserRole

logger = logging.getLogger(__name__)

_ADMIN_ROLES = (UserRole.admin, UserRole.administrator)


def _norm_name(value: str | None) -> str:
    raw = unicodedata.normalize("NFKC", (value or "")).casefold()
    raw = raw.replace("ё", "е")
    return re.sub(r"\s+", " ", raw).strip()


def is_ganjina_zamiri(full_name: str | None) -> bool:
    """Замири Ганчина / Ганчина Замири / Ganjina Zamiri."""
    n = _norm_name(full_name)
    if not n:
        return False
    has_ganj = "ганчин" in n or "ganchin" in n or "ganjina" in n
    has_zam = "замир" in n or "zamir" in n
    return has_ganj and has_zam


async def apply_ganjina_also_expert(db: AsyncSession) -> int:
    """Включает окно эксперта на учётке Ганчины, если она админ. Роль не меняет."""
    rows = (
        await db.scalars(select(User).where(User.is_active.is_(True), User.role.in_(_ADMIN_ROLES)))
    ).all()
    changed = 0
    for user in rows:
        if not is_ganjina_zamiri(user.full_name):
            continue
        if bool(getattr(user, "also_expert", False)):
            continue
        user.also_expert = True
        changed += 1
    if changed:
        logger.info("ganjina also_expert enabled for %s account(s)", changed)
    return changed
