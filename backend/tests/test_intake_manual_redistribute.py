"""Менеджер приёма: ручное создание/импорт → автораздача остальным."""

from app.models import UserRole
from app.routers.leads import _intake_should_redistribute_manual_create


def test_intake_redistributes_on_round_robin():
    assert _intake_should_redistribute_manual_create(
        role=UserRole.manager,
        intake_manager_user_id=12,
        current_user_id=12,
        lead_assignment_mode="round_robin",
    )


def test_intake_redistributes_on_least_loaded():
    assert _intake_should_redistribute_manual_create(
        role=UserRole.manager,
        intake_manager_user_id=12,
        current_user_id=12,
        lead_assignment_mode="least_loaded",
    )


def test_intake_skips_when_mode_none():
    assert not _intake_should_redistribute_manual_create(
        role=UserRole.manager,
        intake_manager_user_id=12,
        current_user_id=12,
        lead_assignment_mode="none",
    )


def test_other_manager_keeps_lead():
    assert not _intake_should_redistribute_manual_create(
        role=UserRole.manager,
        intake_manager_user_id=12,
        current_user_id=9,
        lead_assignment_mode="round_robin",
    )


def test_admin_not_intake_path():
    assert not _intake_should_redistribute_manual_create(
        role=UserRole.admin,
        intake_manager_user_id=12,
        current_user_id=12,
        lead_assignment_mode="round_robin",
    )
