"""Роли: owner (владелец), admin (админ воронки), manager, expert."""

from app.models import UserRole


def is_owner(role: UserRole) -> bool:
    return role == UserRole.owner


def is_super_owner(role: UserRole) -> bool:
    return role == UserRole.super_owner


def is_manager_like(role: UserRole) -> bool:
    """Менеджер или админ воронки — одни и те же ограничения по лидам/воронкам."""
    return role in (UserRole.manager, UserRole.admin)


def is_lead_assignee_role(role: UserRole) -> bool:
    """Кого можно ставить ответственным за лид: только менеджер (не owner/admin)."""
    return role == UserRole.manager


def is_forbidden_lead_assignee_role(role: UserRole) -> bool:
    """Владелец и админ воронки не должны быть manager_id у лида."""
    return role in (UserRole.owner, UserRole.admin, UserRole.super_owner)
