from datetime import UTC, datetime
from decimal import Decimal

from app.services.analytics_overview_money import overview_visit_money, prior_visit_debt
from app.services.company_month_compare import build_month_compare


def test_overview_skips_course_package_and_cancelled():
    paid, debt = overview_visit_money(
        [
            (Decimal("1000"), Decimal("1000"), "completed", "Массаж"),
            (Decimal("5800"), Decimal("17000"), "completed", "Курс"),
            (Decimal("300"), Decimal("300"), "cancelled", "ТМС"),
            (Decimal("500"), Decimal("800"), "booked", "Курс 15"),
        ],
    )
    assert paid == Decimal("1500")
    assert debt == Decimal("300")


def test_prior_debt_is_the_gap_under_the_card():
    assert prior_visit_debt(Decimal("195204"), Decimal("183434")) == Decimal("11770.00")
    assert prior_visit_debt(Decimal("100"), Decimal("100")) == Decimal("0")
    assert prior_visit_debt(Decimal("10"), Decimal("12")) == Decimal("0")


def test_month_compare_uses_cash_date_and_skips_cancelled():
    may = datetime(2026, 5, 10, tzinfo=UTC)
    october_visit = datetime(2026, 10, 4, tzinfo=UTC)
    october_cash = datetime(2026, 10, 20, tzinfo=UTC)
    built = build_month_compare(
        datetime(2026, 10, 1).date(),
        [
            (Decimal("100"), "completed", may, may, "Массаж"),
            (Decimal("50"), "cancelled", october_visit, october_cash, "Массаж"),
            (Decimal("200"), "completed", october_visit, october_cash, "ТМС"),
            (Decimal("40"), "booked", datetime(2026, 9, 2, tzinfo=UTC), october_cash, "Остеопат"),
        ],
    )
    assert built["labels"][-1] == "окт"
    assert built["revenue"][-1] == Decimal("240.00")
    assert built["sales"][-1] == 1
    assert built["revenue"][0] == Decimal("100.00")
    names = [row["name"] for row in built["services"]]
    assert "Массаж" in names
    assert "ТМС" in names
