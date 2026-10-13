"""Входящие из QR-сессии Baileys попадают в те же диалоги, что и Green API."""

from __future__ import annotations

import logging
import time
from datetime import UTC, datetime
from pathlib import Path

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Integration, IntegrationProvider, Lead
from app.services.chat_media_store import save_chat_media
from app.services.integration_inbound import (
    add_incoming_message,
    create_lead_from_integration,
    upsert_thread,
)
from app.services.wa_bridge_process import data_root
from app.services.whatsapp_automation import send_welcome_if_first_incoming

logger = logging.getLogger(__name__)

_green_cache: tuple[float, bool] | None = None


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


def _green_up(integ: Integration | None) -> bool:
    """Как greenChannelUp в Qatrai Hayot: живой инстанс забирает чат себе."""
    global _green_cache
    now = time.monotonic()
    if _green_cache is not None:
        at, up = _green_cache
        if now - at < (20 if up else 5):
            return up
    if integ is None:
        _green_cache = (now, False)
        return False
    cfg = integ.config if isinstance(integ.config, dict) else {}
    instance_id = str(cfg.get("instance_id") or cfg.get("instanceId") or "").strip()
    token = str(cfg.get("api_token") or cfg.get("apiToken") or cfg.get("apiTokenInstance") or "").strip()
    if not instance_id or not token:
        _green_cache = (now, False)
        return False
    from urllib import request as urlrequest

    from app.services.green_api_settings import green_api_base_from_config

    base = green_api_base_from_config(cfg).rstrip("/")
    url = f"{base}/waInstance{instance_id}/getStateInstance/{token}"
    up = False
    try:
        req = urlrequest.Request(url, method="GET")
        with urlrequest.urlopen(req, timeout=4) as resp:
            import json

            data = json.loads(resp.read().decode("utf-8") or "{}")
        state = ""
        if isinstance(data, dict):
            state = str(data.get("stateInstance") or data.get("state") or "")
        up = state in {"authorized", "sleepMode", "starting"}
    except Exception:
        up = False
    _green_cache = (now, up)
    return up


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
    if _green_up(integ):
        return {"ok": True, "skipped": "green"}
    if integ is None or integ.company_id is None:
        return {"ok": True, "skipped": "no-integration"}

    chat_id = str(body.get("chatId") or "").strip()
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
                msg.media_url = save_chat_media(
                    msg.id,
                    str(body.get("fileName") or disk.name),
                    blob,
                    mime=str(body.get("mimeType") or "") or None,
                )
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
