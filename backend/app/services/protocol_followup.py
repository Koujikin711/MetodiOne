"""Комментарий и напоминание о созвоне на строке контроля протоколов."""

from __future__ import annotations

from datetime import UTC, datetime

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Lead, SalesKpiManualSale, Task, TaskStatus, User, UserRole
from app.models.curator_journal import ProtocolFollowup
from app.services.task_repeat import as_clinic_naive
from app.services.task_team_chat import notify_manager_task_in_chat


def followup_key(row: dict) -> tuple[str, int] | None:
    lead_id = row.get("lead_id")
    if lead_id:
        return ("lead", int(lead_id))
    purchase_id = row.get("purchase_id")
    if purchase_id:
        return ("sale", int(purchase_id))
    return None


def followup_call_overdue(call_at: datetime | None, now: datetime | None = None) -> bool:
    if call_at is None:
        return False
    moment = as_clinic_naive(now or datetime.now(UTC))
    target = as_clinic_naive(call_at)
    return moment is not None and target is not None and moment >= target


async def attach_protocol_followups(db: AsyncSession, *, company_id: int, rows: list[dict]) -> None:
    keys = [key for key in (followup_key(row) for row in rows) if key is not None]
    if not keys:
        return
    sources = {source for source, _sid in keys}
    ids = {sid for _source, sid in keys}
    found = (
        await db.execute(
            select(ProtocolFollowup).where(
                ProtocolFollowup.company_id == company_id,
                ProtocolFollowup.source.in_(sources),
                ProtocolFollowup.source_id.in_(ids),
            )
        )
    ).scalars().all()
    by_key = {(note.source, int(note.source_id)): note for note in found}
    now = datetime.now(UTC)
    for row in rows:
        key = followup_key(row)
        note = by_key.get(key) if key is not None else None
        call_at = note.next_call_at if note is not None else None
        row["followup_comment"] = ((note.comment or "").strip() or None) if note is not None else None
        row["followup_call_at"] = call_at
        row["followup_overdue"] = followup_call_overdue(call_at, now)


async def save_protocol_followup(
    db: AsyncSession,
    *,
    company_id: int,
    user: User,
    lead_id: int | None,
    sale_id: int | None,
    comment: str | None,
    next_call_at: datetime | None,
) -> ProtocolFollowup:
    if lead_id is not None:
        source, source_id = "lead", int(lead_id)
        lead = await db.get(Lead, source_id)
        if lead is None or lead.company_id != company_id:
            raise ValueError("not_found")
        patient_name = (lead.name or "").strip() or "клиент"
        patient_phone = (lead.phone or "").strip()
        assignee_id = int(lead.manager_id) if lead.manager_id else None
        related_lead_id = int(lead.id)
    elif sale_id is not None:
        source, source_id = "sale", int(sale_id)
        sale = await db.get(SalesKpiManualSale, source_id)
        if sale is None or sale.company_id != company_id:
            raise ValueError("not_found")
        patient_name = (sale.client_name or "").strip() or "клиент"
        patient_phone = (sale.client_phone or "").strip()
        assignee_id = int(sale.manager_user_id) if sale.manager_user_id else None
        related_lead_id = int(sale.lead_id) if sale.lead_id is not None else None
    else:
        raise ValueError("not_found")

    note = (
        await db.execute(
            select(ProtocolFollowup).where(
                ProtocolFollowup.company_id == company_id,
                ProtocolFollowup.source == source,
                ProtocolFollowup.source_id == source_id,
            )
        )
    ).scalar_one_or_none()
    if note is None:
        note = ProtocolFollowup(company_id=company_id, source=source, source_id=source_id)
        db.add(note)
    text = (comment or "").strip()[:500] or None
    note.comment = text
    note.next_call_at = as_clinic_naive(next_call_at)
    note.updated_by_user_id = int(user.id)
    note.updated_at = datetime.now(UTC)
    await _sync_call_task(
        db,
        company_id=company_id,
        user=user,
        note=note,
        patient_name=patient_name,
        patient_phone=patient_phone,
        assignee_id=assignee_id,
        related_lead_id=related_lead_id,
    )
    await db.flush()
    return note


async def _sync_call_task(
    db: AsyncSession,
    *,
    company_id: int,
    user: User,
    note: ProtocolFollowup,
    patient_name: str,
    patient_phone: str,
    assignee_id: int | None,
    related_lead_id: int | None,
) -> None:
    existing = await db.get(Task, note.task_id) if note.task_id else None
    if note.next_call_at is None:
        if existing is not None and existing.status == TaskStatus.pending:
            existing.status = TaskStatus.cancelled
        return
    assignee = await db.get(User, assignee_id) if assignee_id else None
    if assignee is None or assignee.company_id != company_id or not assignee.is_active:
        if user.role == UserRole.manager:
            assignee = user
        else:
            return
    title = f"Созвон: {patient_name}"[:255]
    lines = [note.comment or "Созвон о следующем продукте"]
    if patient_phone:
        lines.append(f"Телефон: {patient_phone}")
    description = "\n".join(lines)
    if existing is not None and existing.status == TaskStatus.pending and existing.company_id == company_id:
        existing.title = title
        existing.deadline = note.next_call_at
        existing.description = description
        existing.assigned_to = int(assignee.id)
        existing.related_lead_id = related_lead_id
        return
    task = Task(
        company_id=company_id,
        title=title,
        deadline=note.next_call_at,
        status=TaskStatus.pending,
        assigned_to=int(assignee.id),
        created_by_user_id=int(user.id),
        description=description,
        related_lead_id=related_lead_id,
        repeats_daily=False,
    )
    db.add(task)
    await db.flush()
    note.task_id = int(task.id)
    await notify_manager_task_in_chat(
        db,
        company_id=company_id,
        creator=user,
        assignee=assignee,
        task=task,
    )
