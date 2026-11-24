from app.routers.booking import _lead_name_compatible_with_patient


def test_same_name_compatible():
    assert _lead_name_compatible_with_patient("Махмудов Али", "махмудов  али")


def test_placeholder_lead_name_can_be_filled():
    assert _lead_name_compatible_with_patient("Клиент", "Махмудова Хатича")
    assert _lead_name_compatible_with_patient("", "Махмудова Хатича")


def test_different_names_on_same_phone_are_not_compatible():
    assert not _lead_name_compatible_with_patient("Махмудов Али", "Махмудова Хатича")
