from decimal import Decimal

from app.services.sales_kpi_weighted import bonus_amount, completion_ratio, contribution


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
