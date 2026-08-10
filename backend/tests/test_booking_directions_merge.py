"""Unit tests for booking direction name helpers / keeper preference."""

from app.services.booking_directions import (
    archived_direction_name,
    direction_base_name,
    direction_name_key,
    normalize_direction_name,
    prefer_direction_keeper,
)


class _Dir:
    def __init__(self, id: int, name: str, is_active: bool) -> None:
        self.id = id
        self.name = name
        self.is_active = is_active


def test_name_key_casefold_and_archive_suffix() -> None:
    assert direction_name_key("Консультация") == direction_name_key("консультация")
    assert direction_name_key("Консультация [архив #1]") == direction_name_key("консультация")
    assert normalize_direction_name("  Массаж   тела ") == "Массаж тела"
    assert direction_base_name("Тренинг Худжанд [архив #12]") == "Тренинг Худжанд"


def test_archived_direction_name_unique_suffix() -> None:
    assert archived_direction_name("Консультация", 14) == "Консультация [архив #14]"
    assert "[архив #14]" in archived_direction_name("Консультация [архив #14]", 14)


def test_prefer_active_then_oldest() -> None:
    a = _Dir(14, "консультация", True)
    b = _Dir(1, "Консультация", True)
    c = _Dir(9, "Консультация [архив #9]", False)
    assert prefer_direction_keeper([a, b, c]).id == 1
    assert prefer_direction_keeper([c, a]).id == 14
    # Active edit target must win over archived same-name duplicate.
    assert prefer_direction_keeper([b, a]).id == 1
    archived = _Dir(1, "Консультация [архив #1]", False)
    active = _Dir(14, "Консультация", True)
    assert prefer_direction_keeper([archived, active]).id == 14
