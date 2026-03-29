from typing import Annotated

from pydantic import PlainValidator


def _normalize_email(v: str) -> str:
    s = v.strip().lower()
    if "@" not in s or s.count("@") != 1:
        raise ValueError("Неверный формат email")
    local, domain = s.split("@", 1)
    if not local or not domain:
        raise ValueError("Неверный формат email")
    if "." not in domain:
        raise ValueError("Неверный формат email")
    if len(s) > 320:
        raise ValueError("Email слишком длинный")
    return s


RelaxedEmailStr = Annotated[str, PlainValidator(_normalize_email)]


def _normalize_login_identifier(v: str) -> str:
    """Логин admin → тестовый аккаунт admin@crm.local; иначе обычный email."""
    s = v.strip()
    if not s:
        raise ValueError("Укажите email или логин")
    if "@" not in s:
        if s.lower() == "admin":
            return "admin@crm.local"
        raise ValueError("Укажите email или логин admin")
    return _normalize_email(s)


LoginIdentifierStr = Annotated[str, PlainValidator(_normalize_login_identifier)]
