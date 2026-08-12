"""Подбор batch-перемещений лидов для отката accidental перераспределения."""

from __future__ import annotations

import re
from datetime import timedelta

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Lead, LeadAuditEvent, SystemAuditEvent

_RE_FROM = re.compile(r"from_manager_id=(\d+)")
_RE_TO = re.compile(r"to_manager_id=(\d+)")
_RE_BATCH = re.compile(r"batch_id=(\d+)")
_RE_SYS_FROM = re.compile(r"\bfrom=(\d+)\b")
_RE_SYS_TOTAL = re.compile(r"\btotal=(\d+)\b")
_RE_UNDONE = re.compile(r"undone_audit_id=(\d+)")

REDISTRIBUTE_ACTIONS = ("leads_redistributed", "leads_redistributed_from_owners")


def parse_manager_move(details: str | None) -> tuple[int | None, int | None, int | None]:
    if not details:
        return None, None, None
    m_from = _RE_FROM.search(details)
    m_to = _RE_TO.search(details)
    m_batch = _RE_BATCH.search(details)
    return (
        int(m_from.group(1)) if m_from else None,
        int(m_to.group(1)) if m_to else None,
        int(m_batch.group(1)) if m_batch else None,
    )


def parse_system_from_id(details: str | None) -> int | None:
    if not details:
        return None
    m = _RE_SYS_FROM.search(details)
    return int(m.group(1)) if m else None


def parse_system_total(details: str | None) -> int:
    if not details:
        return 0
    m = _RE_SYS_TOTAL.search(details)
    return int(m.group(1)) if m else 0


async def list_undone_audit_ids(db: AsyncSession, *, company_id: int) -> set[int]:
    rows = (
        await db.execute(
            select(SystemAuditEvent.details).where(
                SystemAuditEvent.company_id == company_id,
                SystemAuditEvent.action == "leads_redistribution_undone",
            ),
        )
    ).scalars().all()
    out: set[int] = set()
    for details in rows:
        if not details:
            continue
        m = _RE_UNDONE.search(str(details))
        if m:
            out.add(int(m.group(1)))
    return out


async def load_batch_move_events(
    db: AsyncSession,
    *,
    company_id: int,
    audit: SystemAuditEvent,
) -> list[LeadAuditEvent]:
    """События manager_reassigned, относящиеся к этому batch (batch_id или окно времени)."""
    by_batch = (
        await db.execute(
            select(LeadAuditEvent)
            .where(
                LeadAuditEvent.company_id == company_id,
                LeadAuditEvent.action == "manager_reassigned",
                LeadAuditEvent.details.like(f"%batch_id={audit.id}%"),
            )
            .order_by(LeadAuditEvent.id.asc()),
        )
    ).scalars().all()
    if by_batch:
        return list(by_batch)

    created = audit.created_at
    if created is None:
        return []
    t0 = created - timedelta(seconds=45)
    t1 = created + timedelta(minutes=20)
    events = (
        await db.execute(
            select(LeadAuditEvent)
            .where(
                LeadAuditEvent.company_id == company_id,
                LeadAuditEvent.action == "manager_reassigned",
                LeadAuditEvent.created_at >= t0,
                LeadAuditEvent.created_at <= t1,
            )
            .order_by(LeadAuditEvent.id.asc()),
        )
    ).scalars().all()

    expected_from = parse_system_from_id(audit.details)
    is_from_owners = audit.action == "leads_redistributed_from_owners"
    filtered: list[LeadAuditEvent] = []
    for ev in events:
        details = str(ev.details or "")
        from_mid, to_mid, batch_id = parse_manager_move(details)
        if from_mid is None or to_mid is None:
            continue
        if batch_id is not None and batch_id != audit.id:
            continue
        if is_from_owners:
            if "redistribute-from-owners" not in details:
                continue
        elif expected_from is not None and from_mid != expected_from:
            continue
        filtered.append(ev)
    return filtered


async def collect_restorable_moves(
    db: AsyncSession,
    *,
    company_id: int,
    audit: SystemAuditEvent,
) -> list[tuple[int, int, int]]:
    """(lead_id, from_manager_id, to_manager_id) — только если лид ещё у получателя."""
    events = await load_batch_move_events(db, company_id=company_id, audit=audit)
    first_by_lead: dict[int, tuple[int, int]] = {}
    for ev in events:
        from_mid, to_mid, _ = parse_manager_move(ev.details)
        if from_mid is None or to_mid is None:
            continue
        if ev.lead_id in first_by_lead:
            continue
        first_by_lead[int(ev.lead_id)] = (from_mid, to_mid)

    restorable: list[tuple[int, int, int]] = []
    for lead_id, (from_mid, to_mid) in first_by_lead.items():
        lead = await db.get(Lead, lead_id)
        if lead is None or lead.company_id != company_id:
            continue
        if lead.manager_id != to_mid:
            continue
        restorable.append((lead_id, from_mid, to_mid))
    return restorable
