"""Роли клиники: Куратор, Администратор, Бухгалтер — матрица доступов."""

from __future__ import annotations

from app.models import UserRole
from app.services.booking_directions import is_course_like_direction_name

# Онлайн-запись + доп. услуги + журнал куратора
ADMINISTRATOR_ROLES = frozenset({UserRole.administrator})

# Онлайн-запись + дебиторка только курсы/протоколы
CURATOR_ROLES = frozenset({UserRole.curator})

# Расходы, чаты, канбан, запись, KPI, журнал, сотрудники
ACCOUNTANT_ROLES = frozenset({UserRole.accountant})


def is_administrator(role: UserRole) -> bool:
    return role == UserRole.administrator


def is_curator(role: UserRole) -> bool:
    return role == UserRole.curator


def expert_also_curator(user) -> bool:
    """Эксперт, которому на той же учётке включили должность куратора."""
    role = getattr(user, "role", None)
    return role == UserRole.expert and bool(getattr(user, "also_curator", False))


def admin_also_expert(user) -> bool:
    """Админ или администратор, которому на той же учётке открыто окно эксперта."""
    role = getattr(user, "role", None)
    return role in (UserRole.admin, UserRole.administrator) and bool(getattr(user, "also_expert", False))


def can_access_booking(role: UserRole) -> bool:
    return role in (
        UserRole.owner,
        UserRole.super_owner,
        UserRole.admin,
        UserRole.administrator,
        UserRole.manager,
        UserRole.expert,
        UserRole.curator,
        UserRole.accountant,
    )


def can_access_kpi(role: UserRole) -> bool:
    return role in (
        UserRole.owner,
        UserRole.super_owner,
        UserRole.admin,
        UserRole.manager,
        UserRole.rop,
        UserRole.accountant,
    )


def can_access_debtors(role: UserRole) -> bool:
    return role in (
        UserRole.owner,
        UserRole.super_owner,
        UserRole.admin,
        UserRole.curator,
        UserRole.rop,
        UserRole.accountant,
    )


def can_access_company_report(role: UserRole) -> bool:
    return role in (
        UserRole.owner,
        UserRole.super_owner,
        UserRole.rop,
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
        UserRole.expert,
        UserRole.accountant,
    )


def can_access_all_chats(role: UserRole) -> bool:
    return role in (
        UserRole.owner,
        UserRole.super_owner,
        UserRole.admin,
        UserRole.manager,
        UserRole.accountant,
    )


def debtors_course_protocol_only(role: UserRole) -> bool:
    """Куратор видит только долги по курсам и протоколам."""
    return role == UserRole.curator


def can_access_curator_journal(role: UserRole) -> bool:
    """Журнал куратора / табель потока: админы + куратор + бухгалтер."""
    return role in (
        UserRole.owner,
        UserRole.super_owner,
        UserRole.admin,
        UserRole.administrator,
        UserRole.curator,
        UserRole.accountant,
    )


def can_access_employees(role: UserRole) -> bool:
    """Сотрудники: владелец, админ воронки, бухгалтер."""
    return role in (
        UserRole.owner,
        UserRole.super_owner,
        UserRole.admin,
        UserRole.accountant,
    )


def can_access_rop(role: UserRole) -> bool:
    """Кабинет РОП: сам РОП + владелец для контроля."""
    return role in (
        UserRole.rop,
        UserRole.owner,
        UserRole.super_owner,
    )


def is_rop(role: UserRole) -> bool:
    return role == UserRole.rop


def is_course_or_protocol_indicator(name: str | None) -> bool:
    return is_course_like_direction_name(name)
