"""Роли клиники: Куратор, Администратор, Бухгалтер — матрица доступов."""

from __future__ import annotations

from app.models import UserRole
from app.services.booking_directions import is_course_like_direction_name

# Чаты + канбан + онлайн-запись + KPI
ADMINISTRATOR_ROLES = frozenset({UserRole.administrator})

# Онлайн-запись + дебиторка только курсы/протоколы
CURATOR_ROLES = frozenset({UserRole.curator})

# Финансы (отчёт компании) + расходы
ACCOUNTANT_ROLES = frozenset({UserRole.accountant})


def is_administrator(role: UserRole) -> bool:
    return role == UserRole.administrator


def is_curator(role: UserRole) -> bool:
    return role == UserRole.curator


def can_access_booking(role: UserRole) -> bool:
    return role in (
        UserRole.owner,
        UserRole.super_owner,
        UserRole.admin,
        UserRole.administrator,
        UserRole.manager,
        UserRole.expert,
        UserRole.curator,
    )


def can_access_kpi(role: UserRole) -> bool:
    return role in (
        UserRole.owner,
        UserRole.super_owner,
        UserRole.admin,
        UserRole.administrator,
        UserRole.manager,
    )


def can_access_debtors(role: UserRole) -> bool:
    return role in (
        UserRole.owner,
        UserRole.super_owner,
        UserRole.admin,
        UserRole.administrator,
        UserRole.curator,
    )


def can_access_company_report(role: UserRole) -> bool:
    return role in (
        UserRole.owner,
        UserRole.super_owner,
        UserRole.accountant,
    )


def can_access_expenses(role: UserRole) -> bool:
    return role in (
        UserRole.owner,
        UserRole.super_owner,
        UserRole.accountant,
        UserRole.admin,
    )


def can_access_kanban(role: UserRole) -> bool:
    return role in (
        UserRole.owner,
        UserRole.super_owner,
        UserRole.admin,
        UserRole.administrator,
        UserRole.expert,
    )


def can_access_all_chats(role: UserRole) -> bool:
    return role in (
        UserRole.owner,
        UserRole.super_owner,
        UserRole.admin,
        UserRole.administrator,
        UserRole.manager,
    )


def debtors_course_protocol_only(role: UserRole) -> bool:
    """Куратор видит только долги по курсам и протоколам."""
    return role == UserRole.curator


def is_course_or_protocol_indicator(name: str | None) -> bool:
    return is_course_like_direction_name(name)
