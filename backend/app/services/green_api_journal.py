"""Запросы к журналу сообщений Green API."""

from __future__ import annotations

import logging
from typing import Any

import httpx

from app.services.green_api_settings import green_api_base_from_config

logger = logging.getLogger(__name__)


def _green_credentials(config: dict | None) -> tuple[str, str, str]:
    cfg = config or {}
    instance_id = str(cfg.get("instance_id") or cfg.get("instanceId") or "").strip()
    api_token = str(cfg.get("api_token") or cfg.get("apiToken") or cfg.get("apiTokenInstance") or "").strip()
    base = green_api_base_from_config(cfg)
    return instance_id, api_token, base


async def fetch_last_incoming_messages(config: dict | None, *, minutes: int) -> tuple[list[dict[str, Any]], str | None]:
    instance_id, api_token, base = _green_credentials(config)
    if not instance_id or not api_token:
        return [], "Нет instance_id/api_token в интеграции"
    url = f"{base}/waInstance{instance_id}/lastIncomingMessages/{api_token}"
    try:
        async with httpx.AsyncClient(timeout=60.0) as client:
            r = await client.get(url, params={"minutes": max(1, int(minutes))})
            if r.status_code >= 400:
                return [], f"GREEN API HTTP {r.status_code}: {(r.text or '')[:300]}"
            data = r.json()
            if isinstance(data, list):
                return data, None
            if isinstance(data, dict) and "data" in data and isinstance(data["data"], list):
                return data["data"], None
            return [], f"Неожиданный ответ lastIncomingMessages: {str(data)[:200]}"
    except Exception as e:
        logger.exception("fetch_last_incoming_messages failed")
        return [], str(e)


async def fetch_chat_history(
    config: dict | None,
    *,
    chat_id: str,
    count: int = 100,
) -> tuple[list[dict[str, Any]], str | None]:
    instance_id, api_token, base = _green_credentials(config)
    if not instance_id or not api_token:
        return [], "Нет instance_id/api_token в интеграции"
    url = f"{base}/waInstance{instance_id}/getChatHistory/{api_token}"
    body = {"chatId": chat_id, "count": max(1, min(int(count), 500))}
    try:
        async with httpx.AsyncClient(timeout=60.0) as client:
            r = await client.post(url, json=body)
            if r.status_code >= 400:
                return [], f"GREEN API HTTP {r.status_code}: {(r.text or '')[:300]}"
            data = r.json()
            if isinstance(data, list):
                return data, None
            if isinstance(data, dict) and "data" in data and isinstance(data["data"], list):
                return data["data"], None
            return [], f"Неожиданный ответ getChatHistory: {str(data)[:200]}"
    except Exception as e:
        logger.exception("fetch_chat_history failed chat_id=%s", chat_id)
        return [], str(e)
