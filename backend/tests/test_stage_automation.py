"""Unit tests for stage enter-task automation rules."""

from app.services.automation import stage_should_create_task


class _Stage:
    def __init__(
        self,
        name: str,
        order: int = 0,
        on_enter_create_task: bool | None = None,
    ):
        self.name = name
        self.order = order
        self.on_enter_create_task = on_enter_create_task


def test_legacy_oplacheno():
    assert stage_should_create_task(_Stage("Оплачено", 6), max_order=8) is True


def test_legacy_success():
    assert stage_should_create_task(_Stage("Успешно реализован", 7), max_order=8) is True


def test_legacy_lost_last_no():
    assert stage_should_create_task(_Stage("Потерян", 8), max_order=8) is False


def test_legacy_last_stage_yes():
    assert stage_should_create_task(_Stage("Финиш", 5), max_order=5) is True


def test_explicit_off_overrides_legacy():
    assert stage_should_create_task(_Stage("Оплачено", 6, on_enter_create_task=False), max_order=8) is False


def test_explicit_on():
    assert stage_should_create_task(_Stage("Новый", 0, on_enter_create_task=True), max_order=8) is True
