"""Клиент сайдкара Baileys. Логика как в qatrai-hayot/src/lib/waBridgeClient.ts."""

from __future__ import annotations

import json
import os
from typing import Any
from urllib import error as urlerror
from urllib import request as urlrequest

from app.services.wa_bridge_process import bridge_token, data_root


def bridge_base() -> str:
    return (os.environ.get("WA_BRIDGE_URL") or "http://127.0.0.1:8766").rstrip("/")


def _empty_status() -> dict[str, Any]:
    return {
        "reachable": False,
        "ready": False,
        "phone": None,
        "name": None,
        "connectionState": "DOWN",
        "qrDataUrl": None,
        "error": None,
    }


def fetch_status() -> dict[str, Any]:
    try:
        req = urlrequest.Request(f"{bridge_base()}/status", method="GET")
        with urlrequest.urlopen(req, timeout=2.5) as resp:
            raw = resp.read().decode("utf-8")
        data = json.loads(raw) if raw else {}
        if not isinstance(data, dict):
            return _empty_status()
        err = data.get("error")
        return {
            "reachable": True,
            "ready": bool(data.get("ready")),
            "phone": data.get("phone") or None,
            "name": data.get("name") or None,
            "connectionState": str(data.get("connectionState") or "INIT"),
            "qrDataUrl": data.get("qrDataUrl") or None,
            "error": str(err)[:180] if err else None,
        }
    except Exception:
        return _empty_status()


def restart_bridge() -> tuple[bool, str | None]:
    try:
        body = b"{}"
        req = urlrequest.Request(
            f"{bridge_base()}/restart",
            data=body,
            method="POST",
            headers={"Content-Type": "application/json"},
        )
        with urlrequest.urlopen(req, timeout=8) as resp:
            raw = resp.read().decode("utf-8")
        data = json.loads(raw) if raw else {}
        if isinstance(data, dict) and data.get("ok") is False:
            return False, str(data.get("error") or "Мост WhatsApp недоступен")[:180]
        return True, None
    except urlerror.HTTPError as exc:
        detail = "Мост WhatsApp недоступен"
        try:
            payload = json.loads(exc.read().decode("utf-8") or "{}")
            if isinstance(payload, dict) and payload.get("error"):
                detail = str(payload["error"])[:180]
        except Exception:
            detail = f"HTTP {exc.code}"
        return False, detail
    except Exception:
        return False, "Мост WhatsApp недоступен"


def _post(path: str, payload: dict[str, Any], timeout: float) -> tuple[bool, str | None, str | None, bool]:
    """ok, error, message_id, down."""
    try:
        raw_body = json.dumps(payload).encode("utf-8")
        req = urlrequest.Request(
            f"{bridge_base()}{path}",
            data=raw_body,
            method="POST",
            headers={"Content-Type": "application/json"},
        )
        with urlrequest.urlopen(req, timeout=timeout) as resp:
            raw = resp.read().decode("utf-8")
        data = json.loads(raw) if raw else {}
        if not isinstance(data, dict):
            data = {}
        if data.get("ok") is False:
            return False, str(data.get("error") or "QR")[:180], None, False
        mid = data.get("messageId")
        return True, None, str(mid) if mid else None, False
    except urlerror.HTTPError as exc:
        down = exc.code == 503
        detail = "WhatsApp QR не подключён" if down else f"QR HTTP {exc.code}"
        try:
            payload = json.loads(exc.read().decode("utf-8") or "{}")
            if isinstance(payload, dict) and payload.get("error"):
                detail = str(payload["error"])[:180]
        except Exception:
            pass
        return False, detail, None, down
    except Exception:
        return False, "Мост WhatsApp недоступен", None, True


def send_text(chat_id: str, text: str) -> tuple[bool, str | None, str | None, bool]:
    if not (text or "").strip():
        return False, "Пустое сообщение", None, False
    return _post("/send", {"chatId": chat_id, "message": text}, 20)


def send_file(
    chat_id: str,
    file_bytes: bytes,
    filename: str,
    caption: str,
    *,
    mime: str | None = None,
) -> tuple[bool, str | None, str | None, bool]:
    root = data_root()
    root.mkdir(parents=True, exist_ok=True)
    safe = "".join(ch if ch.isalnum() or ch in "._-" else "_" for ch in (filename or "file"))[:80] or "file"
    target = root / "wa-outgoing" / safe
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_bytes(file_bytes)
    kind = "image" if (mime or "").startswith("image/") else "file"
    if (mime or "").startswith("audio/"):
        kind = "audio"
    return _post(
        "/send",
        {
            "chatId": chat_id,
            "message": caption or "",
            "mediaPath": str(target),
            "mediaKind": kind,
            "mimeType": mime or "application/octet-stream",
            "fileName": filename or safe,
        },
        45,
    )


def token_matches(got: str | None) -> bool:
    import hmac

    expected = bridge_token()
    if not expected or not got:
        return False
    return hmac.compare_digest(expected, got)
