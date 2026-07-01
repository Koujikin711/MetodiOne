"""Локальное хранение медиа чата (входящие и исходящие)."""

from __future__ import annotations

from pathlib import Path
import re

from app.config import settings

_ROOT = Path(__file__).resolve().parents[2]
_SAFE_EXT_RE = re.compile(r"^\.[a-z0-9]{1,10}$")

_MIME_EXT: dict[str, str] = {
    "audio/mpeg": ".mp3",
    "audio/mp3": ".mp3",
    "audio/ogg": ".ogg",
    "audio/opus": ".ogg",
    "audio/webm": ".webm",
    "audio/mp4": ".m4a",
    "audio/aac": ".aac",
    "audio/amr": ".amr",
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/webp": ".webp",
    "image/gif": ".gif",
    "video/mp4": ".mp4",
    "video/webm": ".webm",
    "application/pdf": ".pdf",
}


def _media_search_directories() -> list[Path]:
    """Основной каталог + legacy uploads/chat_media (файлы до persistent volume)."""
    primary = chat_media_directory()
    dirs = [primary]
    legacy = _ROOT / "uploads" / "chat_media"
    if legacy.resolve() != primary.resolve():
        dirs.append(legacy)
    return dirs


def chat_media_directory() -> Path:
    """Путь к медиа: CHAT_MEDIA_DIR, /app/data/chat_media (Amvera), или uploads/chat_media локально."""
    configured = (settings.chat_media_dir or "").strip()
    if configured:
        return Path(configured)
    amvera = Path("/app/data/chat_media")
    if amvera.parent.is_dir():
        return amvera
    return _ROOT / "uploads" / "chat_media"


def _normalize_ext(filename: str | None, mime: str | None = None) -> str:
    ext = (Path(filename or "file").suffix or "").lower()
    if _SAFE_EXT_RE.match(ext):
        return ext
    m = (mime or "").split(";")[0].strip().lower()
    if m in _MIME_EXT:
        return _MIME_EXT[m]
    if m.startswith("audio/"):
        return ".mp3" if "mpeg" in m or "mp3" in m else ".ogg"
    if m.startswith("image/"):
        return ".jpg"
    if m.startswith("video/"):
        return ".mp4"
    return ".bin"


def save_outgoing_chat_media(
    message_id: int,
    filename: str | None,
    content: bytes,
    *,
    mime: str | None = None,
) -> str:
    return save_chat_media(message_id, filename, content, mime=mime)


def save_chat_media(
    message_id: int,
    filename: str | None,
    content: bytes,
    *,
    mime: str | None = None,
) -> str:
    media_dir = chat_media_directory()
    media_dir.mkdir(parents=True, exist_ok=True)
    ext = _normalize_ext(filename, mime)
    target = media_dir / f"{message_id}{ext}"
    target.write_bytes(content)
    return f"/api/chat/messages/{message_id}/media"


def local_media_exists(message_id: int) -> bool:
    return resolve_chat_media(message_id) is not None


def resolve_outgoing_chat_media(message_id: int) -> Path | None:
    return resolve_chat_media(message_id)


def resolve_chat_media(message_id: int) -> Path | None:
    for media_dir in _media_search_directories():
        if not media_dir.exists():
            continue
        matches = sorted(media_dir.glob(f"{message_id}.*"))
        if matches:
            return matches[0]
    return None
