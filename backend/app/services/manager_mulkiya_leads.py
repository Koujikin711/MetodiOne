"""Хайдарзода Мулкия — должна получать новые лиды наравне с другими менеджерами."""

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


def is_mulkiya_haidarzoda(full_name: str | None) -> bool:
    """Хайдарзода Мулкия / Mulkiya Haidarzoda / Хайдарзода М. и т.п."""
    n = _norm_name(full_name)
    if not n:
        return False
    has_mulkiya = "мулки" in n or "mulkiy" in n or "mulkia" in n
    has_haidar = "хайдар" in n or "haidar" in n or "haydar" in n
    # ФИО в аналитике: «Хайдарзода Мулкия»
    if has_mulkiya and has_haidar:
        return True
    # Иногда только «Мулкия» как единственное слово-имя среди менеджеров
    if n in {"мулкия", "mulkiya", "mulkia"}:
        return True
    return False


async def apply_mulkiya_receives_new_leads(db: AsyncSession) -> dict[str, int | str]:
    """Включает accepts_new_leads, назначает на воронки компании, снимает с intake.

    Идемпотентно на каждом старте. Без этого Мулкия может висеть в Analytics с 0 лидов,
    пока остальные менеджеры получают WhatsApp/запись через round-robin.
    """
    managers = (
        await db.execute(
            select(User).where(
                User.role == UserRole.manager,
                User.is_active.is_(True),
            ),
        )
    ).scalars().all()

    target = next((u for u in managers if is_mulkiya_haidarzoda(u.full_name)), None)
    if target is None:
        # Иногда роль admin — тогда в RR её нет, но в Analytics она видна с 0.
        admins = (
            await db.execute(
                select(User).where(
                    User.role == UserRole.admin,
                    User.is_active.is_(True),
                ),
            )
        ).scalars().all()
        admin_hit = next((u for u in admins if is_mulkiya_haidarzoda(u.full_name)), None)
        if admin_hit is not None:
            admin_hit.role = UserRole.manager
            target = admin_hit
            logger.info(
                "mulkiya_leads: user_id=%s был admin → manager (%r)",
                admin_hit.id,
                admin_hit.full_name,
            )
        else:
            logger.warning("mulkiya_leads: менеджер Хайдарзода Мулкия не найдена — пропуск")
            return {"found": 0, "updated": 0}

    company_id = int(target.company_id) if target.company_id is not None else None
    if company_id is None:
        return {"found": 1, "updated": 0, "reason": "no_company"}

    changed = 0
    if not bool(target.accepts_new_leads):
        target.accepts_new_leads = True
        changed += 1

    # Снять с intake — иначе lead_assignment исключает её из round-robin.
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
        logger.info(
            "mulkiya_leads: снята с intake pipeline_id=%s (%r)",
            pipe.id,
            pipe.name,
        )

    existing = {
        int(r)
        for r in (
            await db.execute(
                select(UserPipelineAssignment.pipeline_id).where(
                    UserPipelineAssignment.user_id == int(target.id),
                    UserPipelineAssignment.company_id == company_id,
                ),
            )
        ).scalars().all()
    }

    # Воронки, куда уже назначены другие менеджеры компании (те же, что получают лиды).
    peer_pipe_ids = {
        int(r)
        for r in (
            await db.execute(
                select(UserPipelineAssignment.pipeline_id)
                .join(User, User.id == UserPipelineAssignment.user_id)
                .where(
                    UserPipelineAssignment.company_id == company_id,
                    User.role == UserRole.manager,
                    User.is_active.is_(True),
                    User.accepts_new_leads.is_(True),
                    User.id != int(target.id),
                ),
            )
        ).scalars().all()
    }
    if not peer_pipe_ids:
        peer_pipe_ids = {
            int(r)
            for r in (
                await db.execute(select(Pipeline.id).where(Pipeline.company_id == company_id))
            ).scalars().all()
        }

    added_assignments = 0
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
        added_assignments += 1
        changed += 1

    await db.flush()
    if changed:
        logger.info(
            "mulkiya_leads: user_id=%s name=%r accepts_new_leads=%s added_pipelines=%s",
            target.id,
            target.full_name,
            target.accepts_new_leads,
            added_assignments,
        )
    return {
        "found": 1,
        "updated": changed,
        "user_id": int(target.id),
        "added_pipelines": added_assignments,
    }
