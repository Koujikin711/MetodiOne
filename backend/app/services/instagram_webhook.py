"""Обработка webhook Meta (Instagram Direct + Lead Ads через page/leadgen)."""

from __future__ import annotations

import hashlib
import hmac
import json
import logging
from typing import Any

import httpx
from fastapi import HTTPException, status
from sqlalchemy import and_, exists, select
from sqlalchemy.ext.asyncio import AsyncSession
from starlette.responses import PlainTextResponse, Response

from app.models import Integration, IntegrationProvider, SystemAuditEvent

logger = logging.getLogger(__name__)

GRAPH_API_VERSION = "v21.0"
GRAPH_BASE = f"https://graph.facebook.com/{GRAPH_API_VERSION}"


def verify_meta_app_signature(*, raw_body: bytes, signature_header: str | None, app_secret: str) -> bool:
    """Проверка X-Hub-Signature-256. Если app_secret пустой — пропускаем (слабее, только для отладки)."""
    secret = (app_secret or "").strip()
    if not secret:
        return True
    if not signature_header or not signature_header.startswith("sha256="):
        return False
    expected_hex = hmac.new(secret.encode("utf-8"), raw_body, hashlib.sha256).hexdigest()
    received_hex = signature_header[7:].strip()
    if len(received_hex) != len(expected_hex):
        return False
    return hmac.compare_digest(expected_hex.encode("ascii"), received_hex.encode("ascii"))


async def _audit_leadgen_done(db: AsyncSession, *, company_id: int, leadgen_id: str) -> bool:
    """Идемпотентность: Meta может повторить webhook."""
    try:
        lid = int(str(leadgen_id).strip())
    except ValueError:
        return False
    q = select(
        exists().where(
            and_(
                SystemAuditEvent.company_id == company_id,
                SystemAuditEvent.entity_type == "meta_leadgen",
                SystemAuditEvent.entity_id == lid,
                SystemAuditEvent.action == "ingested",
            ),
        ),
    )
    return bool((await db.execute(q)).scalar())


async def _mark_leadgen_done(db: AsyncSession, *, company_id: int, leadgen_id: str) -> None:
    try:
        lid = int(str(leadgen_id).strip())
    except ValueError:
        lid = None
    db.add(
        SystemAuditEvent(
            company_id=company_id,
            entity_type="meta_leadgen",
            entity_id=lid,
            action="ingested",
            details=f"leadgen_id={leadgen_id}",
        ),
    )
    await db.flush()


async def _audit_message_mid(db: AsyncSession, *, company_id: int, mid: str) -> bool:
    if not mid:
        return False
    q = select(
        exists().where(
            and_(
                SystemAuditEvent.company_id == company_id,
                SystemAuditEvent.entity_type == "instagram_dm",
                SystemAuditEvent.details == mid,
                SystemAuditEvent.action == "ingested",
            ),
        ),
    )
    return bool((await db.execute(q)).scalar())


async def _mark_message_mid(db: AsyncSession, *, company_id: int, mid: str) -> None:
    db.add(
        SystemAuditEvent(
            company_id=company_id,
            entity_type="instagram_dm",
            entity_id=None,
            action="ingested",
            details=mid[:512],
        ),
    )
    await db.flush()


async def fetch_leadgen_fields(leadgen_id: str, page_access_token: str) -> dict[str, str]:
    async with httpx.AsyncClient(timeout=30.0) as client:
        r = await client.get(
            f"{GRAPH_BASE}/{leadgen_id}",
            params={"access_token": page_access_token, "fields": "field_data,created_time,id"},
        )
        r.raise_for_status()
        data = r.json()
    out: dict[str, str] = {}
    for item in data.get("field_data") or []:
        name = str(item.get("name") or "").strip()
        vals = item.get("values") or []
        if name and vals:
            out[name] = str(vals[0]).strip()
    return out


async def fetch_ig_user_display_name(psid: str, page_access_token: str) -> str | None:
    """Имя отправителя Instagram Direct (IGSID)."""
    psid = str(psid).strip()
    if not psid:
        return None
    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            r = await client.get(
                f"{GRAPH_BASE}/{psid}",
                params={"access_token": page_access_token, "fields": "name,username"},
            )
            if r.status_code != 200:
                return None
            data = r.json()
        name = (data.get("name") or "").strip()
        un = (data.get("username") or "").strip()
        if name and un:
            return f"{name} (@{un})"
        return name or (f"@{un}" if un else None)
    except Exception:
        logger.exception("instagram: failed to fetch sender profile id=%s", psid)
        return None


def _lead_from_field_data(fd: dict[str, str]) -> tuple[str, str | None, str | None]:
    name = (
        fd.get("full_name")
        or fd.get("ФИО")
        or " ".join(
            x
            for x in (
                (fd.get("first_name") or "").strip(),
                (fd.get("last_name") or "").strip(),
            )
            if x
        ).strip()
        or (fd.get("first_name") or "").strip()
        or (fd.get("email") or "").strip()
        or "Лид Instagram / Facebook"
    )
    phone = fd.get("phone_number") or fd.get("phone") or fd.get("Телефон") or fd.get("mobile_phone")
    email = fd.get("email") or fd.get("Email")
    digits = "".join(ch for ch in str(phone or "") if ch.isdigit()) or None
    em = (str(email).strip() if email else None) or None
    return name.strip() or "Лид Instagram / Facebook", digits, em


def meta_hub_challenge_response(*, verify_token: str, hub_mode: str | None, hub_verify_token: str | None, hub_challenge: str | None) -> PlainTextResponse | None:
    """Подписка webhook в Meta: вернуть hub.challenge как plain text."""
    if (hub_mode or "").strip() != "subscribe":
        return None
    if not hub_challenge:
        return None
    if (hub_verify_token or "").strip() != verify_token.strip():
        return None
    return PlainTextResponse(content=hub_challenge, status_code=200)


async def handle_instagram_webhook(
    db: AsyncSession,
    *,
    integ: Integration,
    company_id: int,
    raw_body: bytes,
    payload: dict[str, Any],
    signature_header: str | None,
    # callbacks injected to avoid circular imports
    create_lead_fn: Any,
    upsert_thread_fn: Any,
    add_message_fn: Any,
    lead_read_fn: Any,
) -> Any:
    """
    Возвращает LeadRead или Response (204).
    create_lead_fn(db, integ=..., company_id=..., name=..., phone=..., email=..., source_name=..., external_chat_id=..., thread_provider=...)
    """
    cfg = integ.config if isinstance(integ.config, dict) else {}
    page_token = str(cfg.get("page_access_token") or cfg.get("pageAccessToken") or "").strip()
    app_secret = str(cfg.get("app_secret") or cfg.get("appSecret") or "").strip()

    if not verify_meta_app_signature(raw_body=raw_body, signature_header=signature_header, app_secret=app_secret):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Invalid X-Hub-Signature-256")

    if not page_token:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Instagram integration missing page_access_token",
        )

    obj = str(payload.get("object") or "").strip()
    entries = payload.get("entry") or []
    if not isinstance(entries, list) or not entries:
        return Response(status_code=204)

    source_lead = "INSTAGRAM"
    source_dm = "INSTAGRAM_DM"

    for entry in entries:
        if not isinstance(entry, dict):
            continue

        # --- Lead Ads (field leadgen на странице) ---
        for change in entry.get("changes") or []:
            if not isinstance(change, dict):
                continue
            if str(change.get("field") or "") != "leadgen":
                continue
            val = change.get("value") or {}
            if not isinstance(val, dict):
                continue
            leadgen_id = str(val.get("leadgen_id") or "").strip()
            if not leadgen_id:
                continue
            if await _audit_leadgen_done(db, company_id=company_id, leadgen_id=leadgen_id):
                continue
            try:
                fd = await fetch_leadgen_fields(leadgen_id, page_token)
            except Exception as e:
                logger.exception("instagram leadgen fetch failed id=%s: %s", leadgen_id, e)
                continue
            name, phone, email = _lead_from_field_data(fd)
            extra = json.dumps(fd, ensure_ascii=False)[:1800]
            text = f"Заявка Lead Ads (leadgen_id={leadgen_id}).\nПоля:\n{extra}"
            lead = await create_lead_fn(
                db,
                integ=integ,
                company_id=company_id,
                name=name,
                phone=phone,
                email=email,
                source_name=source_lead,
                external_chat_id=None,
                thread_provider=None,
            )
            thread = await upsert_thread_fn(
                db,
                company_id=company_id,
                lead=lead,
                provider=IntegrationProvider.instagram.value,
                external_chat_id=f"leadgen:{leadgen_id}",
                title=name,
            )
            await add_message_fn(db, company_id, thread.id, text)
            await _mark_leadgen_done(db, company_id=company_id, leadgen_id=leadgen_id)
            await db.refresh(lead, ["stage"])
            return lead_read_fn(lead)

        # --- Instagram Direct (object == "instagram") ---
        if obj == "instagram":
            for msg_evt in entry.get("messaging") or []:
                if not isinstance(msg_evt, dict):
                    continue
                message = msg_evt.get("message") or {}
                if not isinstance(message, dict):
                    continue
                # Не дублируем исходящие echo из CRM
                if message.get("is_echo") is True:
                    continue
                mid = str(message.get("mid") or "").strip()
                if mid and await _audit_message_mid(db, company_id=company_id, mid=mid):
                    continue
                text = str(message.get("text") or "").strip()
                if not text and not message.get("attachments"):
                    continue
                sender = msg_evt.get("sender") or {}
                sid = str(sender.get("id") or "").strip()
                if not sid:
                    continue
                display = await fetch_ig_user_display_name(sid, page_token)
                name = display or f"Instagram {sid[:8]}…"
                ext = f"ig:{sid}"
                body = text or "[вложение]"
                lead = await create_lead_fn(
                    db,
                    integ=integ,
                    company_id=company_id,
                    name=name,
                    phone=None,
                    email=None,
                    source_name=source_dm,
                    external_chat_id=ext,
                    thread_provider=IntegrationProvider.instagram.value,
                )
                thread = await upsert_thread_fn(
                    db,
                    company_id=company_id,
                    lead=lead,
                    provider=IntegrationProvider.instagram.value,
                    external_chat_id=ext,
                    title=name,
                )
                await add_message_fn(db, company_id, thread.id, body)
                if mid:
                    await _mark_message_mid(db, company_id=company_id, mid=mid)
                await db.refresh(lead, ["stage"])
                return lead_read_fn(lead)

        # --- Редко: messaging под object page (Facebook Messenger) ---
        if obj == "page" and entry.get("messaging"):
            for msg_evt in entry.get("messaging") or []:
                if not isinstance(msg_evt, dict):
                    continue
                message = msg_evt.get("message") or {}
                if not isinstance(message, dict):
                    continue
                if message.get("is_echo") is True:
                    continue
                mid = str(message.get("mid") or "").strip()
                if mid and await _audit_message_mid(db, company_id=company_id, mid=mid):
                    continue
                text = str(message.get("text") or "").strip()
                if not text:
                    continue
                sender = msg_evt.get("sender") or {}
                sid = str(sender.get("id") or "").strip()
                if not sid:
                    continue
                sender_label = (await fetch_ig_user_display_name(sid, page_token)) or f"Facebook {sid[:8]}…"
                ext = f"fb:{sid}"
                lead = await create_lead_fn(
                    db,
                    integ=integ,
                    company_id=company_id,
                    name=sender_label,
                    phone=None,
                    email=None,
                    source_name="FACEBOOK_MESSENGER",
                    external_chat_id=ext,
                    thread_provider=IntegrationProvider.instagram.value,
                )
                thread = await upsert_thread_fn(
                    db,
                    company_id=company_id,
                    lead=lead,
                    provider=IntegrationProvider.instagram.value,
                    external_chat_id=ext,
                    title=sender_label,
                )
                await add_message_fn(db, company_id, thread.id, text)
                if mid:
                    await _mark_message_mid(db, company_id=company_id, mid=mid)
                await db.refresh(lead, ["stage"])
                return lead_read_fn(lead)

    return Response(status_code=204)
