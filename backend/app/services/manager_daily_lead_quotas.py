"""Новые лиды идут всем менеджерам поровну, включая Мавлуду Алибекзода.

Отдельного потолка «3 в день» больше нет. Архив — общая дневная квота.
"""

from __future__ import annotations

import logging
import re
import unicodedata

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Pipeline, User, UserPipelineAssignment, UserRole

logger = logging.getLogger(__name__)


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
    """Мавлуда в общей очереди новых лидов, без личного потолка.

    Включает автораздачу, ставит её на те же воронки, что и остальных,
    и снимает с приёмки, если из-за неё очередь её пропускала.
    Архивный лимит не задаёт. Идемпотентно на каждом старте.
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
        changed += 1
    if not target.accepts_new_leads:
        target.accepts_new_leads = True
        changed += 1

    company_id = int(target.company_id) if target.company_id is not None else None
    added_pipelines = 0
    if company_id is not None:
        intake_pipes = (
            await db.execute(
                select(Pipeline).where(
                    Pipeline.company_id == company_id,
                    Pipeline.intake_manager_user_id == int(target.id),
                ),
            )
        ).scalars().all()
        for pipe in intake_pipes:
            pipe.intake_manager_user_id = None
            changed += 1
        existing = {
            int(row)
            for row in (
                await db.execute(
                    select(UserPipelineAssignment.pipeline_id).where(
                        UserPipelineAssignment.user_id == int(target.id),
                        UserPipelineAssignment.company_id == company_id,
                    ),
                )
            ).scalars().all()
        }
        peer_pipe_ids = {
            int(row)
            for row in (
                await db.execute(
                    select(UserPipelineAssignment.pipeline_id)
                    .join(User, User.id == UserPipelineAssignment.user_id)
                    .where(
                        UserPipelineAssignment.company_id == company_id,
                        User.role == UserRole.manager,
                        User.is_active.is_(True),
                        User.id != int(target.id),
                    ),
                )
            ).scalars().all()
        }
        if not peer_pipe_ids:
            peer_pipe_ids = {
                int(row)
                for row in (
                    await db.execute(select(Pipeline.id).where(Pipeline.company_id == company_id))
                ).scalars().all()
            }
        for pid in sorted(peer_pipe_ids):
            if pid in existing:
                continue
            db.add(
                UserPipelineAssignment(
                    company_id=company_id,
                    user_id=int(target.id),
                    pipeline_id=pid,
                )
            )
            added_pipelines += 1
            changed += 1

    await db.flush()
    if changed:
        logger.info(
            "mavluda_daily_quota: user_id=%s name=%r accepts_new_leads=%s added_pipelines=%s",
            target.id,
            target.full_name,
            target.accepts_new_leads,
            added_pipelines,
        )
    return {
        "found": 1,
        "updated": changed,
        "user_id": int(target.id),
        "added_pipelines": added_pipelines,
    }


async def filter_managers_by_new_leads_quota(
    db: AsyncSession,
    *,
    company_id: int,
    manager_ids: list[int],
) -> list[int]:
    """Все переданные менеджеры остаются в очереди. Личного потолка нет."""
    del company_id
    if not manager_ids:
        return []

    users = (
        await db.execute(select(User).where(User.id.in_(manager_ids)))
    ).scalars().all()
    known = {int(u.id) for u in users}
    return [int(mid) for mid in manager_ids if int(mid) in known]
