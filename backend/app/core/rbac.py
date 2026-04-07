"""Роли: owner (владелец), admin (админ воронки), manager, expert."""

from app.models import UserRole


def is_owner(role: UserRole) -> bool:
    return role == UserRole.owner


def is_manager_like(role: UserRole) -> bool:
    """Менеджер или админ воронки — одни и те же ограничения по лидам/воронкам."""
    return role in (UserRole.manager, UserRole.admin)
