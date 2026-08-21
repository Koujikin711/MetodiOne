from datetime import date
from decimal import Decimal
from types import SimpleNamespace
from zoneinfo import ZoneInfo

from app.config import settings
from app.services.sales_kpi_weighted import (
    _norm_kpi_label,
    bonus_amount,
    build_manager_lines,
    completion_ratio,
    contribution,
    kpi_booking_created_cutoff,
)


def test_sheet_formula_example():
    """Как в Google Sheets: 14/37@25% + 1/5@25% → вклад ~14.46%, бонус ~1446 при фонде 10000."""
    c1 = completion_ratio(14, 37)
    c2 = completion_ratio(1, 5)
    assert c1 is not None and c1 <= 1
    assert c2 == Decimal("0.2")
    total = contribution(c1, Decimal("25")) + contribution(c2, Decimal("25"))
    assert Decimal("0.1445") <= total <= Decimal("0.1447")
    assert bonus_amount(total, Decimal("10000")) == Decimal("1446.00")


def test_overachievement_capped():
    assert completion_ratio(100, 10) == Decimal("1")
    assert contribution(Decimal("1"), Decimal("25")) == Decimal("0.2500")


def test_norm_kpi_label():
    assert _norm_kpi_label("  CRM  Модули ") == "crm модули"
    assert _norm_kpi_label(None) == ""


def test_kpi_booking_created_cutoff_from_july():
    assert kpi_booking_created_cutoff(date(2026, 6, 1)) is None
    cutoff = kpi_booking_created_cutoff(date(2026, 7, 1))
    assert cutoff is not None
    local = cutoff.astimezone(ZoneInfo(settings.booking_timezone))
    assert local.year == 2026 and local.month == 7 and local.day == 1
    assert local.hour == 0 and local.minute == 0
    assert kpi_booking_created_cutoff(date(2026, 8, 1)) == cutoff


def test_desk_facts_add_to_manager_line():
    item = SimpleNamespace(
        id=7,
        name="CRM модули",
        source_type="manual",
        direction_id=None,
        plan_qty=10,
        weight_percent=Decimal("100"),
    )
    raw = build_manager_lines(
        manager_id=3,
        manager_name="Менеджер",
        items=[item],
        direction_facts={},
        specialist_facts={},
        item_specialists={},
        manual_facts={},
        desk_facts={(3, 7): 2},
        bonus_fund=Decimal("10000"),
    )
    assert raw["lines"][0]["fact_qty"] == 2
    assert raw["total_contribution"] == Decimal("0.2000")
