"""Тесты: Мулкия должна попадать в пул новых лидов."""

from app.services.manager_mulkiya_leads import is_mulkiya_haidarzoda


def test_mulkiya_name_match():
    assert is_mulkiya_haidarzoda("Хайдарзода Мулкия") is True
    assert is_mulkiya_haidarzoda("Мулкия Хайдарзода") is True
    assert is_mulkiya_haidarzoda("Haidarzoda Mulkiya") is True
    assert is_mulkiya_haidarzoda("Mulkiya Haidarzoda") is True
    assert is_mulkiya_haidarzoda("Мавлуда Алибекзода") is False
    assert is_mulkiya_haidarzoda("Манижа Холикова") is False
    assert is_mulkiya_haidarzoda(None) is False
