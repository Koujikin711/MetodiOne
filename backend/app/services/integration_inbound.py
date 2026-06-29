"""Создание лидов, тредов и входящих сообщений из интеграций (webhook, backfill)."""

from __future__ import annotations

import re
from datetime import UTC, datetime

from sqlalchemy import and_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import ChatMessage, ChatThread, Integration, Lead, LeadSource, Pipeline, PipelineStage
from app.services.lead_assignment import assign_manager_for_new_lead


def norm_phone(raw: str | None) -> str | None:
    if not raw:
        return None
    digits = re.sub(r"\D+", "", raw)
    return digits or None


async def ensure_source_exists(db: AsyncSession, company_id: int, name: str) -> None:
    existing = await db.scalar(select(LeadSource.id).where(LeadSource.company_id == company_id, LeadSource.name == name))
    if existing is None:
        db.add(LeadSource(name=name, is_active=True, company_id=company_id))
        await db.flush()


async def find_existing_lead(
    db: AsyncSession,
    *,
    company_id: int,
    phone: str | None,
    source_name: str,
    pipeline_id: int,
    external_chat_id: str | None = None,
    thread_provider: str | None = None,
) -> Lead | None:
    if phone:
        res = await db.execute(
            select(Lead)
            .join(PipelineStage, PipelineStage.id == Lead.status_id)
            .where(
                and_(
                    Lead.phone == phone,
                    Lead.company_id == company_id,
                    Lead.source == source_name,
                    PipelineStage.pipeline_id == pipeline_id,
                )
            )
            .order_by(Lead.id.desc())
            .limit(1),
        )
        found = res.scalars().first()
        if found is not None:
            return found
    if external_chat_id and thread_provider:
        res = await db.execute(
            select(Lead)
            .join(ChatThread, ChatThread.lead_id == Lead.id)
            .join(PipelineStage, PipelineStage.id == Lead.status_id)
            .where(
                and_(
                    Lead.source == source_name,
                    Lead.company_id == company_id,
                    PipelineStage.pipeline_id == pipeline_id,
                    ChatThread.provider == thread_provider,
                    ChatThread.external_chat_id == external_chat_id,
                ),
            )
            .order_by(Lead.id.desc())
            .limit(1),
        )
        found = res.scalars().first()
        if found is not None:
            return found
    return None


async def create_lead_from_integration(
    db: AsyncSession,
    *,
    integ: Integration,
    company_id: int,
    name: str,
    phone: str | None,
    email: str | None,
    source_name: str,
    external_chat_id: str | None = None,
    thread_provider: str | None = None,
    assign_manager: bool = True,
) -> tuple[Lead, bool]:
    """Возвращает (lead, created)."""
    await ensure_source_exists(db, company_id, source_name)
    norm = norm_phone(phone)
    existing = await find_existing_lead(
        db,
        company_id=company_id,
        phone=norm,
        source_name=source_name,
        pipeline_id=integ.pipeline_id,
        external_chat_id=(external_chat_id or "").strip() or None,
        thread_provider=thread_provider,
    )
    if existing is not None:
        existing.status_id = integ.stage_id
        if not existing.name and name.strip():
            existing.name = name.strip()
        if not existing.email and (email or "").strip():
            existing.email = (email or "").strip()
        await db.flush()
        await db.refresh(existing, ["stage"])
        return existing, False

    lead = Lead(
        company_id=company_id,
        name=name.strip() or "Лид",
        phone=norm,
        email=(email or "").strip() or None,
        source=source_name,
        status_id=integ.stage_id,
        manager_id=None,
    )
    db.add(lead)
    await db.flush()
    await db.refresh(lead, ["stage"])
    if assign_manager:
        pipe = await db.get(Pipeline, int(integ.pipeline_id))
        exclude_id = int(pipe.intake_manager_user_id) if pipe and pipe.intake_manager_user_id is not None else None
        mid = await assign_manager_for_new_lead(db, pipeline_id=integ.pipeline_id, exclude_user_id=exclude_id)
        if mid is not None:
            lead.manager_id = mid
            await db.flush()
    return lead, True


async def upsert_thread(
    db: AsyncSession,
    *,
    company_id: int,
    lead: Lead,
    provider: str,
    external_chat_id: str | None,
    title: str | None = None,
) -> ChatThread:
    q = select(ChatThread).where(
        ChatThread.company_id == company_id,
        ChatThread.lead_id == lead.id,
        ChatThread.provider == provider,
    )
    if external_chat_id:
        q = q.where(ChatThread.external_chat_id == external_chat_id)
    found = (await db.execute(q.limit(1))).scalars().first()
    if found is not None:
        found.updated_at = datetime.now(UTC)
        if title and not found.title:
            found.title = title
        if external_chat_id and not found.external_chat_id:
            found.external_chat_id = external_chat_id
        await db.flush()
        return found
    t = ChatThread(
        company_id=company_id,
        lead_id=lead.id,
        pipeline_id=lead.stage.pipeline_id if lead.stage else None,
        provider=provider,
        external_chat_id=external_chat_id,
        title=title,
        created_at=datetime.now(UTC),
        updated_at=datetime.now(UTC),
    )
    db.add(t)
    await db.flush()
    return t


async def message_exists_by_provider_id(db: AsyncSession, company_id: int, provider_message_id: str | None) -> bool:
    pid = (provider_message_id or "").strip()
    if not pid:
        return False
    q = select(ChatMessage.id).where(
        ChatMessage.company_id == company_id,
        ChatMessage.provider_message_id == pid,
    ).limit(1)
    return (await db.execute(q)).scalar() is not None


async def add_incoming_message(
    db: AsyncSession,
    company_id: int,
    thread_id: int,
    text: str,
    *,
    message_type: str = "text",
    media_url: str | None = None,
    media_mime: str | None = None,
    file_name: str | None = None,
    provider_message_id: str | None = None,
    created_at: datetime | None = None,
) -> bool:
    """Добавляет входящее сообщение. Возвращает False, если дубликат по provider_message_id."""
    if await message_exists_by_provider_id(db, company_id, provider_message_id):
        return False
    body = (text or "").strip()
    if not body and not media_url:
        return False
    if not body:
        body = " "
    db.add(
        ChatMessage(
            company_id=company_id,
            thread_id=thread_id,
            author_user_id=None,
            direction="in",
            text=body,
            message_type=message_type,
            media_url=media_url,
            media_mime=media_mime,
            file_name=file_name,
            provider_message_id=(provider_message_id or "").strip() or None,
            delivery_status="sent",
            created_at=created_at or datetime.now(UTC),
        )
    )
    await db.flush()
    return True


async def add_outgoing_message(
    db: AsyncSession,
    company_id: int,
    thread_id: int,
    text: str,
    *,
    provider_message_id: str | None = None,
    created_at: datetime | None = None,
    send_by_api: bool = False,
) -> bool:
    if await message_exists_by_provider_id(db, company_id, provider_message_id):
        return False
    body = (text or "").strip() or " "
    db.add(
        ChatMessage(
            company_id=company_id,
            thread_id=thread_id,
            author_user_id=None,
            direction="out",
            text=body,
            message_type="text",
            provider_message_id=(provider_message_id or "").strip() or None,
            delivery_status="sent",
            created_at=created_at or datetime.now(UTC),
        )
    )
    await db.flush()
    return True
