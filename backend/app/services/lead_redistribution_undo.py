"""Быстрый подбор batch-перемещений для точного отката перераспределения."""

from __future__ import annotations

import re
from datetime import UTC, datetime, timedelta

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
            select(SystemAuditEvent.details)
            .where(
                SystemAuditEvent.company_id == company_id,
                SystemAuditEvent.action == "leads_redistribution_undone",
            )
            .order_by(SystemAuditEvent.id.desc())
            .limit(100),
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


async def list_redistribution_audits(
    db: AsyncSession,
    *,
    company_id: int,
    limit: int = 12,
) -> list[SystemAuditEvent]:
    """Только audit текущей компании — без тяжёлого скана NULL company_id по всей БД."""
    rows = (
        await db.execute(
            select(SystemAuditEvent)
            .where(
                SystemAuditEvent.company_id == company_id,
                SystemAuditEvent.action.in_(list(REDISTRIBUTE_ACTIONS)),
            )
            .order_by(SystemAuditEvent.created_at.desc(), SystemAuditEvent.id.desc())
            .limit(limit),
        )
    ).scalars().all()
    return list(rows)


async def _lead_manager_map(db: AsyncSession, lead_ids: list[int]) -> dict[int, int | None]:
    if not lead_ids:
        return {}
    out: dict[int, int | None] = {}
    # чанками, чтобы не раздувать IN()
    chunk = 2000
    for i in range(0, len(lead_ids), chunk):
        part = lead_ids[i : i + chunk]
        rows = (
            await db.execute(select(Lead.id, Lead.manager_id).where(Lead.id.in_(part)))
        ).all()
        for lid, mid in rows:
            out[int(lid)] = int(mid) if mid is not None else None
    return out


def _moves_still_at_target(
    first_by_lead: dict[int, tuple[int, int]],
    lead_managers: dict[int, int | None],
) -> list[tuple[int, int, int]]:
    restorable: list[tuple[int, int, int]] = []
    for lead_id, (from_mid, to_mid) in first_by_lead.items():
        if lead_managers.get(lead_id) == to_mid:
            restorable.append((lead_id, from_mid, to_mid))
    return restorable


async def load_batch_move_events(
    db: AsyncSession,
    *,
    company_id: int,
    audit: SystemAuditEvent,
) -> list[LeadAuditEvent]:
    """События manager_reassigned этой раздачи (batch_id или узкое окно + from_manager)."""
    by_batch = (
        await db.execute(
            select(LeadAuditEvent)
            .join(Lead, Lead.id == LeadAuditEvent.lead_id)
            .where(
                Lead.company_id == company_id,
                LeadAuditEvent.action == "manager_reassigned",
                LeadAuditEvent.details.like(f"%batch_id={audit.id}%"),
            )
            .order_by(LeadAuditEvent.id.asc())
            .limit(20000),
        )
    ).scalars().all()
    if by_batch:
        return list(by_batch)

    created = audit.created_at
    if created is None:
        return []
    expected_from = parse_system_from_id(audit.details)
    is_from_owners = audit.action == "leads_redistributed_from_owners"
    # Узкое окно: старые batch писали system audit в конце.
    t0 = created - timedelta(minutes=30)
    t1 = created + timedelta(minutes=5)

    filters = [
        Lead.company_id == company_id,
        LeadAuditEvent.action == "manager_reassigned",
        LeadAuditEvent.created_at >= t0,
        LeadAuditEvent.created_at <= t1,
    ]
    if is_from_owners:
        filters.append(LeadAuditEvent.details.like("%redistribute-from-owners%"))
    elif expected_from is not None:
        filters.append(LeadAuditEvent.details.like(f"%from_manager_id={expected_from}%"))

    events = (
        await db.execute(
            select(LeadAuditEvent)
            .join(Lead, Lead.id == LeadAuditEvent.lead_id)
            .where(*filters)
            .order_by(LeadAuditEvent.id.asc())
            .limit(20000),
        )
    ).scalars().all()

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
    events = await load_batch_move_events(db, company_id=company_id, audit=audit)
    first_by_lead: dict[int, tuple[int, int]] = {}
    for ev in events:
        from_mid, to_mid, _ = parse_manager_move(ev.details)
        if from_mid is None or to_mid is None:
            continue
        lid = int(ev.lead_id)
        if lid in first_by_lead:
            continue
        first_by_lead[lid] = (from_mid, to_mid)

    lead_managers = await _lead_manager_map(db, list(first_by_lead.keys()))
    return _moves_still_at_target(first_by_lead, lead_managers)


async def collect_restorable_by_from_manager(
    db: AsyncSession,
    *,
    company_id: int,
    from_manager_id: int,
    since_hours: int = 48,
) -> list[tuple[int, int, int]]:
    t0 = datetime.now(UTC) - timedelta(hours=since_hours)
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
            .order_by(LeadAuditEvent.id.desc())
            .limit(15000),
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

    lead_managers = await _lead_manager_map(db, list(latest_by_lead.keys()))
    return _moves_still_at_target(latest_by_lead, lead_managers)


async def list_fallback_restorable_by_managers(
    db: AsyncSession,
    *,
    company_id: int,
    since_hours: int = 48,
    limit_managers: int = 8,
) -> list[tuple[int, str, list[tuple[int, int, int]]]]:
    """
    Один проход по аудиту вместо N запросов на каждого менеджера.
    Возвращает [(from_manager_id, name, moves), ...].
    """
    t0 = datetime.now(UTC) - timedelta(hours=since_hours)
    rows = (
        await db.execute(
            select(LeadAuditEvent.lead_id, LeadAuditEvent.details, Lead.manager_id)
            .join(Lead, Lead.id == LeadAuditEvent.lead_id)
            .where(
                Lead.company_id == company_id,
                LeadAuditEvent.action == "manager_reassigned",
                LeadAuditEvent.created_at >= t0,
                LeadAuditEvent.details.like("%from_manager_id=%"),
            )
            .order_by(LeadAuditEvent.id.desc())
            .limit(8000),
        )
    ).all()

    # lead_id -> (from_mid, to_mid) — самый свежий не-undo move
    latest: dict[int, tuple[int, int]] = {}
    for lead_id, details, _current_mid in rows:
        text = str(details or "")
        if "undo redistribution" in text:
            continue
        from_mid, to_mid, _ = parse_manager_move(text)
        if from_mid is None or to_mid is None:
            continue
        lid = int(lead_id)
        if lid in latest:
            continue
        latest[lid] = (from_mid, to_mid)

    # current managers already in rows — rebuild map
    current: dict[int, int | None] = {}
    for lead_id, _details, current_mid in rows:
        lid = int(lead_id)
        if lid not in current:
            current[lid] = int(current_mid) if current_mid is not None else None

    by_from: dict[int, list[tuple[int, int, int]]] = {}
    for lead_id, (from_mid, to_mid) in latest.items():
        if current.get(lead_id) != to_mid:
            continue
        by_from.setdefault(from_mid, []).append((lead_id, from_mid, to_mid))

    if not by_from:
        return []

    users = (
        await db.execute(
            select(User.id, User.full_name, User.email).where(
                User.company_id == company_id,
                User.id.in_(list(by_from.keys())),
            ),
        )
    ).all()
    name_by_id = {
        int(uid): (str(full or "").strip() or str(email or "").strip() or f"#{uid}")
        for uid, full, email in users
    }

    items = [
        (mid, name_by_id.get(mid, f"#{mid}"), moves)
        for mid, moves in by_from.items()
        if moves
    ]
    items.sort(key=lambda x: (-len(x[2]), x[1].lower()))
    return items[:limit_managers]
