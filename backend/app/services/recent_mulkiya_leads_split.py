"""Разовая раздача: лиды вчера–сегодня у Хайдарзода Мулкии → менеджерам поровну."""

from __future__ import annotations

import logging

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import (
    Company,
    Lead,
    LeadAuditEvent,
    SystemAuditEvent,
    Task,
    TaskStatus,
    User,
    UserRole,
)
from app.services.lead_assignment import list_company_manager_ids
from app.services.manager_mulkiya_leads import is_mulkiya_haidarzoda
from app.services.recent_admin_leads_split import _since_utc

logger = logging.getLogger(__name__)

AUDIT_ACTION = "recent_mulkiya_leads_equal_split_v1"


async def apply_recent_mulkiya_leads_equal_split(db: AsyncSession) -> dict[str, int]:
    """Идемпотентно: свежие лиды на Мулкии раздать всем менеджерам по кругу (она тоже в пуле)."""
    already = (
        await db.execute(select(SystemAuditEvent.id).where(SystemAuditEvent.action == AUDIT_ACTION).limit(1))
    ).scalar_one_or_none()
    if already is not None:
        return {"skipped": 1, "reassigned": 0, "companies": 0}

    since = _since_utc()
    companies = (await db.execute(select(Company.id))).scalars().all()
    total_moved = 0
    companies_touched = 0
    mulkiya_found = 0

    for company_id_raw in companies:
        company_id = int(company_id_raw)
        managers = (
            await db.execute(
                select(User).where(
                    User.company_id == company_id,
                    User.role == UserRole.manager,
                    User.is_active.is_(True),
                ),
            )
        ).scalars().all()
        mulkiya = next((u for u in managers if is_mulkiya_haidarzoda(u.full_name)), None)
        if mulkiya is None:
            continue
        mulkiya_found = 1
        from_id = int(mulkiya.id)

        targets = await list_company_manager_ids(db, company_id=company_id)
        if not targets:
            continue

        lead_ids = (
            await db.execute(
                select(Lead.id)
                .where(
                    Lead.company_id == company_id,
                    Lead.manager_id == from_id,
                    Lead.created_at >= since,
                )
                .order_by(Lead.id.asc()),
            )
        ).scalars().all()
        if not lead_ids:
            continue

        n = len(targets)
        moved_here = 0
        for i, lid in enumerate(int(x) for x in lead_ids):
            lead = await db.get(Lead, lid)
            if lead is None or lead.manager_id is None:
                continue
            old_mid = int(lead.manager_id)
            new_mid = targets[i % n]
            if old_mid == new_mid:
                continue
            lead.manager_id = new_mid
            db.add(
                LeadAuditEvent(
                    company_id=company_id,
                    lead_id=lid,
                    action="manager_reassigned",
                    details=(
                        f"from_manager_id={old_mid}, to_manager_id={new_mid} "
                        f"({AUDIT_ACTION})"
                    ),
                    user_id=None,
                ),
            )
            await db.execute(
                update(Task)
                .where(
                    Task.company_id == company_id,
                    Task.related_lead_id == lid,
                    Task.assigned_to == old_mid,
                    Task.status.in_([TaskStatus.pending, TaskStatus.in_progress]),
                )
                .values(assigned_to=new_mid),
            )
            moved_here += 1

        if moved_here:
            companies_touched += 1
            total_moved += moved_here
            logger.info(
                "recent_mulkiya_leads_split: company=%s moved=%s since=%s from=%s → %s",
                company_id,
                moved_here,
                since.isoformat(),
                from_id,
                targets,
            )

    db.add(
        SystemAuditEvent(
            company_id=None,
            entity_type="lead",
            entity_id=0,
            action=AUDIT_ACTION,
            details=(
                f"reassigned={total_moved};companies={companies_touched};"
                f"mulkiya_found={mulkiya_found};since={since.isoformat()}"
            ),
            user_id=None,
        ),
    )
    await db.flush()
    return {
        "skipped": 0,
        "reassigned": total_moved,
        "companies": companies_touched,
        "mulkiya_found": mulkiya_found,
    }
