"""Заготовка модуля HoReCa (ресторан): доступ по тарифной функции horeca."""

from typing import Annotated

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import CurrentUser
from app.database import get_db

router = APIRouter(prefix="/horeca", tags=["horeca"])


@router.get("/ping")
async def ping(
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentUser,
) -> dict[str, bool]:
    _ = db
    _ = current_user
    return {"ok": True}
