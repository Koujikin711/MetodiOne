"""Права доступа к журналу куратора."""

from __future__ import annotations

from fastapi import HTTPException, status

from app.models import User, UserRole
from app.models.curator_journal import CuratorCourseFlow

_ADMIN_ROLES = frozenset(
    {
        UserRole.owner,
        UserRole.super_owner,
        UserRole.admin,
        UserRole.administrator,
    }
)


def can_access_curator_journal(role: UserRole) -> bool:
    return role in _ADMIN_ROLES or role == UserRole.curator


def can_manage_all_flows(role: UserRole) -> bool:
    return role in _ADMIN_ROLES


def _expert_curator(user: User) -> bool:
    return user.role == UserRole.expert and bool(getattr(user, "also_curator", False))


def assert_journal_access(user: User) -> None:
    if can_access_curator_journal(user.role) or _expert_curator(user):
        return
    raise HTTPException(
        status_code=status.HTTP_403_FORBIDDEN,
        detail="Нет доступа к журналу куратора",
    )


def assert_flow_readable(user: User, flow: CuratorCourseFlow) -> None:
    assert_journal_access(user)
    if can_manage_all_flows(user.role):
        return
    if user.role == UserRole.curator and flow.curator_user_id == user.id:
        return
    if _expert_curator(user) and flow.curator_user_id == user.id:
        return
    raise HTTPException(
        status_code=status.HTTP_403_FORBIDDEN,
        detail="Нет доступа к этому потоку",
    )


def assert_flow_writable(user: User, flow: CuratorCourseFlow) -> None:
    assert_flow_readable(user, flow)
    if can_manage_all_flows(user.role):
        return
    if user.role == UserRole.curator and flow.curator_user_id == user.id:
        return
    if _expert_curator(user) and flow.curator_user_id == user.id:
        return
    raise HTTPException(
        status_code=status.HTTP_403_FORBIDDEN,
        detail="Нет прав на изменение журнала",
    )


def assert_flow_admin(user: User) -> None:
    assert_journal_access(user)
    if not can_manage_all_flows(user.role):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Создание и настройка потоков доступны администратору",
        )
