from datetime import UTC, date, datetime
from decimal import Decimal
from types import SimpleNamespace
from zoneinfo import ZoneInfo

from app.config import settings
from app.services.sales_kpi_weighted import (
    _norm_kpi_label,
    amounts_match_unit_price,
    bonus_amount,
    brought_for_plan_item,
    earning_from_brought,
    build_manager_lines,
    completion_ratio,
    contribution,
    kpi_booking_created_cutoff,
    manual_sale_counts_in_kpi,
    manual_sale_threshold_crossed_at,
    sum_specialist_facts_company,
    sum_specialist_facts_for_manager,
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


def test_plan_line_uses_brought_money_for_that_service():
    detail = {(7, 3, 9): Decimal("800.00"), (7, 3, 4): Decimal("100.00"), (8, 3, 9): Decimal("50.00")}
    manual = {(7, "протокол"): Decimal("1500.00")}
    assert brought_for_plan_item(
        manager_id=7,
        source_type="direction",
        name="Курс 15",
        direction_id=None,
        direction_ids=[9],
        specialist_ids=[3],
        detail=detail,
        manual=manual,
    ) == Decimal("800.00")
    assert brought_for_plan_item(
        manager_id=7,
        source_type="manual",
        name="Протокол",
        direction_id=None,
        direction_ids=[],
        specialist_ids=[],
        detail=detail,
        manual=manual,
    ) == Decimal("1500.00")


def test_service_earning_is_percent_of_brought_not_full_price():
    """10% от приведённых 400, а не от цены 1000 и не от порога 25%."""
    assert earning_from_brought(Decimal("400"), Decimal("10")) == Decimal("40.00")
    assert earning_from_brought(Decimal("100"), Decimal("0")) == Decimal("0.00")
    assert earning_from_brought(Decimal("0"), Decimal("15")) == Decimal("0.00")


def test_overachievement_capped():
    assert completion_ratio(100, 10) == Decimal("1")
    assert contribution(Decimal("1"), Decimal("25")) == Decimal("0.2500")


def test_completed_protocol_stays_in_kpi_when_first_payment_clears_threshold():
    """1500+1500 за протокол 3000: закрытие «завершён» не выкидывает августовский факт."""
    assert manual_sale_counts_in_kpi(Decimal("3000"), Decimal("1500"), "completed")
    assert manual_sale_counts_in_kpi(Decimal("3000"), Decimal("1500"), "active")
    assert manual_sale_counts_in_kpi(Decimal("3000"), Decimal("3000"), "active")
    assert not manual_sale_counts_in_kpi(Decimal("3000"), Decimal("500"), "completed")
    assert not manual_sale_counts_in_kpi(Decimal("3000"), Decimal("1500"), "returned")
    assert not manual_sale_counts_in_kpi(Decimal("3000"), Decimal("1500"), "refused")


def test_threshold_stays_open_until_cumulative_payment_crosses_it():
    """500 в день продажи не хватает. Доплата, которая переходит 25%, ставит факт на свою дату. Вторая доплата месяц не двигает."""
    opened = datetime(2026, 9, 8, 9, 40, tzinfo=UTC)
    topup = datetime(2026, 9, 25, 7, 0, tzinfo=UTC)
    crossed = manual_sale_threshold_crossed_at(
        service_amount=Decimal("3000"),
        paid_amount=Decimal("3000"),
        sold_at=opened,
        payments=[(opened, Decimal("500")), (topup, Decimal("2500"))],
    )
    assert crossed == topup

    august = datetime(2026, 8, 31, 4, 32, tzinfo=UTC)
    september = datetime(2026, 9, 4, 10, 58, tzinfo=UTC)
    already = manual_sale_threshold_crossed_at(
        service_amount=Decimal("3000"),
        paid_amount=Decimal("3000"),
        sold_at=august,
        payments=[(september, Decimal("1500"))],
    )
    assert already == august

    assert (
        manual_sale_threshold_crossed_at(
            service_amount=Decimal("3000"),
            paid_amount=Decimal("400"),
            sold_at=opened,
            payments=[(opened, Decimal("400"))],
        )
        is None
    )

    # Доплата задним числом раньше продажи не переписывает прошлый месяц: факт в день заведения.
    backdated = datetime(2026, 1, 7, 7, 0, tzinfo=UTC)
    registered = datetime(2026, 9, 10, 7, 51, tzinfo=UTC)
    assert (
        manual_sale_threshold_crossed_at(
            service_amount=Decimal("17000"),
            paid_amount=Decimal("12000"),
            sold_at=registered,
            payments=[(backdated, Decimal("9000")), (registered, Decimal("3000"))],
        )
        == registered
    )


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


def test_amounts_match_unit_price_tol():
    assert amounts_match_unit_price(Decimal("1300"), Decimal("1300"))
    assert amounts_match_unit_price(Decimal("1300.50"), Decimal("1300"))
    assert not amounts_match_unit_price(Decimal("150"), Decimal("1300"))
    assert not amounts_match_unit_price(Decimal("16000"), Decimal("1300"))
    # Без цены фильтра нет — всё подходит
    assert amounts_match_unit_price(Decimal("150"), Decimal("0"))


def test_kurs15_excludes_consultation_and_full_course():
    """Мухитдинзода 150 и Сатторов 16000 не входят в «Курс 15» (1300)."""
    item = SimpleNamespace(
        id=2,
        name="Курс 15",
        source_type="direction",
        direction_id=6,
        plan_qty=37,
        weight_percent=Decimal("25"),
    )
    # specialist 9 = Толибзода: 1300×2 + 150×1; specialist 8: 16000×1
    specialist_facts = {
        (1, 9, Decimal("1300.00")): 2,
        (1, 9, Decimal("150.00")): 1,
        (1, 8, Decimal("16000.00")): 1,
        (1, 8, Decimal("1300.00")): 1,
    }
    raw = build_manager_lines(
        manager_id=1,
        manager_name="Мадina",
        items=[item],
        direction_facts={},
        specialist_facts=specialist_facts,
        item_specialists={2: [8, 9]},
        manual_facts={},
        desk_facts={},
        bonus_fund=Decimal("10000"),
        unit_price_by_label={"курс 15": Decimal("1300")},
    )
    assert raw["lines"][0]["fact_qty"] == 3

    company = sum_specialist_facts_company(
        {
            (9, Decimal("1300.00")): 2,
            (9, Decimal("150.00")): 1,
            (8, Decimal("16000.00")): 1,
            (8, Decimal("1300.00")): 1,
        },
        specialist_ids=[8, 9],
        unit_price=Decimal("1300"),
    )
    assert company == 3
    assert sum_specialist_facts_for_manager(
        specialist_facts,
        manager_id=1,
        specialist_ids=[8, 9],
        unit_price=None,
    ) == 5


def test_selected_services_ignore_name_price():
    """Отмеченные услуги продукта считаются сами, без фильтра цены по имени."""
    item = SimpleNamespace(
        id=2,
        name="Остеопат",
        source_type="direction",
        direction_id=None,
        plan_qty=10,
        weight_percent=Decimal("15"),
    )
    raw = build_manager_lines(
        manager_id=1,
        manager_name="Дилнора",
        items=[item],
        direction_facts={},
        specialist_facts={(1, 9, Decimal("150.00")): 7},
        item_specialists={2: [9]},
        manual_facts={},
        bonus_fund=Decimal("10000"),
        unit_price_by_label={"остеопат": Decimal("1000")},
        item_direction_ids={2: [4]},
        service_facts={(1, 9, 4): 3, (1, 8, 4): 5, (1, 9, 6): 9},
    )
    assert raw["lines"][0]["fact_qty"] == 3
