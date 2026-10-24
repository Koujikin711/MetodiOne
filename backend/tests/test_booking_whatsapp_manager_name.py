from app.services.whatsapp_automation import booking_message_manager_name


def test_whatsapp_uses_card_manager_when_admin_left_booking_empty():
    assert booking_message_manager_name(None, "Менеджер карточки") == "Менеджер карточки"
    assert booking_message_manager_name("", "Менеджер карточки") == "Менеджер карточки"


def test_whatsapp_keeps_manager_who_is_on_the_booking():
    assert booking_message_manager_name("Менеджер записи", "Менеджер карточки") == "Менеджер записи"


def test_whatsapp_says_unassigned_only_when_nobody_is_on_the_card():
    assert booking_message_manager_name(None, None) is None
    assert booking_message_manager_name("  ", "  ") is None
