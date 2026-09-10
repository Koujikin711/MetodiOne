"""Тесты персональных квот дневной раздачи архива."""

from app.services.archive_evening_reactivate import LEADS_PER_MANAGER, list_company_manager_quotas
from app.services.manager_daily_lead_quotas import (
    MAVLUDA_DAILY_QUOTA,
    is_mavluda_alibek,
)


def test_mavluda_name_match():
    assert is_mavluda_alibek("Мавлуда Алибекзода") is True
    assert is_mavluda_alibek("Мавлуда Алибекова") is True
    assert is_mavluda_alibek("Mavluda Alibekzoda") is True
    assert is_mavluda_alibek("Манижа Холикова") is False
    assert is_mavluda_alibek("Алибекзода") is False
    assert is_mavluda_alibek(None) is False


def test_mavluda_quota_constant():
    assert MAVLUDA_DAILY_QUOTA == 3
    assert LEADS_PER_MANAGER == 5


def test_list_company_manager_quotas_importable():
    assert callable(list_company_manager_quotas)
