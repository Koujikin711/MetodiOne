"""Локальное хранение фото дневника куратора (Amvera /app/data или uploads/)."""

from __future__ import annotations

import re
from pathlib import Path

_ROOT = Path(__file__).resolve().parents[2]
_SAFE_EXT_RE = re.compile(r"^\.[a-z0-9]{1,10}$")

_MIME_EXT: dict[str, str] = {
    "image/jpeg": ".jpg",
    "image/jpg": ".jpg",
    "image/png": ".png",
    "image/webp": ".webp",
    "image/gif": ".gif",
    "image/heic": ".heic",
    "image/heif": ".heif",
}


def curator_journal_media_directory() -> Path:
    amvera = Path("/app/data/curator_journal")
    if amvera.parent.is_dir():
        return amvera
    return _ROOT / "uploads" / "curator_journal"


def _normalize_ext(filename: str | None, mime: str | None = None) -> str:
    ext = (Path(filename or "photo").suffix or "").lower()
    if _SAFE_EXT_RE.match(ext):
        return ext
    m = (mime or "").split(";")[0].strip().lower()
    if m in _MIME_EXT:
        return _MIME_EXT[m]
    if m.startswith("image/"):
        return ".jpg"
    return ".bin"


def save_curator_photo(
    entry_id: int,
    filename: str | None,
    content: bytes,
    *,
    mime: str | None = None,
) -> tuple[str, str]:
    """Сохранить фото; вернуть (relative_name, mime)."""
    if not content:
        raise ValueError("Пустой файл")
    if len(content) > 12 * 1024 * 1024:
        raise ValueError("Фото больше 12 МБ")
    mime_norm = (mime or "image/jpeg").split(";")[0].strip().lower() or "image/jpeg"
    if not mime_norm.startswith("image/"):
        raise ValueError("Можно загружать только изображения")
    ext = _normalize_ext(filename, mime_norm)
    directory = curator_journal_media_directory()
    directory.mkdir(parents=True, exist_ok=True)
    name = f"{int(entry_id)}{ext}"
    path = directory / name
    path.write_bytes(content)
    return name, mime_norm


def resolve_curator_photo(relative_name: str | None) -> Path | None:
    if not relative_name:
        return None
    safe = Path(relative_name).name
    if safe != relative_name or ".." in safe:
        return None
    path = curator_journal_media_directory() / safe
    if path.is_file():
        return path
    legacy = _ROOT / "uploads" / "curator_journal" / safe
    if legacy.is_file():
        return legacy
    return None


def delete_curator_photo(relative_name: str | None) -> None:
    path = resolve_curator_photo(relative_name)
    if path is not None and path.is_file():
        try:
            path.unlink()
        except OSError:
            pass
