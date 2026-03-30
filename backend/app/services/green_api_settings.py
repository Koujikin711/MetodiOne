"""Автонастройка вебхука в Green API (SetSettings), чтобы пользователю не копировать URL вручную."""

from __future__ import annotations

import json
import logging
from typing import Any
from urllib import error as urlerror
from urllib import request as urlrequest

logger = logging.getLogger(__name__)

DEFAULT_GREEN_HOST = "https://api.green-api.com"


def green_api_base_from_config(cfg: dict | None) -> str:
    if not cfg:
        return DEFAULT_GREEN_HOST
    u = cfg.get("api_base_url") or cfg.get("apiUrl") or cfg.get("green_api_host")
    if isinstance(u, str) and u.strip():
        return u.strip().rstrip("/")
    return DEFAULT_GREEN_HOST


def green_media_base_from_config(cfg: dict | None) -> str:
    """Хост для sendFileByUpload: обычно mediaUrl из кабинета или замена api→media."""
    if not cfg:
        return "https://media.green-api.com"
    u = cfg.get("media_base_url") or cfg.get("mediaUrl")
    if isinstance(u, str) and u.strip():
        return u.strip().rstrip("/")
    api = green_api_base_from_config(cfg)
    if ".api." in api:
        return api.replace(".api.", ".media.")
    if "api.green-api.com" in api:
        return api.replace("api.green-api.com", "media.green-api.com")
    if "api.greenapi.com" in api:
        return api.replace("api.greenapi.com", "media.greenapi.com")
    return "https://media.green-api.com"


def resolve_public_api_base(request: Any, env_base: str) -> str:
    """Публичный URL бэкенда для webhookUrl в Green API."""
    env = (env_base or "").strip().rstrip("/")
    if env:
        return env
    if request is None:
        return ""
    proto = request.headers.get("x-forwarded-proto") or request.url.scheme
    host = request.headers.get("x-forwarded-host") or request.headers.get("host") or ""
    host = host.split(",")[0].strip()
    if not host:
        return ""
    return f"{proto}://{host}".rstrip("/")


def push_green_incoming_webhook(
    *,
    instance_id: str,
    api_token_instance: str,
    api_base: str,
    webhook_url: str,
    webhook_token: str,
) -> tuple[bool, str]:
    """
    Вызывает SetSettings у Green API. Инстанс после этого может перезапускаться до ~5 мин.
    """
    base = api_base.rstrip("/")
    url = f"{base}/waInstance{instance_id}/setSettings/{api_token_instance}"
    body = {
        "webhookUrl": webhook_url.strip(),
        "webhookUrlToken": webhook_token,
        "incomingWebhook": "yes",
        "stateWebhook": "yes",
        "outgoingWebhook": "no",
        "outgoingMessageWebhook": "no",
        "outgoingAPIMessageWebhook": "no",
        "deviceWebhook": "no",
    }
    raw_body = json.dumps(body).encode("utf-8")
    req = urlrequest.Request(
        url,
        data=raw_body,
        method="POST",
        headers={"Content-Type": "application/json; charset=utf-8"},
    )
    try:
        with urlrequest.urlopen(req, timeout=35) as resp:
            raw = resp.read().decode("utf-8")
            data = json.loads(raw) if raw else {}
            if data.get("saveSettings") is True:
                logger.info("Green API setSettings ok instance_id=%s", instance_id)
                return True, ""
            return False, (raw or str(data))[:500]
    except urlerror.HTTPError as e:
        chunk = e.read().decode("utf-8", errors="replace")[:400]
        return False, f"HTTP {e.code}: {chunk}"
    except urlerror.URLError as e:
        return False, str(e.reason) if e.reason else str(e)
    except Exception as e:
        return False, str(e)
