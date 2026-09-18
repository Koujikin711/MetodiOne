"""Тесты персональных квот дневной раздачи."""

from app.services.archive_evening_reactivate import LEADS_PER_MANAGER, list_company_manager_quotas
from app.services.manager_daily_lead_quotas import (
    MAVLUDA_DAILY_NEW_QUOTA,
    is_mavluda_alibek,
)
from app.services.manager_new_leads_block import is_kholikova_manizha


def test_mavluda_name_match():
    assert is_mavluda_alibek("Мавлуда Алибекзода") is True
    assert is_mavluda_alibek("Мавлуда Алибекова") is True
    assert is_mavluda_alibek("Mavluda Alibekzoda") is True
    assert is_mavluda_alibek("Манижа Холикова") is False
    assert is_mavluda_alibek("Алибекзода") is False
    assert is_mavluda_alibek(None) is False


def test_mavluda_quota_constants():
    assert MAVLUDA_DAILY_NEW_QUOTA == 3
    assert LEADS_PER_MANAGER == 6


def test_kholikova_excluded_from_archive_name():
    assert is_kholikova_manizha("Манижа Холикова") is True
    assert is_kholikova_manizha("Холикова Манижа") is True
    assert is_kholikova_manizha("Мавлуда Алибекзода") is False


def test_list_company_manager_quotas_importable():
    assert callable(list_company_manager_quotas)
