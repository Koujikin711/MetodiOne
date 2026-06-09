"""Запрет утечки контактов пациентов из чата менеджерами."""

from __future__ import annotations

import re

from app.models import User, UserRole
from app.services.phone_match import phones_equivalent

_PHONE_RE = re.compile(
    r"(?:\+?\d[\d\s\-().]{8,}\d)|(?:\b\d{9,15}\b)",
    re.IGNORECASE,
)
_EMAIL_RE = re.compile(r"[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}")
_MESSENGER_RE = re.compile(r"(t\.me/|telegram\.me/|wa\.me/|whatsapp\.com/)", re.IGNORECASE)

_BLOCKED_OUTBOUND_ROLES = frozenset({UserRole.manager})


def _phones_in_text(text: str) -> list[str]:
    return [m.group(0) for m in _PHONE_RE.finditer(text)]


def _phone_is_whitelisted(phone: str, whitelist: list[str]) -> bool:
    if not whitelist:
        return False
    return any(phones_equivalent(phone, allowed) for allowed in whitelist)


def outbound_message_allowed(
    user: User,
    text: str,
    *,
    allowed_outbound_phones: list[str] | None = None,
) -> tuple[bool, str | None]:
    if user.role not in _BLOCKED_OUTBOUND_ROLES:
        return True, None
    t = (text or "").strip()
    if not t:
        return True, None

    phones = _phones_in_text(t)
    if phones:
        whitelist = allowed_outbound_phones or []
        for phone in phones:
            if not _phone_is_whitelisted(phone, whitelist):
                if whitelist:
                    return (
                        False,
                        "Нельзя отправлять этот номер. Разрешены только номера из списка в настройках воронки.",
                    )
                return False, "Нельзя отправлять номера телефонов пациентов. Общайтесь только через CRM."

    if _EMAIL_RE.search(t):
        return False, "Нельзя отправлять email пациентов в чате."
    if _MESSENGER_RE.search(t):
        return False, "Нельзя отправлять ссылки на личные мессенджеры."
    return True, None
