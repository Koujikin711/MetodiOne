"""Блокировка менеджера от новых лидов + разовая раздача его «Новый лид» другим."""

from __future__ import annotations

import logging
import re
import unicodedata

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Lead, PipelineStage, SystemAuditEvent, User, UserRole
from app.services.lead_assignment import list_company_manager_ids

logger = logging.getLogger(__name__)

AUDIT_ACTION = "manager_blocked_from_new_leads_v2"


def _norm_name(value: str | None) -> str:
    raw = unicodedata.normalize("NFKC", (value or "")).casefold()
    raw = raw.replace("ё", "е")
    return re.sub(r"\s+", " ", raw).strip()


def _name_matches(full_name: str | None) -> bool:
    n = _norm_name(full_name)
    if not n:
        return False
    if "холиков" in n and "маниж" in n:
        return True
    return "манижа холикова" in n


async def apply_blocked_managers_new_leads_policy(db: AsyncSession) -> dict[str, int]:
    """
    Idempotent: один раз помечает Манижу Холикову accepts_new_leads=False
    и раздаёт её лиды со стадии «Новый лид» остальным менеджерам.
    """
    already = (
        await db.execute(select(SystemAuditEvent.id).where(SystemAuditEvent.action == AUDIT_ACTION).limit(1))
    ).scalar_one_or_none()
    if already is not None:
        return {"skipped": 1, "blocked": 0, "reassigned": 0}

    managers = (
        await db.execute(
            select(User).where(
                User.role == UserRole.manager,
                User.is_active.is_(True),
            )
        )
    ).scalars().all()

    targets_user = next((u for u in managers if _name_matches(u.full_name)), None)
    if targets_user is None:
        logger.warning("manager_new_leads_block: Манижа Холикова не найдена — пропуск")
        return {"skipped": 0, "blocked": 0, "reassigned": 0}

    user = targets_user
    company_id = int(user.company_id) if user.company_id is not None else None
    if company_id is None:
        return {"skipped": 0, "blocked": 0, "reassigned": 0}

    user.accepts_new_leads = False
    await db.flush()

    targets = await list_company_manager_ids(
        db,
        company_id=company_id,
        exclude_user_id=int(user.id),
    )
    if not targets:
        logger.warning(
            "manager_new_leads_block: нет других менеджеров для раздачи (user=%s)",
            user.id,
        )
        db.add(
            SystemAuditEvent(
                company_id=company_id,
                entity_type="user",
                entity_id=int(user.id),
                action=AUDIT_ACTION,
                details=f"blocked_user_id={user.id};name={user.full_name};reassigned_new_leads=0;targets=[]",
                user_id=None,
            )
        )
        await db.flush()
        return {"skipped": 0, "blocked": 1, "reassigned": 0}

    lead_ids = (
        await db.execute(
            select(Lead.id)
            .join(PipelineStage, PipelineStage.id == Lead.status_id)
            .where(
                Lead.company_id == company_id,
                Lead.manager_id == int(user.id),
                PipelineStage.name == "Новый лид",
            )
            .order_by(Lead.id.asc())
        )
    ).scalars().all()

    n = len(targets)
    reassigned = 0
    for i, lid in enumerate(int(x) for x in lead_ids):
        new_mid = targets[i % n]
        await db.execute(
            update(Lead)
            .where(Lead.id == lid, Lead.company_id == company_id)
            .values(manager_id=new_mid)
        )
        reassigned += 1

    db.add(
        SystemAuditEvent(
            company_id=company_id,
            entity_type="user",
            entity_id=int(user.id),
            action=AUDIT_ACTION,
            details=(
                f"blocked_user_id={user.id};name={user.full_name};"
                f"reassigned_new_leads={reassigned};targets={targets}"
            ),
            user_id=None,
        )
    )
    await db.flush()
    logger.info(
        "Blocked new leads for %s (#%s): reassigned %s «Новый лид» → %s",
        user.full_name,
        user.id,
        reassigned,
        targets,
    )
    return {"skipped": 0, "blocked": 1, "reassigned": reassigned}
