from typing import Annotated

from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from jose import JWTError
from jose.exceptions import ExpiredSignatureError
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.security import decode_token, jwt_subject
from app.database import get_db
from app.models import Company, User, UserRole

security = HTTPBearer(auto_error=False)


async def get_current_user(
    credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(security)],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> User:
    if credentials is None or credentials.scheme.lower() != "bearer":
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Not authenticated",
            headers={"WWW-Authenticate": "Bearer"},
        )
    try:
        payload = decode_token(credentials.credentials)
        sub = jwt_subject(payload)
        if sub is None:
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token")
        user_id = int(sub)
    except ExpiredSignatureError:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Token expired")
    except (JWTError, ValueError):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token")

    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    if user is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="User not found")
    if not user.is_active:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Аккаунт отключён")
    setattr(user, "_jwt_payload", payload)
    return user


CurrentUser = Annotated[User, Depends(get_current_user)]


async def get_current_company_id(
    current_user: CurrentUser,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> int:
    cid: int
    if current_user.role == UserRole.super_owner:
        payload = getattr(current_user, "_jwt_payload", {}) or {}
        payload_cid = payload.get("company_id")
        if payload_cid is None:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Выберите компанию (switch context) для выполнения этого запроса",
            )
        cid = int(payload_cid)
    else:
        if current_user.company_id is None:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Пользователь не привязан к компании")
        cid = int(current_user.company_id)

    company = await db.get(Company, cid)
    if company is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Компания не найдена")
    if not company.is_active:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Компания временно приостановлена")
    return cid


CurrentCompanyId = Annotated[int, Depends(get_current_company_id)]
