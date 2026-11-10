"""Тесты: Мулкия — блок новых лидов до понедельника."""

from datetime import datetime
from zoneinfo import ZoneInfo

from app.services.manager_mulkiya_leads import (
    MULKIYA_NO_NEW_LEADS_UNTIL,
    is_mulkiya_haidarzoda,
    mulkiya_blocked_from_new_leads,
    new_leads_only_mulkiya,
)


def test_mulkiya_name_match():
    assert is_mulkiya_haidarzoda("Хайдарзода Мулкия") is True
    assert is_mulkiya_haidarzoda("Мулкия Хайдарзода") is True
    assert is_mulkiya_haidarzoda("Haidarzoda Mulkiya") is True
    assert is_mulkiya_haidarzoda("Mulkiya Haidarzoda") is True
    assert is_mulkiya_haidarzoda("Мавлуда Алибекзода") is False
    assert is_mulkiya_haidarzoda("Манижа Холикова") is False
    assert is_mulkiya_haidarzoda(None) is False


def test_mulkiya_blocked_until_monday():
    tz = ZoneInfo("Asia/Dushanbe")
    assert MULKIYA_NO_NEW_LEADS_UNTIL.isoformat() == "2026-11-16"
    assert mulkiya_blocked_from_new_leads(datetime(2026, 11, 10, 12, 0, tzinfo=tz)) is True
    assert mulkiya_blocked_from_new_leads(datetime(2026, 11, 15, 23, 59, tzinfo=tz)) is True
    assert mulkiya_blocked_from_new_leads(datetime(2026, 11, 16, 0, 1, tzinfo=tz)) is False
    # alias
    assert new_leads_only_mulkiya(datetime(2026, 11, 12, 10, 0, tzinfo=tz)) is True
