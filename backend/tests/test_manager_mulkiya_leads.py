"""Тесты: Мулкия должна попадать в пул новых лидов."""

from datetime import datetime
from zoneinfo import ZoneInfo

from app.services.manager_mulkiya_leads import is_mulkiya_haidarzoda, new_leads_only_mulkiya


def test_mulkiya_name_match():
    assert is_mulkiya_haidarzoda("Хайдарзода Мулкия") is True
    assert is_mulkiya_haidarzoda("Мулкия Хайдарзода") is True
    assert is_mulkiya_haidarzoda("Haidarzoda Mulkiya") is True
    assert is_mulkiya_haidarzoda("Mulkiya Haidarzoda") is True
    assert is_mulkiya_haidarzoda("Мавлуда Алибекзода") is False
    assert is_mulkiya_haidarzoda("Манижа Холикова") is False
    assert is_mulkiya_haidarzoda(None) is False


def test_new_leads_only_mulkiya_until_tuesday():
    tz = ZoneInfo("Asia/Dushanbe")
    assert new_leads_only_mulkiya(datetime(2026, 11, 6, 11, 40, tzinfo=tz)) is True
    assert new_leads_only_mulkiya(datetime(2026, 11, 9, 23, 59, tzinfo=tz)) is True
    assert new_leads_only_mulkiya(datetime(2026, 11, 10, 0, 1, tzinfo=tz)) is False
