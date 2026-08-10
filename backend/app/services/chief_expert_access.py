"""Главный эксперт воронки (Pipeline.expert_user_id) — расширенный доступ к разделам CRM."""

from __future__ import annotations

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Pipeline, User, UserRole

_FINANCE_VIEW_ROLES = frozenset(
    {
        UserRole.owner,
        UserRole.admin,
        UserRole.super_owner,
        UserRole.finance_analyst,
        UserRole.accountant,
    },
)

_FINANCE_SETTINGS_ROLES = frozenset(
    {
        UserRole.owner,
        UserRole.admin,
        UserRole.super_owner,
        UserRole.accountant,
    },
)

async def is_chief_expert(db: AsyncSession, user: User) -> bool:
    if user.role != UserRole.expert or user.company_id is None:
        return False
    rid = await db.scalar(
        select(Pipeline.id)
        .where(
            Pipeline.company_id == int(user.company_id),
            Pipeline.expert_user_id == user.id,
        )
        .limit(1),
    )
    return rid is not None


async def assert_owner_or_chief_expert(
    db: AsyncSession,
    user: User,
    *,
    detail: str = "Только владелец или главный эксперт воронки",
) -> None:
    if user.role == UserRole.owner:
        return
    if await is_chief_expert(db, user):
        return
    raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=detail)


async def assert_owner_admin_or_chief_expert(
    db: AsyncSession,
    user: User,
    *,
    detail: str = "Недостаточно прав",
) -> None:
    if user.role in (UserRole.owner, UserRole.admin, UserRole.super_owner):
        return
    if await is_chief_expert(db, user):
        return
    raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=detail)


async def assert_finance_access(db: AsyncSession, user: User) -> None:
    if user.role in _FINANCE_VIEW_ROLES:
        return
    if await is_chief_expert(db, user):
        return
    raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Нет доступа к финансам")


async def assert_finance_settings_access(db: AsyncSession, user: User) -> None:
    if user.role in _FINANCE_SETTINGS_ROLES:
        return
    if await is_chief_expert(db, user):
        return
    raise HTTPException(
        status_code=status.HTTP_403_FORBIDDEN,
        detail="Настройки финансов доступны владельцу, бухгалтеру или главному эксперту",
    )


def is_pipeline_admin_role(role: UserRole) -> bool:
    return role in (UserRole.owner, UserRole.admin)
