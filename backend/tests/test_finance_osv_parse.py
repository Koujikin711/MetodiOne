from app.services.finance_osv_import import (
    is_cash_osv_revenue_kind,
    parse_osv_cash_csv_text,
    parse_osv_csv_text,
)


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


def test_osv_cash_format_parse():
    text = """Дата,Период оказания услуги,SOM,SOM,Банк,Основание Выручка/расход,Контрагенты,Телефон,Чрз,Товар/услуга,Статья,Подробно,Кратко,SOM
2 янв.,,1000,500,ДС,Оплата,Клиент 1,,,Врач,Поступления,Медицина,Выручка,61500
2 янв.,,,250,КАССА,Аренда офиса,Арендодатель,,,Офис,Аренда и коммуналка,Аренда,Расход,61000
"""
    r = parse_osv_cash_csv_text(text, default_year=2026)
    assert r.period_from is not None and r.period_to is not None
    assert r.period_from.isoformat() == "2026-01-02"
    assert r.period_to.isoformat() == "2026-01-02"
    assert len(r.rows) == 2
    assert r.rows[0].amount == 500
    assert r.rows[0].short_kind == "Выручка"
    assert r.rows[1].bank == "КАССА"


def test_cash_osv_kind_prefers_short_kind_over_article():
    # "Кратко" задает тип операции и не должен переопределяться "Статьей".
    assert is_cash_osv_revenue_kind("Расход", "Поступления") is False
    assert is_cash_osv_revenue_kind("Поступление", "Аренда и коммуналка") is True


def test_cash_osv_kind_falls_back_to_article_when_short_kind_empty():
    assert is_cash_osv_revenue_kind(None, "Поступления от клиентов") is True
    assert is_cash_osv_revenue_kind("", "ФОТ и зарплата") is False
