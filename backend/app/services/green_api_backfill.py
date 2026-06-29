"""Догрузка пропущенных WhatsApp-диалогов из журнала Green API в CRM."""

from __future__ import annotations

import asyncio
import logging
from datetime import UTC, datetime, timedelta
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Integration, IntegrationProvider
from app.services.green_api_journal import fetch_chat_history, fetch_last_incoming_messages
from app.services.green_incoming import parse_green_journal_message
from app.services.green_incoming_media import persist_incoming_green_media_if_needed
from app.services.integration_inbound import (
    add_incoming_message,
    add_outgoing_message,
    create_lead_from_integration,
    norm_phone,
    upsert_thread,
)
from app.services.whatsapp_automation import _DEFAULT_TEMPLATES, _templates_from_integration_config

logger = logging.getLogger(__name__)

_SKIP_TYPE_MESSAGES = frozenset(
    {
        "incomingblock",
        "reactionmessage",
        "pollupdatemessage",
        "deletedmessage",
    },
)


def _msg_ts(msg: dict[str, Any]) -> int:
    try:
        return int(msg.get("timestamp") or 0)
    except (TypeError, ValueError):
        return 0


def _msg_direction(msg: dict[str, Any]) -> str:
    return str(msg.get("type") or "").strip().lower()


def _is_meaningful_message(msg: dict[str, Any]) -> bool:
    tm = str(msg.get("typeMessage") or "").lower()
    if tm in _SKIP_TYPE_MESSAGES or msg.get("isDeleted"):
        return False
    text, mtype, media_url, _, _ = parse_green_journal_message(msg)
    if text or media_url or mtype != "text":
        return True
    return False


def _greeting_template_text(integ: Integration) -> str:
    cfg = integ.config if isinstance(integ.config, dict) else {}
    return _templates_from_integration_config(cfg).get("greeting", _DEFAULT_TEMPLATES["greeting"])


def _normalize_greeting_compare(text: str) -> str:
    return " ".join((text or "").lower().split())


def _is_auto_greeting_outgoing(msg: dict[str, Any], greeting_template: str) -> bool:
    if _msg_direction(msg) != "outgoing":
        return False
    if msg.get("sendByApi") is True:
        return True
    text, _, _, _, _ = parse_green_journal_message(msg)
    tpl = greeting_template.replace("{name}", "").replace("{date}", "").replace("{time}", "").replace("{manager}", "")
    norm_text = _normalize_greeting_compare(text)
    norm_tpl = _normalize_greeting_compare(tpl)
    if norm_tpl and len(norm_tpl) >= 8 and norm_tpl[:24] in norm_text:
        return True
    return False


def _chat_id_personal(chat_id: str) -> bool:
    cid = (chat_id or "").strip().lower()
    return cid.endswith("@c.us") and not cid.startswith("0@")


def _phone_from_chat_id(chat_id: str) -> str | None:
    if chat_id.endswith("@c.us"):
        return norm_phone(chat_id.replace("@c.us", ""))
    return norm_phone(chat_id)


def chat_needs_backfill(
    history_chronological: list[dict[str, Any]],
    *,
    cutoff_ts: int,
    greeting_template: str,
) -> tuple[bool, str]:
    """
    Нужен ли импорт: клиент написал после приветствия (или при сбое webhook — вообще написал)
    и последнее значимое сообщение — входящее (ждут ответа).
    """
    msgs = [
        m
        for m in history_chronological
        if _msg_ts(m) >= cutoff_ts and _is_meaningful_message(m) and _msg_direction(m) in ("incoming", "outgoing")
    ]
    if not msgs:
        return False, "no_messages_in_window"

    last = msgs[-1]
    if _msg_direction(last) != "incoming":
        return False, "already_answered"

    first_in_idx = next((i for i, m in enumerate(msgs) if _msg_direction(m) == "incoming"), None)
    if first_in_idx is None:
        return False, "no_incoming"

    greeting_idx = None
    for i in range(first_in_idx + 1, len(msgs)):
        if _msg_direction(msgs[i]) == "outgoing":
            greeting_idx = i
            break

    if greeting_idx is None:
        return True, "no_greeting_outage"

    after_greeting = msgs[greeting_idx + 1 :]
    post_greeting_incoming = [m for m in after_greeting if _msg_direction(m) == "incoming"]
    human_replies = [
        m
        for m in after_greeting
        if _msg_direction(m) == "outgoing" and not _is_auto_greeting_outgoing(m, greeting_template)
    ]

    if post_greeting_incoming and not human_replies:
        return True, "after_greeting_no_reply"

    if not post_greeting_incoming and greeting_idx == len(msgs) - 1:
        return False, "only_greeting_no_followup"

    return False, "no_match"


async def sync_green_api_backfill(
    db: AsyncSession,
    *,
    integ: Integration,
    company_id: int,
    days: int = 7,
    history_count: int = 150,
) -> dict[str, Any]:
    if integ.provider != IntegrationProvider.green_api:
        raise ValueError("Backfill поддерживается только для Green API")

    cfg = integ.config if isinstance(integ.config, dict) else {}
    minutes = max(1, min(int(days) * 24 * 60, 10080))
    cutoff = datetime.now(UTC) - timedelta(days=max(1, min(int(days), 30)))
    cutoff_ts = int(cutoff.timestamp())
    greeting_tpl = _greeting_template_text(integ)
    source_name = "GREEN API"

    stats: dict[str, Any] = {
        "days": days,
        "chats_scanned": 0,
        "chats_imported": 0,
        "leads_created": 0,
        "leads_updated": 0,
        "messages_added": 0,
        "skipped_answered": 0,
        "skipped_no_match": 0,
        "errors": [],
    }

    incoming, err = await fetch_last_incoming_messages(cfg, minutes=minutes)
    if err:
        raise RuntimeError(err)

    chat_ids: dict[str, dict[str, Any]] = {}
    for msg in incoming:
        cid = str(msg.get("chatId") or "").strip()
        if not _chat_id_personal(cid):
            continue
        if _msg_ts(msg) < cutoff_ts:
            continue
        tm = str(msg.get("typeMessage") or "").lower()
        if tm in _SKIP_TYPE_MESSAGES:
            continue
        prev = chat_ids.get(cid)
        if prev is None or _msg_ts(msg) > _msg_ts(prev):
            chat_ids[cid] = msg

    stats["chats_scanned"] = len(chat_ids)

    for chat_id, seed in chat_ids.items():
        history, hist_err = await fetch_chat_history(cfg, chat_id=chat_id, count=history_count)
        if hist_err:
            stats["errors"].append(f"{chat_id}: {hist_err}")
            continue

        chronological = list(reversed(history))
        needs, reason = chat_needs_backfill(chronological, cutoff_ts=cutoff_ts, greeting_template=greeting_tpl)
        if not needs:
            if reason == "already_answered":
                stats["skipped_answered"] += 1
            else:
                stats["skipped_no_match"] += 1
            continue

        sender_name = (
            str(seed.get("senderName") or seed.get("senderContactName") or "").strip()
            or "WhatsApp lead"
        )
        phone = _phone_from_chat_id(chat_id)

        lead, created = await create_lead_from_integration(
            db,
            integ=integ,
            company_id=company_id,
            name=sender_name,
            phone=phone,
            email=None,
            source_name=source_name,
            external_chat_id=chat_id,
            thread_provider=IntegrationProvider.green_api.value,
            assign_manager=True,
        )
        if created:
            stats["leads_created"] += 1
        else:
            stats["leads_updated"] += 1

        thread = await upsert_thread(
            db,
            company_id=company_id,
            lead=lead,
            provider=IntegrationProvider.green_api.value,
            external_chat_id=chat_id,
            title=sender_name,
        )

        added = 0
        for msg in chronological:
            if _msg_ts(msg) < cutoff_ts or not _is_meaningful_message(msg):
                continue
            direction = _msg_direction(msg)
            if direction not in ("incoming", "outgoing"):
                continue
            text, mtype, murl, mmime, mfn = parse_green_journal_message(msg)
            if not text and not murl:
                continue
            msg_id = str(msg.get("idMessage") or "").strip() or None
            created_at = datetime.fromtimestamp(_msg_ts(msg), tz=UTC)
            if direction == "incoming":
                incoming_msg = await add_incoming_message(
                    db,
                    company_id,
                    thread.id,
                    text,
                    message_type=mtype,
                    media_url=murl,
                    media_mime=mmime,
                    file_name=mfn,
                    provider_message_id=msg_id,
                    created_at=created_at,
                )
                await persist_incoming_green_media_if_needed(
                    db,
                    msg=incoming_msg,
                    config=cfg,
                    chat_id=chat_id,
                    id_message=msg_id,
                    message_type=mtype,
                    download_url=murl,
                    file_name=mfn,
                    media_mime=mmime,
                )
                ok = incoming_msg is not None
            else:
                ok = await add_outgoing_message(
                    db,
                    company_id,
                    thread.id,
                    text,
                    provider_message_id=msg_id,
                    created_at=created_at,
                )
            if ok:
                added += 1

        thread.updated_at = datetime.now(UTC)
        await db.flush()
        stats["messages_added"] += added
        stats["chats_imported"] += 1
        logger.info(
            "green backfill chat=%s lead_id=%s reason=%s messages=%s",
            chat_id,
            lead.id,
            reason,
            added,
        )
        await asyncio.sleep(0.12)

    return stats
