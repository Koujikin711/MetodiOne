"""Кто может быть ответственным за запись / лид при онлайн-записи."""

from app.models import UserRole


def can_be_booking_responsible(role: UserRole | None) -> bool:
    """Менеджер или администратор компании (не owner/expert)."""
    return role in (UserRole.manager, UserRole.admin, UserRole.administrator)
