"""Локальное хранение исходящих медиа для предпросмотра в CRM-чате."""

from __future__ import annotations

from pathlib import Path
import re

_ROOT = Path(__file__).resolve().parents[2]
_MEDIA_DIR = _ROOT / "uploads" / "chat_media"
_SAFE_EXT_RE = re.compile(r"^\.[a-z0-9]{1,10}$")


def _normalize_ext(filename: str | None) -> str:
    ext = (Path(filename or "file").suffix or "").lower()
    if _SAFE_EXT_RE.match(ext):
        return ext
    return ".bin"


def save_outgoing_chat_media(message_id: int, filename: str | None, content: bytes) -> str:
    return save_chat_media(message_id, filename, content)


def save_chat_media(message_id: int, filename: str | None, content: bytes) -> str:
    _MEDIA_DIR.mkdir(parents=True, exist_ok=True)
    ext = _normalize_ext(filename)
    target = _MEDIA_DIR / f"{message_id}{ext}"
    target.write_bytes(content)
    return f"/api/chat/messages/{message_id}/media"


def local_media_exists(message_id: int) -> bool:
    return resolve_chat_media(message_id) is not None


def resolve_outgoing_chat_media(message_id: int) -> Path | None:
    return resolve_chat_media(message_id)


def resolve_chat_media(message_id: int) -> Path | None:
    if not _MEDIA_DIR.exists():
        return None
    matches = sorted(_MEDIA_DIR.glob(f"{message_id}.*"))
    return matches[0] if matches else None
