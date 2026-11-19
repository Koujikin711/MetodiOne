from datetime import UTC, datetime, timedelta
from types import SimpleNamespace

from app.services.whatsapp_automation import (
    _appointment_still_upcoming,
    _booking_ctx,
    booking_message_manager_name,
)


def test_whatsapp_uses_card_manager_when_admin_left_booking_empty():
    assert booking_message_manager_name(None, "Менеджер карточки") == "Менеджер карточки"
    assert booking_message_manager_name("", "Менеджер карточки") == "Менеджер карточки"


def test_whatsapp_keeps_manager_who_is_on_the_booking():
    assert booking_message_manager_name("Менеджер записи", "Менеджер карточки") == "Менеджер записи"


def test_whatsapp_says_unassigned_only_when_nobody_is_on_the_card():
    assert booking_message_manager_name(None, None) is None
    assert booking_message_manager_name("  ", "  ") is None


def test_booking_ctx_formats_dushanbe_not_utc_wall_clock():
    # 15:00 Asia/Dushanbe = 10:00 UTC — в SMS должно быть 15:00, не 10:00
    appt = SimpleNamespace(
        patient_name="Тест",
        start_at=datetime(2026, 11, 13, 10, 0, tzinfo=UTC),
    )
    ctx = _booking_ctx(appt, "Мулкия")
    assert ctx["date"] == "13.11.2026"
    assert ctx["time"] == "15:00"


def test_past_appointment_does_not_count_as_upcoming_for_confirm():
    past = SimpleNamespace(start_at=datetime.now(UTC) - timedelta(hours=5))
    future = SimpleNamespace(start_at=datetime.now(UTC) + timedelta(hours=2))
    assert _appointment_still_upcoming(past) is False
    assert _appointment_still_upcoming(future) is True
