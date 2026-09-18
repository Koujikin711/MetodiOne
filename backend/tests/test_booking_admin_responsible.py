"""Админ при записи: ответственный из CRM или сам админ."""

from app.models import UserRole
from app.services.booking_responsible import can_be_booking_responsible


def test_manager_and_admin_can_be_responsible():
    assert can_be_booking_responsible(UserRole.manager)
    assert can_be_booking_responsible(UserRole.admin)


def test_owner_expert_cannot_be_responsible():
    assert not can_be_booking_responsible(UserRole.owner)
    assert not can_be_booking_responsible(UserRole.expert)
    assert not can_be_booking_responsible(None)
