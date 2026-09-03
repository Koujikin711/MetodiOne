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


async def _green_config_for_thread(db: AsyncSession, thread: ChatThread) -> dict:
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
    return integ.config if integ and isinstance(integ.config, dict) else {}


async def prepare_chat_message_media_download(
    db: AsyncSession,
    *,
    msg: ChatMessage,
    thread: ChatThread,
) -> dict | None:
    """Короткий DB-lookup: план скачивания без HTTP (чтобы не держать пул)."""
    if msg.id is None or local_media_exists(msg.id):
        return None

    raw_url = (msg.media_url or "").strip()
    provider_msg = (msg.provider_message_id or "").strip() or None
    ext_chat = (thread.external_chat_id or "").strip()
    mime = (msg.media_mime or "").strip() or None

    if thread.provider == IntegrationProvider.green_api.value and ext_chat and provider_msg:
        cfg = await _green_config_for_thread(db, thread)
        return {
            "kind": "green",
            "message_id": int(msg.id),
            "cfg": cfg,
            "chat_id": ext_chat,
            "id_message": provider_msg,
            "download_url": raw_url or None,
            "mime": mime,
            "file_name": msg.file_name,
            "message_type": msg.message_type,
        }
    if raw_url.startswith("http"):
        return {
            "kind": "url",
            "message_id": int(msg.id),
            "url": raw_url,
            "mime": mime,
            "file_name": msg.file_name,
            "message_type": msg.message_type,
        }
    return None


async def fetch_media_bytes_for_plan(plan: dict) -> tuple[bytes | None, str | None]:
    """HTTP без сессии БД."""
    mime = plan.get("mime")
    if plan.get("kind") == "green":
        content, fetched_mime = await download_green_incoming_media(
            plan.get("cfg") if isinstance(plan.get("cfg"), dict) else {},
            chat_id=str(plan.get("chat_id") or ""),
            id_message=plan.get("id_message"),
            download_url=plan.get("download_url"),
        )
        return content, fetched_mime or mime
    if plan.get("kind") == "url":
        content, fetched_mime = await fetch_url_bytes(str(plan.get("url") or ""))
        return content, fetched_mime or mime
    return None, mime


async def apply_downloaded_chat_media(
    db: AsyncSession,
    *,
    message_id: int,
    content: bytes,
    mime: str | None,
    file_name: str | None,
    message_type: str | None,
) -> bool:
    msg = await db.get(ChatMessage, message_id)
    if msg is None:
        return False
    ok = await _store_message_media(
        msg,
        content=content,
        file_name=file_name or msg.file_name,
        mime=mime,
        message_type=message_type or msg.message_type,
    )
    if ok:
        await db.flush()
    return ok


async def ensure_chat_message_media_local(
    db: AsyncSession,
    *,
    msg: ChatMessage,
    thread: ChatThread,
) -> bool:
    """Ленивая подгрузка медиа (для repair и путей, где сессия уже открыта)."""
    if msg.id is None or local_media_exists(msg.id):
        return local_media_exists(msg.id or 0)

    plan = await prepare_chat_message_media_download(db, msg=msg, thread=thread)
    if plan is None:
        return local_media_exists(msg.id)

    content, mime = await fetch_media_bytes_for_plan(plan)
    if not content:
        return False

    return await apply_downloaded_chat_media(
        db,
        message_id=int(msg.id),
        content=content,
        mime=mime,
        file_name=msg.file_name,
        message_type=msg.message_type,
    )


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
