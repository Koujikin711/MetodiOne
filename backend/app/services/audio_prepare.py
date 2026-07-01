"""Подготовка аудио для WhatsApp (Green API) и воспроизведения в браузере."""

from __future__ import annotations

import asyncio
import logging
import os
import tempfile
import uuid
from pathlib import Path

logger = logging.getLogger(__name__)


async def _run_ffmpeg(args: list[str]) -> None:
    proc = await asyncio.create_subprocess_exec(
        *args,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )
    _stdout, stderr = await proc.communicate()
    if proc.returncode != 0:
        err = (stderr or b"").decode("utf-8", errors="replace")[:800]
        raise RuntimeError(err or f"ffmpeg exit {proc.returncode}")


async def _webm_to_ogg_opus(webm_bytes: bytes) -> bytes:
    tmp = tempfile.gettempdir()
    uid = uuid.uuid4().hex
    path_in = os.path.join(tmp, f"crm-voice-{uid}.webm")
    path_out = os.path.join(tmp, f"crm-voice-{uid}.ogg")
    try:
        with open(path_in, "wb") as f:
            f.write(webm_bytes)
        await _run_ffmpeg(
            [
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
            ]
        )
        with open(path_out, "rb") as f:
            return f.read()
    finally:
        for p in (path_in, path_out):
            try:
                os.unlink(p)
            except OSError:
                pass


def _input_ext(filename: str | None, mime: str | None) -> str:
    ext = (Path(filename or "audio").suffix or "").lower()
    if ext in {".ogg", ".opus", ".webm", ".m4a", ".mp4", ".aac", ".amr", ".wav", ".bin"}:
        return ext
    m = (mime or "").split(";")[0].strip().lower()
    if "ogg" in m or "opus" in m:
        return ".ogg"
    if "webm" in m:
        return ".webm"
    if "mpeg" in m or "mp3" in m:
        return ".mp3"
    if "mp4" in m or "m4a" in m:
        return ".m4a"
    return ".ogg"


async def transcode_audio_to_mp3(
    audio_bytes: bytes,
    *,
    filename: str | None = None,
    mime: str | None = None,
) -> bytes:
    """Конвертация входящего аудио (OGG Opus и др.) в MP3 для Safari и старых браузеров."""
    tmp = tempfile.gettempdir()
    uid = uuid.uuid4().hex
    ext = _input_ext(filename, mime)
    path_in = os.path.join(tmp, f"crm-in-audio-{uid}{ext}")
    path_out = os.path.join(tmp, f"crm-in-audio-{uid}.mp3")
    try:
        with open(path_in, "wb") as f:
            f.write(audio_bytes)
        await _run_ffmpeg(
            [
                "ffmpeg",
                "-y",
                "-hide_banner",
                "-loglevel",
                "error",
                "-i",
                path_in,
                "-vn",
                "-c:a",
                "libmp3lame",
                "-b:a",
                "64k",
                path_out,
            ]
        )
        with open(path_out, "rb") as f:
            out = f.read()
        if len(out) < 64:
            raise RuntimeError("empty mp3 after transcode")
        return out
    finally:
        for p in (path_in, path_out):
            try:
                os.unlink(p)
            except OSError:
                pass


async def prepare_incoming_audio_for_playback(
    content: bytes,
    filename: str | None,
    mime: str | None,
) -> tuple[bytes, str, str]:
    """
    Входящие голосовые WhatsApp — часто OGG Opus; Safari не играет.
    Возвращает (bytes, filename, mime) — при успехе MP3.
    """
    low = (filename or "").lower()
    m = (mime or "").split(";")[0].strip().lower()
    is_audio = m.startswith("audio/") or low.endswith((".ogg", ".opus", ".webm", ".m4a", ".amr"))
    if not is_audio:
        return content, filename or "audio", mime or "application/octet-stream"
    if m == "audio/mpeg" or low.endswith(".mp3"):
        return content, filename or "voice.mp3", "audio/mpeg"
    try:
        mp3 = await transcode_audio_to_mp3(content, filename=filename, mime=mime)
    except FileNotFoundError:
        logger.warning("ffmpeg not found; incoming audio kept as-is")
        return content, filename or "audio", mime or "audio/ogg"
    except Exception:
        logger.exception("incoming audio transcode failed; keeping original")
        return content, filename or "audio", mime or "audio/ogg"
    base = (filename or "voice").rsplit(".", 1)[0] if filename and "." in filename else "voice"
    return mp3, f"{base}.mp3", "audio/mpeg"


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
