from app.services.chat_outbound_policy import outbound_message_allowed
from app.services.phone_match import phones_equivalent
from app.models import User, UserRole


def test_phones_equivalent_tj_variants():
    assert phones_equivalent("+992901234567", "901234567")
    assert phones_equivalent("992901234567", "+992 90 123 45 67")
    assert not phones_equivalent("+992901234567", "+992907654321")


def test_manager_can_send_whitelisted_phone_only():
    user = User(id=1, email="m@test.com", hashed_password="x", role=UserRole.manager)
    allowed = ["+992901234567"]
    ok, err = outbound_message_allowed(user, "Звоните на 901234567", allowed_outbound_phones=allowed)
    assert ok is True
    assert err is None
    ok2, err2 = outbound_message_allowed(user, "Мой номер 918765432", allowed_outbound_phones=allowed)
    assert ok2 is False
    assert err2
