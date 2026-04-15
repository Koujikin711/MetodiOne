"""Подготовка аудио для отправки в WhatsApp через Green API (форматы без webm)."""

from __future__ import annotations

import asyncio
import logging
import os
import tempfile
import uuid

logger = logging.getLogger(__name__)


async def _webm_to_ogg_opus(webm_bytes: bytes) -> bytes:
    tmp = tempfile.gettempdir()
    uid = uuid.uuid4().hex
    path_in = os.path.join(tmp, f"crm-voice-{uid}.webm")
    path_out = os.path.join(tmp, f"crm-voice-{uid}.ogg")
    try:
        with open(path_in, "wb") as f:
            f.write(webm_bytes)
        proc = await asyncio.create_subprocess_exec(
            "ffmpeg",
            "-y",
            "-hide_banner",
            "-loglevel",
            "error",
            "-i",
            path_in,
            "-vn",
            "-c:a",
            "libopus",
            "-b:a",
            "48k",
            path_out,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        _stdout, stderr = await proc.communicate()
        if proc.returncode != 0:
            err = (stderr or b"").decode("utf-8", errors="replace")[:800]
            raise RuntimeError(err or f"ffmpeg exit {proc.returncode}")
        with open(path_out, "rb") as f:
            return f.read()
    finally:
        for p in (path_in, path_out):
            try:
                os.unlink(p)
            except OSError:
                pass


async def prepare_file_for_green_whatsapp(
    file_bytes: bytes,
    filename: str,
    content_type: str | None,
) -> tuple[bytes, str]:
    """
    Green / WhatsApp для голоса ожидают ogg/mp3/m4a/…, а не webm с браузера.
    Конвертируем только явные голосовые / audio/webm, не видео-вложения .webm.
    """
    low = (filename or "file").lower()
    if not low.endswith(".webm"):
        return file_bytes, filename
    ct = (content_type or "").lower()
    voice_named = low.startswith("voice-")
    audio_like = ct.startswith("audio/") and "video" not in ct
    if not (voice_named or audio_like):
        return file_bytes, filename
    try:
        out = await _webm_to_ogg_opus(file_bytes)
    except FileNotFoundError:
        logger.error("ffmpeg not found; cannot convert voice webm")
        raise RuntimeError(
            "На сервере не найден ffmpeg — голос из браузера (WebM) нельзя перевести в формат WhatsApp. "
            "Добавьте ffmpeg в образ (Dockerfile) или установите в ОС."
        ) from None
    except Exception as e:
        logger.exception("voice webm→ogg failed")
        raise RuntimeError(f"Не удалось подготовить голосовое: {e}") from e
    if len(out) < 64:
        raise RuntimeError("После конвертации голосовое получилось пустым — запишите ещё раз.")
    base = filename.rsplit(".", 1)[0] if "." in filename else "voice"
    return out, f"{base}.ogg"
