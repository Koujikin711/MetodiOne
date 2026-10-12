"""Задача менеджеру и эксперту приходит во внутренний мессенджер, не в WhatsApp клиента."""

from __future__ import annotations

from datetime import UTC, datetime

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import ChatMessage, ChatThread, Lead, Task, User, UserRole
from app.services.task_repeat import _local

INTERNAL_PROVIDER = "internal"


def client_name_and_phone(task: Task, lead: Lead | None) -> tuple[str | None, str | None]:
    """Имя и номер клиента: из карточки лида, иначе из текста задачи."""
    name = ((lead.name if lead is not None else "") or "").strip() or None
    phone = ((lead.phone if lead is not None else "") or "").strip() or None
    description = task.description or ""
    if phone is None:
        for line in description.splitlines():
            lowered = line.strip().lower()
            if lowered.startswith("телефон:"):
                raw = line.split(":", 1)[1].strip()
                if raw and raw != "—":
                    phone = raw
                    break
    if name is None:
        prefix = "Связаться с клиентом:"
        title = (task.title or "").strip()
        if title.startswith(prefix):
            rest = title[len(prefix) :].strip()
            if rest:
                name = rest
    return name, phone


def manager_task_chat_text(
    *,
    title: str,
    deadline: datetime | None,
    client_name: str | None = None,
    client_phone: str | None = None,
    returned: bool = False,
) -> str:
    head = "Задачу вернули" if returned else "Новая задача"
    lines = [f"{head}: {title.strip()}"]
    name = (client_name or "").strip()
    phone = (client_phone or "").strip()
    if name:
        lines.append(f"Клиент: {name}")
    if phone:
        lines.append(f"Номер: {phone}")
    if deadline is not None:
        local = _local(deadline)
        lines.append(f"Срок: {local.strftime('%d.%m.%Y %H:%M')}")
    lines.append("Откройте задачи и отметьте, что сделали.")
    return "\n".join(lines)


def _dm_external_id(user_a: int, user_b: int) -> str:
    a, b = sorted((user_a, user_b))
    return f"internal:dm:{a}:{b}"


async def notify_manager_task_in_chat(
    db: AsyncSession,
    *,
    company_id: int,
    creator: User | None,
    assignee: User | None,
    task: Task,
    returned: bool = False,
) -> None:
    if assignee is None or assignee.role not in (UserRole.manager, UserRole.expert):
        return
    if creator is None:
        creator = (
            await db.execute(
                select(User)
                .where(
                    User.company_id == company_id,
                    User.role == UserRole.owner,
                    User.is_active.is_(True),
                )
                .order_by(User.id.asc())
                .limit(1)
            )
        ).scalar_one_or_none()
    if creator is None or creator.id == assignee.id:
        return
    client_name = None
    client_phone = None
    lead = None
    if task.related_lead_id is not None:
        lead = await db.get(Lead, task.related_lead_id)
        if lead is not None and lead.company_id != company_id:
            lead = None
    client_name, client_phone = client_name_and_phone(task, lead)
    text = manager_task_chat_text(
        title=task.title,
        deadline=task.deadline,
        client_name=client_name,
        client_phone=client_phone,
        returned=returned,
    )
    key = _dm_external_id(creator.id, assignee.id)
    thread = (
        await db.execute(
            select(ChatThread).where(
                ChatThread.company_id == company_id,
                ChatThread.provider == INTERNAL_PROVIDER,
                ChatThread.external_chat_id == key,
            )
        )
    ).scalars().first()
    now = datetime.now(UTC)
    if thread is None:
        peer_name = (assignee.full_name or "").strip() or assignee.email
        thread = ChatThread(
            company_id=company_id,
            lead_id=None,
            pipeline_id=None,
            provider=INTERNAL_PROVIDER,
            external_chat_id=key,
            title=peer_name,
            updated_at=now,
        )
        db.add(thread)
        await db.flush()
    thread.updated_at = now
    db.add(
        ChatMessage(
            company_id=company_id,
            thread_id=thread.id,
            author_user_id=creator.id,
            direction="out",
            text=text,
            message_type="text",
            delivery_status="sent",
            created_at=now,
        )
    )
    await db.flush()
