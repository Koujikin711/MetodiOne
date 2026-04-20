from app.services.finance_osv_import import parse_osv_csv_text


def test_osv_parse_period_and_rows():
    text = """#PERIOD=2026-01-01..2026-01-31
account_code,debit,credit
1010,100.00,0
4010,0,100.00
"""
    r = parse_osv_csv_text(text)
    assert r.period_from is not None and r.period_to is not None
    assert r.period_from.isoformat() == "2026-01-01"
    assert r.period_to.isoformat() == "2026-01-31"
    assert len(r.rows) == 2
    assert r.rows[0].account_code.strip() == "1010"


def test_dds_bucket_helper_importable():
    from app.services.finance_reports import _dds_bucket_from_line_dimensions

    assert _dds_bucket_from_line_dimensions({"dds_bucket": "investing"}) == "investing"
    assert _dds_bucket_from_line_dimensions({"dds_article": "Оплата от клиента X"}) == "op_customers"
