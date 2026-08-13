"""Подбор batch-перемещений лидов для точного отката accidental перераспределения."""

from __future__ import annotations

import re
from datetime import timedelta

from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Lead, LeadAuditEvent, SystemAuditEvent, User

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
                or_(
                    SystemAuditEvent.company_id == company_id,
                    SystemAuditEvent.company_id.is_(None),
                ),
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


async def _company_user_ids(db: AsyncSession, *, company_id: int) -> set[int]:
    rows = (
        await db.execute(select(User.id).where(User.company_id == company_id))
    ).scalars().all()
    return {int(x) for x in rows}


async def list_redistribution_audits(
    db: AsyncSession,
    *,
    company_id: int,
    limit: int = 40,
) -> list[SystemAuditEvent]:
    """Системные audit раздач этой компании (в т.ч. со старым company_id=NULL)."""
    company_uids = await _company_user_ids(db, company_id=company_id)
    rows = (
        await db.execute(
            select(SystemAuditEvent)
            .where(
                or_(
                    SystemAuditEvent.company_id == company_id,
                    SystemAuditEvent.company_id.is_(None),
                ),
                SystemAuditEvent.action.in_(list(REDISTRIBUTE_ACTIONS)),
            )
            .order_by(SystemAuditEvent.created_at.desc(), SystemAuditEvent.id.desc())
            .limit(max(limit * 3, 40)),
        )
    ).scalars().all()

    out: list[SystemAuditEvent] = []
    for audit in rows:
        if audit.company_id == company_id:
            out.append(audit)
            continue
        if audit.company_id is not None:
            continue
        # Старые записи без company_id — берём, если from/targets/user из этой компании.
        from_mid = parse_system_from_id(audit.details)
        if from_mid is not None and from_mid in company_uids:
            out.append(audit)
            continue
        if audit.action == "leads_redistributed_from_owners" and (
            audit.user_id is None or audit.user_id in company_uids
        ):
            out.append(audit)
            continue
        if audit.user_id is not None and audit.user_id in company_uids:
            out.append(audit)
    return out[:limit]


async def load_batch_move_events(
    db: AsyncSession,
    *,
    company_id: int,
    audit: SystemAuditEvent,
) -> list[LeadAuditEvent]:
    """События manager_reassigned этой раздачи (batch_id или окно времени)."""
    by_batch = (
        await db.execute(
            select(LeadAuditEvent)
            .join(Lead, Lead.id == LeadAuditEvent.lead_id)
            .where(
                Lead.company_id == company_id,
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
    # Старые batch писали system audit в конце — lead-события могут быть раньше.
    t0 = created - timedelta(hours=2)
    t1 = created + timedelta(minutes=30)
    events = (
        await db.execute(
            select(LeadAuditEvent)
            .join(Lead, Lead.id == LeadAuditEvent.lead_id)
            .where(
                Lead.company_id == company_id,
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
        if "undo redistribution" in details:
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
    """(lead_id, from_manager_id, to_manager_id) — только если лид ещё у получателя раздачи."""
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
        # Лид всё ещё у того, кому отдали в этой раздаче.
        if lead.manager_id != to_mid:
            continue
        restorable.append((lead_id, from_mid, to_mid))
    return restorable


async def collect_restorable_by_from_manager(
    db: AsyncSession,
    *,
    company_id: int,
    from_manager_id: int,
    since_hours: int = 72,
) -> list[tuple[int, int, int]]:
    """
    Запасной путь без system audit: лиды, которые ушли FROM manager
    последним «прямым» manager_reassigned (не undo) и всё ещё у получателя.
    """
    from datetime import datetime, timezone

    t0 = datetime.now(timezone.utc) - timedelta(hours=since_hours)
    events = (
        await db.execute(
            select(LeadAuditEvent)
            .join(Lead, Lead.id == LeadAuditEvent.lead_id)
            .where(
                Lead.company_id == company_id,
                LeadAuditEvent.action == "manager_reassigned",
                LeadAuditEvent.created_at >= t0,
                LeadAuditEvent.details.like(f"%from_manager_id={from_manager_id}%"),
            )
            .order_by(LeadAuditEvent.id.desc()),
        )
    ).scalars().all()

    latest_by_lead: dict[int, tuple[int, int]] = {}
    for ev in events:
        details = str(ev.details or "")
        if "undo redistribution" in details:
            continue
        from_mid, to_mid, _ = parse_manager_move(details)
        if from_mid != from_manager_id or to_mid is None:
            continue
        lid = int(ev.lead_id)
        if lid in latest_by_lead:
            continue
        latest_by_lead[lid] = (from_mid, to_mid)

    restorable: list[tuple[int, int, int]] = []
    for lead_id, (from_mid, to_mid) in latest_by_lead.items():
        lead = await db.get(Lead, lead_id)
        if lead is None or lead.company_id != company_id:
            continue
        if lead.manager_id != to_mid:
            continue
        restorable.append((lead_id, from_mid, to_mid))
    return restorable
