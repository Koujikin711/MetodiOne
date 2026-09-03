"""Скачивание входящих файлов из Green API (downloadFile + CDN)."""

from __future__ import annotations

import logging
from typing import Any

import httpx

from app.services.green_api_settings import green_api_base_from_config

logger = logging.getLogger(__name__)


def _credentials(config: dict | None) -> tuple[str, str, str]:
    cfg = config or {}
    instance_id = str(cfg.get("instance_id") or cfg.get("instanceId") or "").strip()
    api_token = str(cfg.get("api_token") or cfg.get("apiToken") or cfg.get("apiTokenInstance") or "").strip()
    return instance_id, api_token, green_api_base_from_config(cfg)


def _is_green_download_endpoint(url: str) -> bool:
    low = (url or "").lower()
    return "downloadfile" in low and ("green-api" in low or "greenapi" in low)


async def resolve_green_file_download_url(
    config: dict | None,
    *,
    chat_id: str,
    id_message: str | None,
    download_url: str | None,
) -> str | None:
    """Получить прямую ссылку на файл (CDN). Green API downloadFile — это POST, не GET."""
    direct = (download_url or "").strip()
    if direct and not _is_green_download_endpoint(direct):
        return direct
    if not chat_id or not id_message:
        return direct or None
    instance_id, api_token, base = _credentials(config)
    if not instance_id or not api_token:
        return direct or None
    url = f"{base}/waInstance{instance_id}/downloadFile/{api_token}"
    body: dict[str, Any] = {"chatId": chat_id, "idMessage": id_message}
    try:
        async with httpx.AsyncClient(timeout=12.0) as client:
            r = await client.post(url, json=body)
            if r.status_code >= 400:
                logger.warning("green downloadFile HTTP %s chat=%s msg=%s", r.status_code, chat_id, id_message)
                return direct or None
            data = r.json() if r.text else {}
            resolved = str(data.get("downloadUrl") or "").strip()
            return resolved or direct or None
    except Exception as e:
        logger.exception("green downloadFile failed chat=%s msg=%s: %s", chat_id, id_message, e)
        return direct or None


async def fetch_url_bytes(url: str) -> tuple[bytes | None, str | None]:
    try:
        async with httpx.AsyncClient(timeout=20.0, follow_redirects=True) as client:
            r = await client.get(url)
            if r.status_code >= 400:
                return None, None
            mime = (r.headers.get("content-type") or "").split(";")[0].strip() or None
            return r.content, mime
    except Exception as e:
        logger.exception("fetch_url_bytes failed url=%s: %s", url[:120], e)
        return None, None


async def download_green_incoming_media(
    config: dict | None,
    *,
    chat_id: str,
    id_message: str | None,
    download_url: str | None,
) -> tuple[bytes | None, str | None]:
    resolved = await resolve_green_file_download_url(
        config,
        chat_id=chat_id,
        id_message=id_message,
        download_url=download_url,
    )
    if not resolved:
        return None, None
    return await fetch_url_bytes(resolved)
