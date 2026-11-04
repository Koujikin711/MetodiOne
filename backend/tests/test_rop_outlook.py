"""Формулы сценариев прогноза РОП."""

from datetime import date
from decimal import Decimal

from app.services.rop_outlook import (
    build_summary,
    days_elapsed_in_month,
    days_remaining_in_month,
    month_label_ru,
    next_month_mid,
    pct_delta,
    project_scenarios,
)


def test_days_elapsed_and_remaining():
    assert days_elapsed_in_month(date(2026, 11, 4), date(2026, 11, 1)) == 4
    assert days_remaining_in_month(date(2026, 11, 4), date(2026, 11, 1)) == 26
    assert days_elapsed_in_month(date(2026, 11, 1), date(2026, 11, 1)) == 1
    assert days_remaining_in_month(date(2026, 12, 1), date(2026, 11, 1)) == 0


def test_project_scenarios_mid_equals_pace():
    # 10 дней прошло, 10 лидов → 1/день; осталось 20 → +20 mid = 30
    scen = project_scenarios(
        leads_so_far=10,
        revenue_so_far=Decimal("10000"),
        elapsed_days=10,
        remaining_days=20,
    )
    assert scen["mid"].leads == 30
    assert scen["mid"].revenue == Decimal("30000.00")
    assert scen["worst"].leads < scen["mid"].leads < scen["best"].leads
    assert scen["worst"].revenue < scen["mid"].revenue < scen["best"].revenue


def test_next_month_mid():
    nxt = next_month_mid(
        revenue_so_far=Decimal("10000"),
        leads_so_far=10,
        elapsed_days=10,
        next_month_days=30,
    )
    assert nxt.leads == 30
    assert nxt.revenue == Decimal("30000.00")


def test_pct_delta():
    assert pct_delta(120, 100) == 20.0
    assert pct_delta(80, 100) == -20.0
    assert pct_delta(0, 0) is None
    assert pct_delta(5, 0) == 100.0


def test_month_label_and_summary():
    assert month_label_ru(date(2026, 11, 1)) == "ноябрь 2026"
    text = build_summary(
        revenue_delta_pct=-4.0,
        mid_revenue=Decimal("139000"),
        current_revenue=Decimal("48200"),
    )
    assert "Отстаёте" in text
    assert "139" in text.replace("\u00a0", "")
