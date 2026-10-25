"""Файл «Скачать базу» должен разбираться тем же импортом."""

from app.services.lead_import import parse_csv_rows, row_to_parsed_lead


def test_export_row_round_trip_fields():
    text = (
        "id,full_name,phone,extra_phones,email,source,stage,manager_name,manager_email,refusal_reason,created_at\n"
        "15,Алиев Али,992936020901,992900000001; 992900000002,ali@example.com,WhatsApp,Архив,Давлатова,manager@crm.local,не отвечает,2026-10-01 08:30:00 UTC\n"
    )
    rows, _headers = parse_csv_rows(text)
    parsed = row_to_parsed_lead(rows[0])
    assert parsed is not None
    assert parsed.name == "Алиев Али"
    assert parsed.phone == "992936020901"
    assert parsed.extra_phones == ("992900000001", "992900000002")
    assert parsed.email == "ali@example.com"
    assert parsed.source == "WhatsApp"
    assert parsed.stage_name == "Архив"
    assert parsed.manager_name == "Давлатова"
    assert parsed.manager_email == "manager@crm.local"
    assert parsed.refusal_reason == "не отвечает"
    assert parsed.created_at is not None
    assert parsed.created_at.year == 2026
    assert parsed.created_at.month == 10
    assert parsed.created_at.day == 1


def test_bitrix_name_still_reads():
    text = "Имя,Фамилия,Телефон,Источник\nАли,Алиев,+992936020901,Сайт\n"
    rows, _headers = parse_csv_rows(text)
    parsed = row_to_parsed_lead(rows[0])
    assert parsed is not None
    assert parsed.name == "Али Алиев"
    assert parsed.stage_name is None
    assert parsed.extra_phones == ()
