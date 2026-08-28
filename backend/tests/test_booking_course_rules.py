"""Helpers for course/consult booking rules."""

from app.routers.booking import _split_prepaid_across_days
from app.services.booking_directions import (
    is_admin_only_booking_direction_name,
    is_consultation_direction_name,
    is_course_like_direction_name,
    is_ganchina_specialist_name,
)


def test_course_like_names():
    assert is_course_like_direction_name("Курс 15")
    assert is_course_like_direction_name("курс15")
    assert is_course_like_direction_name("Курс")
    assert is_course_like_direction_name("Протокол")
    assert is_course_like_direction_name("15 руза курс")
    assert not is_course_like_direction_name("Консультация")
    assert not is_course_like_direction_name("Массаж")


def test_admin_only_booking_names():
    # KPI-пакеты — только админ
    assert is_admin_only_booking_direction_name("Курс")
    assert is_admin_only_booking_direction_name("Протокол")
    assert is_admin_only_booking_direction_name("Курс 90")
    # «Курс 15» — обычная запись, менеджер может
    assert not is_admin_only_booking_direction_name("Курс 15")
    assert not is_admin_only_booking_direction_name("курс 15")
    assert not is_admin_only_booking_direction_name("Массаж")
    assert not is_admin_only_booking_direction_name("Консультация")


def test_consultation_and_ganchina():
    assert is_consultation_direction_name("Консультация")
    assert is_ganchina_specialist_name("Замири Ганчина")
    assert is_ganchina_specialist_name("Ганчина З.")
    assert not is_ganchina_specialist_name("Мадина Саидова")


def test_split_prepaid_across_days_massage_example():
    # 750 предоплата на 5×150
    assert _split_prepaid_across_days(750, [150, 150, 150, 150, 150]) == [
        150.0,
        150.0,
        150.0,
        150.0,
        150.0,
    ]


def test_split_prepaid_partial():
    assert _split_prepaid_across_days(200, [150, 150, 150]) == [150.0, 50.0, 0.0]


def test_split_prepaid_overpay_stays_on_first():
    assert _split_prepaid_across_days(500, [100, 100]) == [400.0, 100.0]
