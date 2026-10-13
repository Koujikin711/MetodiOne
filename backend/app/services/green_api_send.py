"""Исходящие сообщения в Green API (текст и файлы)."""

from __future__ import annotations

import json
from typing import Any
from urllib import error as urlerror
from urllib import request as urlrequest

import httpx

from app.services.green_api_settings import green_api_base_from_config, green_media_base_from_config


def _via_qr_file(
    chat_id: str,
    file_bytes: bytes,
    filename: str,
    caption: str,
    mime: str | None,
    green_error: str,
) -> tuple[bool, str | None, str | None]:
    from app.services.wa_bridge_client import send_file

    ok, err, mid, down = send_file(chat_id, file_bytes, filename, caption, mime=mime)
    if ok:
        return True, None, mid
    if not down:
        return False, err or green_error, None
    return False, green_error, None


def _via_qr_text(chat_id: str, text: str, green_error: str) -> tuple[bool, str | None, str | None]:
    """Если Green API молчит, то же сообщение уходит через QR-сессию Baileys."""
    from app.services.wa_bridge_client import send_text

    ok, err, mid, down = send_text(chat_id, text)
    if ok:
        return True, None, mid
    if not down:
        return False, err or green_error, None
    return False, green_error, None


def send_green_text(config: dict | None, chat_id: str, text: str) -> tuple[bool, str | None, str | None]:
    cfg = config or {}
    instance_id = cfg.get("instance_id") or cfg.get("instanceId")
    api_token = cfg.get("api_token") or cfg.get("apiToken") or cfg.get("apiTokenInstance")
    if not instance_id or not api_token:
        return _via_qr_text(chat_id, text, "Нет instance_id/api_token в интеграции")
    base = green_api_base_from_config(cfg)
    url = f"{base}/waInstance{instance_id}/sendMessage/{api_token}"
    body = json.dumps({"chatId": chat_id, "message": text}).encode("utf-8")
    req = urlrequest.Request(url, data=body, method="POST", headers={"Content-Type": "application/json"})
    try:
        with urlrequest.urlopen(req, timeout=40) as resp:
            raw = resp.read().decode("utf-8") if resp else ""
            data = json.loads(raw) if raw else {}
            return True, None, str(data.get("idMessage") or "")
    except urlerror.HTTPError as e:
        return _via_qr_text(chat_id, text, f"GREEN API HTTP {e.code}")
    except Exception as e:
        return _via_qr_text(chat_id, text, str(e))


async def send_green_text_async(config: dict | None, chat_id: str, text: str) -> tuple[bool, str | None, str | None]:
    cfg = config or {}
    instance_id = cfg.get("instance_id") or cfg.get("instanceId")
    api_token = cfg.get("api_token") or cfg.get("apiToken") or cfg.get("apiTokenInstance")
    if not instance_id or not api_token:
        return _via_qr_text(chat_id, text, "Нет instance_id/api_token в интеграции")
    base = green_api_base_from_config(cfg)
    url = f"{base}/waInstance{instance_id}/sendMessage/{api_token}"
    body: dict[str, Any] = {"chatId": chat_id, "message": text}
    try:
        async with httpx.AsyncClient(timeout=40.0) as client:
            r = await client.post(url, json=body)
            if r.status_code >= 400:
                return _via_qr_text(chat_id, text, f"GREEN API HTTP {r.status_code}")
            data = r.json() if r.text else {}
            return True, None, str(data.get("idMessage") or "")
    except Exception as e:
        return _via_qr_text(chat_id, text, str(e))


async def send_green_file_upload(
    config: dict | None,
    chat_id: str,
    file_bytes: bytes,
    filename: str,
    caption: str,
) -> tuple[bool, str | None, str | None]:
    cfg = config or {}
    instance_id = cfg.get("instance_id") or cfg.get("instanceId")
    api_token = cfg.get("api_token") or cfg.get("apiToken") or cfg.get("apiTokenInstance")
    if not instance_id or not api_token:
        return _via_qr_file(chat_id, file_bytes, filename, caption, None, "Нет instance_id/api_token в интеграции")
    media_base = green_media_base_from_config(cfg)
    url = f"{media_base}/waInstance{instance_id}/sendFileByUpload/{api_token}"
    try:
        async with httpx.AsyncClient(timeout=120.0) as client:
            files = {"file": (filename, file_bytes)}
            data: dict[str, Any] = {"chatId": chat_id, "caption": caption or ""}
            r = await client.post(url, data=data, files=files)
            if r.status_code >= 400:
                return _via_qr_file(chat_id, file_bytes, filename, caption, None, (r.text or "")[:400])
            j = r.json()
            return True, None, str(j.get("idMessage") or "")
    except Exception as e:
        return _via_qr_file(chat_id, file_bytes, filename, caption, None, str(e))
