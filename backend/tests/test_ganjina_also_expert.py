from app.services.ganjina_also_expert import is_ganjina_zamiri


def test_ganjina_name_matches() -> None:
    assert is_ganjina_zamiri("Замири Ганчина")
    assert is_ganjina_zamiri("Ганчина Замири")
    assert is_ganjina_zamiri("Ganjina Zamiri")


def test_other_names_do_not_match() -> None:
    assert not is_ganjina_zamiri("Абдуллозода Аниса")
    assert not is_ganjina_zamiri("Ганчина")
    assert not is_ganjina_zamiri(None)
