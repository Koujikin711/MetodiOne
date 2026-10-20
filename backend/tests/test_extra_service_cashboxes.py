from decimal import Decimal

from app.routers.extra_services import cashbox_report_rows


def test_cashboxes_keep_presets_and_sum_custom_banks():
    rows = cashbox_report_rows(
        [
            ("Алиф", 2, Decimal("1000"), Decimal("300"), Decimal("700")),
            ("алиф", 1, Decimal("50.5"), Decimal("15.15"), Decimal("35.35")),
            ("ИБТ", 1, Decimal("200"), Decimal("60"), Decimal("140")),
            ("", 1, Decimal("10"), Decimal("3"), Decimal("7")),
        ]
    )
    by_name = {row.payment_method: row for row in rows}
    assert [row.payment_method for row in rows[:4]] == ["Касса", "ДС", "Алиф", "Эсхата"]
    assert by_name["Касса"].count == 0
    assert by_name["Касса"].amount_total == Decimal("0.00")
    assert by_name["ДС"].count == 0
    assert by_name["Алиф"].count == 3
    assert by_name["Алиф"].amount_total == Decimal("1050.50")
    assert by_name["Алиф"].keep_total == Decimal("315.15")
    assert by_name["Алиф"].payout_total == Decimal("735.35")
    assert by_name["ИБТ"].amount_total == Decimal("200.00")
    assert rows[-1].payment_method == "Не указано"
    assert rows[-1].count == 1
