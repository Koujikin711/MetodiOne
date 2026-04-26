"""Запись событий аудита для аккаунта super_owner."""

from __future__ import annotations

import json
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from app.models import SuperOwnerAuditEvent


async def record_super_owner_audit(
    db: AsyncSession,
    *,
    actor_user_id: int,
    action: str,
    company_id: int | None = None,
    detail: dict[str, Any] | str | None = None,
) -> None:
    if isinstance(detail, dict):
        detail_s = json.dumps(detail, ensure_ascii=False)[:8000]
    else:
        detail_s = (str(detail) if detail is not None else None)[:8000]
    row = SuperOwnerAuditEvent(
        actor_user_id=actor_user_id,
        company_id=company_id,
        action=action[:160],
        detail=detail_s,
    )
    db.add(row)
    await db.flush()
