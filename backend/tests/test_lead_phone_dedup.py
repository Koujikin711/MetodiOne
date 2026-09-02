"""Тесты дедупа лидов по телефону."""

from app.services.lead_phone_dedup import _phone_key, is_placeholder_lead_name


def test_phone_key_last_nine():
    assert _phone_key("+992936020901") == "936020901"
    assert _phone_key("992936020901") == "936020901"
    assert _phone_key("123") is None


def test_placeholder_names():
    assert is_placeholder_lead_name("Гость")
    assert is_placeholder_lead_name("Клиент")
    assert is_placeholder_lead_name("WhatsApp lead")
    assert not is_placeholder_lead_name("Manizha")
