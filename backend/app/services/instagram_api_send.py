"""Исходящие Direct / Messenger через Meta Graph API."""

from __future__ import annotations

import logging
from typing import Any, Literal

import httpx

from app.services.instagram_webhook import GRAPH_API_VERSION, GRAPH_BASE

logger = logging.getLogger(__name__)

IG_GRAPH_BASE = f"https://graph.instagram.com/{GRAPH_API_VERSION}"


def parse_meta_thread_recipient(external_chat_id: str | None) -> tuple[Literal["ig", "fb"] | None, str | None]:
    """Из ``ig:IGSID`` / ``fb:PSID`` → (kind, id)."""
    raw = (external_chat_id or "").strip()
    if raw.startswith("ig:") and len(raw) > 3:
        return "ig", raw[3:].strip() or None
    if raw.startswith("fb:") and len(raw) > 3:
        return "fb", raw[3:].strip() or None
    return None, None


def _access_token(config: dict | None) -> str:
    cfg = config or {}
    return str(cfg.get("page_access_token") or cfg.get("pageAccessToken") or "").strip()


def _prefer_instagram_graph(config: dict | None) -> bool:
    """Токен из Instagram Login → graph.instagram.com; Page Token → graph.facebook.com."""
    cfg = config or {}
    raw = str(cfg.get("graph_host") or cfg.get("token_kind") or "").strip().lower()
    if raw in ("instagram", "ig", "instagram_login"):
        return True
    if raw in ("facebook", "page", "fb"):
        return False
    # Явный флаг
    flag = cfg.get("use_instagram_graph")
    if flag is True or str(flag).lower() in ("1", "true", "yes"):
        return True
    return False


async def send_meta_dm_text(
    config: dict | None,
    *,
    recipient_id: str,
    text: str,
    kind: Literal["ig", "fb"] = "ig",
) -> tuple[bool, str | None, str | None]:
    """Отправить текст в Instagram Direct или Facebook Messenger.

    Returns: (ok, error, provider_message_id)
    """
    token = _access_token(config)
    rid = (recipient_id or "").strip()
    body_text = (text or "").strip()
    if not token:
        return False, "Нет page_access_token / Access Token в интеграции Instagram", None
    if not rid:
        return False, "Нет recipient id (IGSID/PSID) в диалоге", None
    if not body_text:
        return False, "Пустое сообщение", None

    payload: dict[str, Any] = {
        "recipient": {"id": rid},
        "message": {"text": body_text},
    }

    # Порядок попыток: для IG — сначала Instagram Graph (Login), затем Facebook Graph (Page).
    attempts: list[tuple[str, dict[str, Any]]] = []
    if kind == "ig":
        if _prefer_instagram_graph(config):
            attempts.append((f"{IG_GRAPH_BASE}/me/messages", dict(payload)))
            fb_payload = dict(payload)
            fb_payload["messaging_type"] = "RESPONSE"
            attempts.append((f"{GRAPH_BASE}/me/messages", fb_payload))
        else:
            fb_payload = dict(payload)
            fb_payload["messaging_type"] = "RESPONSE"
            attempts.append((f"{GRAPH_BASE}/me/messages", fb_payload))
            attempts.append((f"{IG_GRAPH_BASE}/me/messages", dict(payload)))
    else:
        fb_payload = dict(payload)
        fb_payload["messaging_type"] = "RESPONSE"
        attempts.append((f"{GRAPH_BASE}/me/messages", fb_payload))

    last_err: str | None = None
    async with httpx.AsyncClient(timeout=40.0) as client:
        for url, body in attempts:
            try:
                r = await client.post(url, params={"access_token": token}, json=body)
                data = r.json() if r.content else {}
                if r.status_code >= 400:
                    err_obj = data.get("error") if isinstance(data, dict) else None
                    msg = None
                    if isinstance(err_obj, dict):
                        msg = str(err_obj.get("message") or err_obj.get("error_user_msg") or "").strip()
                    last_err = msg or f"Meta HTTP {r.status_code}: {(r.text or '')[:300]}"
                    logger.warning("meta dm send failed url=%s err=%s", url, last_err)
                    continue
                mid = None
                if isinstance(data, dict):
                    mid = str(data.get("message_id") or data.get("id") or "") or None
                return True, None, mid
            except Exception as e:
                last_err = str(e)
                logger.exception("meta dm send exception url=%s", url)

    return False, last_err or "Не удалось отправить в Instagram/Messenger", None
