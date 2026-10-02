"""Дата рождения: менеджер может не указывать, админ — нет."""

from datetime import UTC, datetime

from pydantic import ValidationError

from app.models import UserRole
from app.routers.booking import booking_birth_date_required
from app.schemas.booking import BookingAppointmentCreate


def _body(**extra):
    return BookingAppointmentCreate(
        patient_name="Тест",
        patient_phone="992900112233",
        specialist_id=1,
        start_at=datetime(2026, 10, 3, 6, 0, tzinfo=UTC),
        service_title="Массаж",
        service_amount=150,
        paid_amount=0,
        **extra,
    )


def test_manager_may_omit_birth_date():
    assert booking_birth_date_required(UserRole.manager) is False
    assert _body().patient_birth_date is None


def test_admin_roles_require_birth_date():
    assert booking_birth_date_required(UserRole.administrator) is True
    assert booking_birth_date_required(UserRole.admin) is True
    assert booking_birth_date_required(UserRole.owner) is True


def test_future_birth_date_rejected():
    try:
        _body(patient_birth_date="2030-01-01")
    except ValidationError:
        return
    raise AssertionError("future birth date must be rejected")
