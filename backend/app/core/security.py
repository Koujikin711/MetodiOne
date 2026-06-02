from datetime import UTC, datetime, timedelta

import bcrypt
from jose import jwt

from app.config import settings
from app.models import User

_BCRYPT_ROUNDS = 12


def verify_password(plain: str, hashed: str) -> bool:
    try:
        return bcrypt.checkpw(plain.encode("utf-8"), hashed.encode("utf-8"))
    except ValueError:
        return False


def hash_password(password: str) -> str:
    salt = bcrypt.gensalt(rounds=_BCRYPT_ROUNDS)
    return bcrypt.hashpw(password.encode("utf-8"), salt).decode("utf-8")


def jwt_claims_for_user(
    user: User,
    *,
    company_id: int | None = None,
    impersonated_by: int | None = None,
) -> dict:
    """Поля JWT для пользователя (роль, компания, смена пароля, режим поддержки)."""
    claims: dict = {
        "role": user.role.value,
        "must_change_password": bool(getattr(user, "must_change_password", False)),
    }
    cid = company_id if company_id is not None else user.company_id
    if cid is not None:
        claims["company_id"] = int(cid)
    if impersonated_by is not None:
        claims["impersonated_by"] = int(impersonated_by)
    return claims


def create_access_token(subject: str, extra: dict | None = None) -> str:
    expire = datetime.now(UTC) + timedelta(minutes=settings.access_token_expire_minutes)
    to_encode = {"sub": subject, "exp": expire}
    if extra:
        to_encode.update(extra)
    return jwt.encode(to_encode, settings.secret_key, algorithm=settings.algorithm)


def decode_token(token: str) -> dict:
    return jwt.decode(token, settings.secret_key, algorithms=[settings.algorithm])


def jwt_subject(payload: dict) -> str | None:
    sub = payload.get("sub")
    return str(sub) if sub is not None else None
