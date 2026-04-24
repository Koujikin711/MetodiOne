"""Исходящие сообщения в Green API (текст и файлы)."""

from __future__ import annotations

import json
from typing import Any
from urllib import error as urlerror
from urllib import request as urlrequest

import httpx

from app.services.green_api_settings import green_api_base_from_config, green_media_base_from_config


def send_green_text(config: dict | None, chat_id: str, text: str) -> tuple[bool, str | None, str | None]:
    cfg = config or {}
    instance_id = cfg.get("instance_id") or cfg.get("instanceId")
    api_token = cfg.get("api_token") or cfg.get("apiToken") or cfg.get("apiTokenInstance")
    if not instance_id or not api_token:
        return False, "Нет instance_id/api_token в интеграции", None
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
        return False, f"GREEN API HTTP {e.code}", None
    except Exception as e:
        return False, str(e), None


async def send_green_text_async(config: dict | None, chat_id: str, text: str) -> tuple[bool, str | None, str | None]:
    cfg = config or {}
    instance_id = cfg.get("instance_id") or cfg.get("instanceId")
    api_token = cfg.get("api_token") or cfg.get("apiToken") or cfg.get("apiTokenInstance")
    if not instance_id or not api_token:
        return False, "Нет instance_id/api_token в интеграции", None
    base = green_api_base_from_config(cfg)
    url = f"{base}/waInstance{instance_id}/sendMessage/{api_token}"
    body: dict[str, Any] = {"chatId": chat_id, "message": text}
    try:
        async with httpx.AsyncClient(timeout=40.0) as client:
            r = await client.post(url, json=body)
            if r.status_code >= 400:
                return False, f"GREEN API HTTP {r.status_code}", None
            data = r.json() if r.text else {}
            return True, None, str(data.get("idMessage") or "")
    except Exception as e:
        return False, str(e), None


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
        return False, "Нет instance_id/api_token в интеграции", None
    media_base = green_media_base_from_config(cfg)
    url = f"{media_base}/waInstance{instance_id}/sendFileByUpload/{api_token}"
    try:
        async with httpx.AsyncClient(timeout=120.0) as client:
            files = {"file": (filename, file_bytes)}
            data: dict[str, Any] = {"chatId": chat_id, "caption": caption or ""}
            r = await client.post(url, data=data, files=files)
            if r.status_code >= 400:
                return False, (r.text or "")[:400], None
            j = r.json()
            return True, None, str(j.get("idMessage") or "")
    except Exception as e:
        return False, str(e), None
