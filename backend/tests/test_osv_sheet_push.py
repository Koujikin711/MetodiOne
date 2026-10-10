from datetime import date
from decimal import Decimal

from app.services.finance_osv_parse import parse_osv_grid
from app.services.google_sheets_osv_push import (
    bank_label,
    booking_pay_key,
    format_osv_amount,
    format_osv_date,
    rows_appended_in_hand_period,
    sheet_row_values,
    should_append_to_sheet,
)


_HEADERS = [
    "Дата",
    "Детализац",
    "Этап",
    "SOM",
    "SOM",
    "Банк",
    "Основание",
    "Контрагенты",
    "Телефон",
    "Через",
    "Товар/услуга",
    "Статья",
    "Подробно",
    "Кратко",
]
# «ВЫРУЧКА» стоит над «Этап»+первая SOM, «РАСХОД» — над второй SOM.
_ABOVE = ["", "", "ВЫРУЧКА", "", "РАСХОД", "", "", "", "", "", "", "", "", ""]


def test_sheet_row_follows_clinic_osv_form():
    row = sheet_row_values(
        _HEADERS,
        {
            "txn_date": date(2026, 9, 28),
            "partner_amount": Decimal("150"),
            "revenue": Decimal("60"),
            "expense": Decimal("0"),
            "bank": "КАССА",
            "basis": "Учеда",
            "counterparty": "Саидов Мухаммад",
            "phone": "+99212136321840",
            "via_person": "Малика Н",
            "product_service": "15-Руза Курс",
            "article": "Поступления",
            "detail_category": "Медицина",
            "brief_category": "Выручка",
        },
        "crm:booking_pay:1:0:6000",
        above=_ABOVE,
    )
    assert row[0] == "28 сент."
    assert row[1] == "150,00"
    assert row[2] == ""
    assert row[3] == "60,00"
    assert row[4] == ""
    assert row[5] == "КАССА"
    assert row[6] == "Учеда"
    assert row[7] == "Саидов Мухаммад"
    assert row[8] == "12136321840"
    assert row[9] == "Малика Н"
    assert row[10] == "15-Руза Курс"
    assert row[11] == "Поступления"
    assert row[12] == "Медицина"
    assert row[13] == "Выручка"
    assert row[-1] == "crm:booking_pay:1:0:6000"


def test_expense_amount_goes_to_expense_som():
    row = sheet_row_values(
        _HEADERS,
        {
            "txn_date": date(2026, 10, 5),
            "revenue": 0,
            "expense": Decimal("8270"),
            "bank": "ДС",
            "basis": "Аренда офиса 43",
            "counterparty": "Дадажонов Осимжон",
            "via_person": "Ганчина",
            "product_service": "Офис 43",
            "article": "Аренда и коммуналка",
            "detail_category": "Аренда",
            "brief_category": "Расход",
        },
        "crm:expense:4",
        above=_ABOVE,
    )
    assert row[3] == ""
    assert row[4] == "8270,00"
    assert row[5] == "ДС"
    assert row[6] == "Аренда офиса 43"
    assert row[13] == "Расход"


def test_parse_reads_two_som_columns():
    grid = [
        ["", "", "ВЫРУЧКА", "", "РАСХОД"],
        ["Дата", "Детализац", "Этап", "SOM", "SOM", "Банк", "Кратко", "CRM ключ"],
        ["28 сен.", "150", "", "60", "", "КАССА", "Выручка", ""],
        ["5 окт.", "", "", "", "8270", "ДС", "Расход", "crm:expense:1"],
    ]
    parsed = parse_osv_grid(grid)
    assert len(parsed) == 1
    assert parsed[0]["revenue"] == Decimal("60")
    assert parsed[0]["expense"] == Decimal("0")
    assert parsed[0]["partner_amount"] == Decimal("150")
    assert parsed[0]["bank"] == "КАССА"


def test_parse_skips_rows_written_by_crm():
    grid = [
        ["Дата", "Выручка", "Расход", "CRM ключ"],
        ["5 окт.", "100", "", "crm:booking_pay:1:0:10000"],
        ["5 окт.", "", "50", ""],
        ["5 окт.", "", "-10", "booking_refund:2:abcd"],
    ]
    parsed = parse_osv_grid(grid)
    assert len(parsed) == 1
    assert parsed[0]["expense"] == Decimal("50")


def test_old_refunds_are_not_appended_under_october_rows():
    assert should_append_to_sheet(date(2026, 9, 23)) is False
    assert should_append_to_sheet(date(2026, 10, 5)) is False
    assert should_append_to_sheet(date(2026, 10, 6)) is True
    grid = [
        ["", "", "", "ВЫРУЧКА", "РАСХОД"],
        ["Дата", "Договор", "Этап", "SOM", "SOM", "Банк", "CRM ключ"],
        ["5 окт.", "", "", "", "50,00", "ДС", ""],
        ["23 сент.", "", "", "-300,00", "", "ДС", "booking_refund:3943:abc"],
        ["6 окт.", "", "", "100,00", "", "ДС", "crm:booking_pay:1:0:10000"],
    ]
    assert rows_appended_in_hand_period(grid) == [3]


def test_bank_and_date_labels():
    assert format_osv_date(date(2026, 10, 5)) == "5 окт."
    assert format_osv_amount(Decimal("-20.5")) == "-20,50"
    assert format_osv_amount(0) == ""
    assert bank_label("cash") == "КАССА"
    assert bank_label("alif") == "Алиф"
    assert bank_label("dc") == "ДС"
    assert booking_pay_key(9, 0, Decimal("15.5")) == "crm:booking_pay:9:0:1550"
