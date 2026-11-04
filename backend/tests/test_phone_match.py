from app.services.chat_outbound_policy import outbound_message_allowed
from app.services.phone_match import phone_search_digit_variants, phones_equivalent, whatsapp_e164_digits
from app.models import User, UserRole


def test_phones_equivalent_tj_variants():
    assert phones_equivalent("+992901234567", "901234567")
    assert phones_equivalent("992901234567", "+992 90 123 45 67")
    assert not phones_equivalent("+992901234567", "+992907654321")


def test_phones_equivalent_ru_and_us():
    assert phones_equivalent("8 (916) 123-45-67", "+7 916 123 45 67")
    assert phones_equivalent("+1 415 555 2671", "4155552671")
    assert phones_equivalent("+14155552671", "1-415-555-2671")


def test_phone_search_digit_variants_countries():
    tj = phone_search_digit_variants("+992 90 123-45-67")
    assert "992901234567" in tj
    assert "901234567" in tj
    ru = phone_search_digit_variants("89161234567")
    assert "79161234567" in ru and "89161234567" in ru
    us = phone_search_digit_variants("+1 (415) 555-2671")
    assert "14155552671" in us and "4155552671" in us


def test_whatsapp_e164_digits_adds_tj_cc():
    assert whatsapp_e164_digits("918353491") == "992918353491"
    assert whatsapp_e164_digits("+992918353491") == "992918353491"
    assert whatsapp_e164_digits("992918353491") == "992918353491"
    assert whatsapp_e164_digits("0918353491") == "992918353491"


def test_manager_can_send_whitelisted_phone_only():
    user = User(id=1, email="m@test.com", hashed_password="x", role=UserRole.manager)
    allowed = ["+992901234567"]
    ok, err = outbound_message_allowed(user, "Звоните на 901234567", allowed_outbound_phones=allowed)
    assert ok is True
    assert err is None
    ok2, err2 = outbound_message_allowed(user, "Мой номер 918765432", allowed_outbound_phones=allowed)
    assert ok2 is False
    assert err2
