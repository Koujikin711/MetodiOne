"""Разбор входящих сообщений Green API (текст, фото, видео, голос, файлы)."""

from __future__ import annotations

from typing import Any

_IMAGE_EXT = (
    ".jpg",
    ".jpeg",
    ".png",
    ".gif",
    ".webp",
    ".bmp",
    ".svg",
    ".avif",
    ".heic",
    ".heif",
)


def _is_image_file(name: str, mime: str | None) -> bool:
    m = (mime or "").lower()
    if m.startswith("image/"):
        return True
    low = name.lower()
    return any(low.endswith(x) for x in _IMAGE_EXT)


def parse_green_message_data(message_data: dict[str, Any]) -> tuple[str, str, str | None, str | None, str | None]:
    """
    Возвращает: text, message_type, media_url, media_mime, file_name
    """
    if not message_data:
        return "", "text", None, None, None

    t = str(message_data.get("typeMessage") or "").lower()

    if t in ("textmessage",):
        txt = (message_data.get("textMessageData") or {}).get("textMessage") or ""
        return (txt or "").strip(), "text", None, None, None

    if t in ("extendedtextmessage",):
        txt = (message_data.get("extendedTextMessageData") or {}).get("text") or ""
        return (txt or "").strip(), "text", None, None, None

    if t in ("imagemessage", "image"):
        d = message_data.get("imageMessageData") or message_data.get("fileMessageData") or {}
        url = d.get("downloadUrl") or d.get("url")
        cap = (d.get("caption") or "").strip()
        mime = d.get("mimeType") or "image/jpeg"
        fn = d.get("fileName") or "image.jpg"
        label = cap or "📷 Фото"
        return label, "image", url, mime, fn

    if t in ("videomessage", "video"):
        d = message_data.get("videoMessageData") or message_data.get("fileMessageData") or {}
        url = d.get("downloadUrl") or d.get("url")
        cap = (d.get("caption") or "").strip()
        mime = d.get("mimeType") or "video/mp4"
        fn = d.get("fileName") or "video.mp4"
        label = cap or "🎬 Видео"
        return label, "video", url, mime, fn

    if t in ("audiomessage", "audio"):
        d = message_data.get("audioMessageData") or message_data.get("fileMessageData") or {}
        url = d.get("downloadUrl") or d.get("url")
        mime = d.get("mimeType") or "audio/ogg"
        fn = d.get("fileName") or "audio.ogg"
        return "🎵 Аудио", "audio", url, mime, fn

    if t in ("voicemessage", "voice", "ptt"):
        d = message_data.get("voiceMessageData") or message_data.get("fileMessageData") or {}
        url = d.get("downloadUrl") or d.get("url")
        mime = d.get("mimeType") or "audio/ogg"
        fn = d.get("fileName") or "voice.ogg"
        return "🎤 Голосовое сообщение", "audio", url, mime, fn

    if t in ("documentmessage", "document"):
        d = message_data.get("documentMessageData") or message_data.get("fileMessageData") or {}
        url = d.get("downloadUrl") or d.get("url")
        cap = (d.get("caption") or "").strip()
        fn = d.get("fileName") or "file"
        mime = d.get("mimeType") or "application/octet-stream"
        if _is_image_file(fn, mime):
            label = cap or "📷 Фото"
            return label, "image", url, mime, fn
        label = cap or f"📎 {fn}"
        return label, "document", url, mime, fn

    # fallback: fileMessage / прочее
    d = message_data.get("fileMessageData") or {}
    if d:
        url = d.get("downloadUrl") or d.get("url")
        cap = (d.get("caption") or "").strip()
        mime = d.get("mimeType")
        fn = d.get("fileName") or "file"
        if _is_image_file(fn, mime):
            label = cap or "📷 Фото"
            return label, "image", url, mime or "image/jpeg", fn
        label = cap or "📎 Вложение"
        return label, "document", url, mime, fn

    # текст из неизвестного типа
    txt = (
        message_data.get("extendedTextMessageData", {}).get("text")
        or message_data.get("textMessageData", {}).get("textMessage")
        or ""
    )
    return (txt or "").strip(), "text", None, None, None
