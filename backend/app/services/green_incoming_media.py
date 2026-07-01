"""Сохранение входящих медиа Green API в локальное хранилище CRM."""

from __future__ import annotations

import logging

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import ChatMessage, ChatThread, Integration, IntegrationProvider
from app.services.audio_prepare import prepare_incoming_audio_for_playback
from app.services.chat_media_store import local_media_exists, save_chat_media
from app.services.green_media_fetch import download_green_incoming_media, fetch_url_bytes

logger = logging.getLogger(__name__)

_MEDIA_TYPES = frozenset({"image", "video", "audio", "document"})


def _should_transcode_audio(message_type: str | None, mime: str | None, file_name: str | None) -> bool:
    mt = (message_type or "").strip().lower()
    if mt == "audio":
        return True
    m = (mime or "").split(";")[0].strip().lower()
    if m.startswith("audio/") and m != "audio/mpeg":
        return True
    low = (file_name or "").lower()
    return low.endswith((".ogg", ".opus", ".webm", ".amr", ".m4a"))


async def _store_message_media(
    msg: ChatMessage,
    *,
    content: bytes,
    file_name: str | None,
    mime: str | None,
    message_type: str | None = None,
) -> bool:
    if msg.id is None:
        return False
    out_bytes = content
    out_name = file_name
    out_mime = mime
    if _should_transcode_audio(message_type or msg.message_type, mime, file_name):
        out_bytes, out_name, out_mime = await prepare_incoming_audio_for_playback(content, file_name, mime)
    stored = save_chat_media(msg.id, out_name, out_bytes, mime=out_mime)
    msg.media_url = stored
    if out_mime:
        msg.media_mime = out_mime
    if out_name and not msg.file_name:
        msg.file_name = out_name
    return True


async def persist_incoming_green_media(
    db: AsyncSession,
    *,
    msg: ChatMessage,
    config: dict | None,
    chat_id: str,
    id_message: str | None,
    download_url: str | None,
    file_name: str | None,
    media_mime: str | None,
    message_type: str | None = None,
) -> bool:
    """Скачивает файл и подменяет media_url на /api/chat/messages/{id}/media."""
    if msg.id is None:
        return False
    if local_media_exists(msg.id):
        msg.media_url = f"/api/chat/messages/{msg.id}/media"
        await db.flush()
        return True

    content: bytes | None = None
    mime: str | None = (media_mime or "").strip() or None

    if download_url or id_message:
        content, fetched_mime = await download_green_incoming_media(
            config,
            chat_id=chat_id,
            id_message=id_message,
            download_url=download_url,
        )
        if fetched_mime and not mime:
            mime = fetched_mime
    elif download_url and str(download_url).startswith("http"):
        content, fetched_mime = await fetch_url_bytes(str(download_url))
        if fetched_mime and not mime:
            mime = fetched_mime

    if not content:
        logger.info("incoming green media not downloaded msg_id=%s chat=%s", msg.id, chat_id)
        return False

    await _store_message_media(
        msg,
        content=content,
        file_name=file_name,
        mime=mime,
        message_type=message_type or msg.message_type,
    )
    await db.flush()
    return True


async def ensure_chat_message_media_local(
    db: AsyncSession,
    *,
    msg: ChatMessage,
    thread: ChatThread,
) -> bool:
    """Ленивая подгрузка медиа для старых сообщений (внешняя ссылка без локального файла)."""
    if msg.id is None or local_media_exists(msg.id):
        return local_media_exists(msg.id or 0)

    raw_url = (msg.media_url or "").strip()
    provider_msg = (msg.provider_message_id or "").strip() or None
    ext_chat = (thread.external_chat_id or "").strip()
    content: bytes | None = None
    mime: str | None = (msg.media_mime or "").strip() or None

    if thread.provider == IntegrationProvider.green_api.value and ext_chat and provider_msg:
        integ = (
            await db.execute(
                select(Integration)
                .where(
                    Integration.provider == IntegrationProvider.green_api,
                    Integration.is_active.is_(True),
                    Integration.company_id == thread.company_id,
                    Integration.pipeline_id == (thread.pipeline_id or 0),
                )
                .order_by(Integration.id.desc())
                .limit(1),
            )
        ).scalars().first()
        cfg = integ.config if integ and isinstance(integ.config, dict) else {}
        content, fetched_mime = await download_green_incoming_media(
            cfg,
            chat_id=ext_chat,
            id_message=provider_msg,
            download_url=raw_url or None,
        )
        if fetched_mime and not mime:
            mime = fetched_mime
    elif raw_url.startswith("http"):
        content, fetched_mime = await fetch_url_bytes(raw_url)
        if fetched_mime and not mime:
            mime = fetched_mime

    if not content:
        return False

    await _store_message_media(
        msg,
        content=content,
        file_name=msg.file_name,
        mime=mime,
        message_type=msg.message_type,
    )
    await db.flush()
    return True


async def repair_thread_media(
    db: AsyncSession,
    *,
    thread: ChatThread,
    limit: int = 80,
) -> dict[str, int]:
    """Догружает отсутствующие локальные файлы для медиа-сообщений в диалоге."""
    rows = (
        await db.execute(
            select(ChatMessage)
            .where(
                ChatMessage.thread_id == thread.id,
                ChatMessage.company_id == thread.company_id,
                ChatMessage.message_type.in_(tuple(_MEDIA_TYPES)),
            )
            .order_by(ChatMessage.id.desc())
            .limit(limit),
        )
    ).scalars().all()

    checked = 0
    repaired = 0
    failed = 0
    for msg in rows:
        if msg.id is None:
            continue
        checked += 1
        if local_media_exists(msg.id):
            if (msg.media_url or "").strip() != f"/api/chat/messages/{msg.id}/media":
                msg.media_url = f"/api/chat/messages/{msg.id}/media"
                repaired += 1
            continue
        ok = await ensure_chat_message_media_local(db, msg=msg, thread=thread)
        if ok:
            repaired += 1
        else:
            failed += 1

    if repaired:
        await db.flush()
    return {"checked": checked, "repaired": repaired, "failed": failed}


async def persist_incoming_green_media_if_needed(
    db: AsyncSession,
    *,
    msg: ChatMessage | None,
    config: dict | None,
    chat_id: str,
    id_message: str | None,
    message_type: str,
    download_url: str | None,
    file_name: str | None,
    media_mime: str | None,
) -> None:
    if msg is None:
        return
    mt = (message_type or "text").strip().lower()
    if mt not in _MEDIA_TYPES and not download_url:
        return
    await persist_incoming_green_media(
        db,
        msg=msg,
        config=config,
        chat_id=chat_id,
        id_message=id_message,
        download_url=download_url,
        file_name=file_name,
        media_mime=media_mime,
        message_type=mt,
    )
