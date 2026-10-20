"""Локальное хранение медиа чата (входящие и исходящие)."""

from __future__ import annotations

import errno
import logging
import shutil
from pathlib import Path
import re

from app.config import settings

logger = logging.getLogger(__name__)

# Запас, чтобы том не упирался в ноль байт после записи нового файла.
_FREE_RESERVE_BYTES = 16 * 1024 * 1024
# Самые новые файлы не трогаем, даже если место всё ещё мало.
_KEEP_RECENT_FILES = 100

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


def is_no_space_error(exc: BaseException) -> bool:
    """ENOSPC и похожие ошибки квоты: диск полон, запрос ронять нельзя."""
    if not isinstance(exc, OSError):
        return False
    quota = getattr(errno, "EDQUOT", 122)
    if exc.errno in (errno.ENOSPC, quota):
        return True
    text = f"{exc.strerror or ''} {exc}".lower()
    return "no space left" in text or "disk quota" in text


def _free_bytes(path: Path) -> int | None:
    probe = path if path.exists() else path.parent
    if not probe.exists():
        return None
    try:
        return int(shutil.disk_usage(probe).free)
    except OSError:
        return None


def _same_device(left: Path, right: Path) -> bool:
    try:
        return left.stat().st_dev == right.stat().st_dev
    except OSError:
        return False


def prune_old_chat_media(media_dir: Path, *, needed_bytes: int) -> int:
    """Удаляет самые старые файлы чата, пока не хватит места. Новые оставляет. Базу не трогает."""
    if needed_bytes <= 0 or not media_dir.is_dir():
        return 0
    free = _free_bytes(media_dir)
    if free is None or free >= needed_bytes:
        return 0
    entries: list[tuple[float, Path]] = []
    try:
        children = list(media_dir.iterdir())
    except OSError:
        return 0
    for child in children:
        if child.is_symlink() or not child.is_file():
            continue
        try:
            modified = child.stat().st_mtime
        except OSError:
            continue
        entries.append((modified, child))
    if len(entries) <= _KEEP_RECENT_FILES:
        return 0
    entries.sort(key=lambda item: item[0])
    protected = {path for _mtime, path in entries[-_KEEP_RECENT_FILES:]}
    freed = 0
    for _mtime, path in entries:
        if path in protected:
            continue
        free_now = _free_bytes(media_dir)
        if free_now is not None and free_now >= needed_bytes:
            break
        try:
            size = path.stat().st_size
        except OSError:
            size = 0
        try:
            path.unlink()
        except OSError:
            continue
        freed += size
    if freed:
        logger.warning("pruned %s bytes of old chat media in %s", freed, media_dir)
    return freed


def ensure_chat_media_room(needed_bytes: int) -> int:
    """Освобождает место на томе медиа. Возвращает, сколько байт старых файлов удалено."""
    if needed_bytes <= 0:
        return 0
    primary = chat_media_directory()
    freed = prune_old_chat_media(primary, needed_bytes=needed_bytes)
    seen: set[Path] = set()
    if primary.exists():
        seen.add(primary.resolve())
    probe = primary if primary.exists() else primary.parent
    for extra in _media_search_directories():
        if not extra.is_dir():
            continue
        resolved = extra.resolve()
        if resolved in seen:
            continue
        seen.add(resolved)
        if probe.exists() and not _same_device(extra, probe):
            continue
        freed += prune_old_chat_media(extra, needed_bytes=needed_bytes)
    return freed


def _discard_partial(target: Path) -> None:
    try:
        target.unlink(missing_ok=True)
    except OSError:
        pass


def _try_write(target: Path, content: bytes) -> OSError | None:
    try:
        target.write_bytes(content)
    except OSError as exc:
        _discard_partial(target)
        if is_no_space_error(exc):
            return exc
        raise
    return None


def save_outgoing_chat_media(
    message_id: int,
    filename: str | None,
    content: bytes,
    *,
    mime: str | None = None,
) -> str | None:
    return save_chat_media(message_id, filename, content, mime=mime)


def save_chat_media(
    message_id: int,
    filename: str | None,
    content: bytes,
    *,
    mime: str | None = None,
) -> str | None:
    """Пишет файл чата. При полном диске старые медиа удаляются; если места всё равно нет — None, без исключения."""
    media_dir = chat_media_directory()
    try:
        media_dir.mkdir(parents=True, exist_ok=True)
    except OSError as exc:
        if is_no_space_error(exc):
            logger.warning("chat media dir not created message_id=%s: %s", message_id, exc)
            return None
        raise
    ext = _normalize_ext(filename, mime)
    target = media_dir / f"{message_id}{ext}"
    needed = len(content) + _FREE_RESERVE_BYTES
    ensure_chat_media_room(needed)
    err = _try_write(target, content)
    if err is not None:
        ensure_chat_media_room(needed)
        err = _try_write(target, content)
    if err is not None:
        logger.warning(
            "chat media not saved message_id=%s bytes=%s errno=%s: %s",
            message_id,
            len(content),
            err.errno,
            err,
        )
        return None
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
