"""Маршрутизация исходящих WhatsApp на доп. номер, если основной не ответил."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

from sqlalchemy import exists, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.models import ChatMessage, ChatThread, Lead
from app.services.lead_extra_phones import get_first_extra_phone, norm_phone


def _to_green_chat_id(phone: str) -> str:
    digits = norm_phone(phone) or phone
    return f"{digits}@c.us"


async def _primary_chat_id(thread: ChatThread, lead: Lead | None) -> str:
    ext = (thread.external_chat_id or "").strip()
    if ext:
        return ext
    if lead and lead.phone:
        return _to_green_chat_id(lead.phone)
    return ""


async def should_route_to_extra_phone(db: AsyncSession, *, thread_id: int) -> bool:
    """
    True, если последнее сообщение менеджера в треде без ответа клиента
    и прошло >= whatsapp_primary_reply_timeout_hours.
    """
    last_mgr_out = (
        await db.execute(
            select(ChatMessage)
            .where(
                ChatMessage.thread_id == thread_id,
                ChatMessage.direction == "out",
                ChatMessage.author_user_id.is_not(None),
            )
            .order_by(ChatMessage.id.desc())
            .limit(1),
        )
    ).scalars().first()
    if last_mgr_out is None:
        return False

    has_reply = (
        await db.execute(
            select(
                exists().where(
                    ChatMessage.thread_id == thread_id,
                    ChatMessage.direction == "in",
                    ChatMessage.id > last_mgr_out.id,
                ),
            ),
        )
    ).scalar()
    if has_reply:
        return False

    hours = max(1, int(settings.whatsapp_primary_reply_timeout_hours))
    deadline = last_mgr_out.created_at
    if deadline.tzinfo is None:
        deadline = deadline.replace(tzinfo=UTC)
    return datetime.now(UTC) >= deadline + timedelta(hours=hours)


async def resolve_outbound_green_chat_id(
    db: AsyncSession,
    *,
    thread: ChatThread,
) -> tuple[str, bool]:
    """
    Возвращает (chatId, used_extra_phone).
    Если основной номер не ответил менеджеру за 72 ч — отправка на первый доп. номер.
    """
    lead = await db.get(Lead, thread.lead_id) if thread.lead_id else None
    primary = await _primary_chat_id(thread, lead)
    if lead is None or not primary:
        return primary, False

    extra = await get_first_extra_phone(db, lead.id)
    if not extra:
        return primary, False

    if await should_route_to_extra_phone(db, thread_id=thread.id):
        return _to_green_chat_id(extra), True
    return primary, False
