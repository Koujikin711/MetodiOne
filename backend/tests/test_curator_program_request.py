"""Имя из онлайн-записи и заявка куратора на Курс/Протокол."""

from __future__ import annotations

from datetime import UTC, datetime

from app.services.booking_patient_name import display_patient_identity, pick_latest_booking_identity
from app.services.curator_program_request import sale_kind_matches_request


def test_latest_booking_name_wins_over_older_chat_snapshot():
    rows = [
        (10, "🪶", "992000", datetime(2026, 5, 1, tzinfo=UTC), 1),
        (10, "Амонова Хуршеда", "992902101110", datetime(2026, 9, 24, tzinfo=UTC), 2),
    ]
    picked = pick_latest_booking_identity(rows)
    assert picked[10] == ("Амонова Хуршеда", "992902101110")


def test_display_prefers_booking_name_not_green_lead_name():
    name, phone = display_patient_identity(
        lead_name="ZLAY🦋",
        lead_phone="79016352044",
        booking=("Закияи Алишер", "907228599"),
    )
    assert name == "Закияи Алишер"
    assert phone == "907228599"


def test_display_falls_back_when_booking_missing():
    name, phone = display_patient_identity(lead_name="Али", lead_phone="992550", booking=None)
    assert name == "Али"
    assert phone == "992550"


def test_admin_sale_matches_only_the_requested_program():
    assert sale_kind_matches_request("main_course", "Курс") is True
    assert sale_kind_matches_request("main_course", "Курс 15") is False
    assert sale_kind_matches_request("protocol", "Протокол") is True
    assert sale_kind_matches_request("protocol", "Курс") is False
    assert sale_kind_matches_request("main_course", "Массаж") is False
