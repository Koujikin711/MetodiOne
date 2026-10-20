"""Входящие из QR-сессии Baileys попадают в те же диалоги, что и Green API."""

from __future__ import annotations

import logging
from datetime import UTC, datetime
from pathlib import Path

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Integration, IntegrationProvider, Lead
from app.services.chat_media_store import save_chat_media
from app.services.integration_inbound import (
    add_incoming_message,
    create_lead_from_integration,
    incoming_text_already_stored,
    upsert_thread,
)
from app.services.wa_bridge_process import data_root
from app.services.whatsapp_automation import send_welcome_if_first_incoming

logger = logging.getLogger(__name__)


def _under_data(path: Path) -> bool:
    root = data_root().resolve()
    try:
        full = path.resolve()
    except OSError:
        return False
    return full == root or root in full.parents


async def _active_green(db: AsyncSession) -> Integration | None:
    return (
        await db.scalars(
            select(Integration)
            .where(
                Integration.provider == IntegrationProvider.green_api,
                Integration.is_active.is_(True),
                Integration.company_id.is_not(None),
            )
            .order_by(Integration.id.asc())
            .limit(1)
        )
    ).first()


def _phone(chat_id: str) -> str | None:
    raw = chat_id.strip()
    if raw.endswith("@c.us"):
        digits = raw[: -len("@c.us")]
        return digits or None
    digits = "".join(ch for ch in raw if ch.isdigit())
    return digits or None


def _text_and_type(body: dict) -> tuple[str, str]:
    caption = str(body.get("caption") or body.get("body") or "").strip()
    kind = str(body.get("mediaKind") or "")
    if kind == "image":
        return caption or "📷 Фото", "image"
    if kind in {"voice", "audio"}:
        return caption or "🎤 Голосовое", "audio"
    if kind:
        return caption or "📎 Файл", "document"
    return caption, "text"


async def handle_bridge_payload(db: AsyncSession, body: dict) -> dict:
    kind = str(body.get("type") or "")
    if kind == "young-chat-probe":
        return {"unknown": []}
    if kind == "history-import":
        return {"ok": True, "skipped": "known"}
    if kind != "message":
        return {"ok": True}
    if body.get("direction") == "outbound":
        return {"ok": True}

    integ = await _active_green(db)
    if integ is None or integ.company_id is None:
        return {"ok": True, "skipped": "no-integration"}

    chat_id = str(body.get("chatId") or "").strip()
    # Пока Green API авторизован, часть реплик доходит только до телефона и QR-сессии.
    # Раньше такие строки отбрасывались. Группы и чаты без номера в диалог менеджера не кладём.
    if chat_id.endswith("@g.us") or chat_id.endswith("@broadcast") or chat_id.endswith("@newsletter"):
        return {"ok": True, "skipped": "group"}
    if not chat_id.endswith("@c.us"):
        return {"ok": True, "skipped": "no-phone"}
    message_id = str(body.get("messageId") or "").strip() or None
    if not chat_id:
        return {"ok": True, "empty": True}
    text, message_type = _text_and_type(body)
    media_path = str(body.get("mediaPath") or "").strip()
    has_media = bool(media_path)
    if not text and not has_media:
        return {"ok": True, "empty": True}

    company_id = int(integ.company_id)
    name = str(body.get("contactName") or "").strip() or "WhatsApp"
    phone = _phone(chat_id)
    created_at = None
    try:
        ts = int(body.get("timestamp") or 0)
        if ts > 1_000_000_000_000:
            ts = ts // 1000
        if ts > 1_000_000_000:
            created_at = datetime.fromtimestamp(ts, tz=UTC)
    except (TypeError, ValueError, OSError, OverflowError):
        created_at = None

    lead, _created = await create_lead_from_integration(
        db,
        integ=integ,
        company_id=company_id,
        name=name,
        phone=phone,
        email=None,
        source_name="GREEN API",
        external_chat_id=chat_id,
        thread_provider=IntegrationProvider.green_api.value,
    )
    thread = await upsert_thread(
        db,
        company_id=company_id,
        lead=lead,
        provider=IntegrationProvider.green_api.value,
        external_chat_id=chat_id,
        title=name,
        pipeline_id=int(integ.pipeline_id) if integ.pipeline_id else None,
    )
    if thread.lead_id and int(thread.lead_id) != int(lead.id):
        linked = await db.get(Lead, int(thread.lead_id))
        if linked is not None and linked.company_id == company_id:
            lead = linked

    if message_type == "text" and text and await incoming_text_already_stored(
        db,
        company_id=company_id,
        thread_id=thread.id,
        text=text,
        created_at=created_at,
    ):
        return {"ok": True, "skipped": "duplicate"}

    msg = await add_incoming_message(
        db,
        company_id,
        thread.id,
        text,
        message_type=message_type,
        file_name=str(body.get("fileName") or "") or None,
        media_mime=str(body.get("mimeType") or "") or None,
        provider_message_id=message_id,
        created_at=created_at,
    )
    if msg is not None and has_media:
        disk = Path(media_path)
        if _under_data(disk) and disk.is_file():
            blob = disk.read_bytes()
            if 0 < len(blob) <= 20 * 1024 * 1024:
                stored = save_chat_media(
                    msg.id,
                    str(body.get("fileName") or disk.name),
                    blob,
                    mime=str(body.get("mimeType") or "") or None,
                )
                if stored:
                    msg.media_url = stored
                    msg.media_mime = str(body.get("mimeType") or "") or None
                    await db.flush()
    if lead.id is not None:
        try:
            await send_welcome_if_first_incoming(
                db,
                lead=lead,
                thread=thread,
                integration=integ,
            )
        except Exception:
            logger.warning("wa bridge welcome skipped")
    return {"ok": True}
