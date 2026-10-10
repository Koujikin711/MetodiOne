from datetime import date
from decimal import Decimal

from app.services.finance_osv_parse import parse_osv_grid
from app.services.google_sheets_osv_push import (
    bank_label,
    booking_pay_key,
    format_osv_amount,
    format_osv_date,
    sheet_row_values,
)


def test_sheet_row_follows_osv_headers():
    headers = [
        "Дата",
        "Выручка",
        "Расход",
        "Банк",
        "Основание",
        "Контрагенты",
        "Телефон",
        "Через",
        "Товар/услуги",
        "Статьи",
        "Подробно",
        "Кратко",
    ]
    row = sheet_row_values(
        headers,
        {
            "txn_date": date(2026, 10, 5),
            "revenue": Decimal("1500"),
            "expense": Decimal("0"),
            "bank": "ДС",
            "basis": "Алия — Остеопат",
            "counterparty": "Алия",
            "phone": "900000000",
            "via_person": "Ганчина",
            "product_service": "Остеопат",
            "article": "Поступления",
            "detail_category": "Остеопатия",
            "brief_category": "Выручка",
        },
        "crm:booking_pay:1:0:150000",
    )
    assert row[0] == "5 окт."
    assert row[1] == "1500,00"
    assert row[2] == ""
    assert row[3] == "ДС"
    assert row[7] == "Ганчина"
    assert row[9] == "Поступления"
    assert row[-1] == "crm:booking_pay:1:0:150000"


def test_expense_amount_goes_to_expense_column():
    headers = ["Дата", "Выручка", "Расход", "Кратко"]
    row = sheet_row_values(
        headers,
        {
            "txn_date": date(2026, 10, 5),
            "revenue": 0,
            "expense": Decimal("8270"),
            "brief_category": "Расход",
        },
        "crm:expense:4",
    )
    assert row[1] == ""
    assert row[2] == "8270,00"
    assert row[3] == "Расход"
    assert row[4] == "crm:expense:4"


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


def test_bank_and_date_labels():
    assert format_osv_date(date(2026, 10, 5)) == "5 окт."
    assert format_osv_amount(Decimal("-20.5")) == "-20,50"
    assert format_osv_amount(0) == ""
    assert bank_label("cash") == "КАССА"
    assert bank_label("alif") == "Алиф"
    assert bank_label("dc") == "ДС"
    assert booking_pay_key(9, 0, Decimal("15.5")) == "crm:booking_pay:9:0:1550"
