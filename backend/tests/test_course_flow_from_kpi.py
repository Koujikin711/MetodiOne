from datetime import date

from app.services.course_flow_from_kpi import new_flow_period
from app.services.course_program_period import COURSE_DURATION_DAYS
from app.services.patient_ltv import classify_product_kind


def test_new_course_flow_lasts_program_term():
    start, end = new_flow_period(date(2026, 9, 30))
    assert start == date(2026, 9, 30)
    assert (end - start).days == COURSE_DURATION_DAYS


def test_protocol_is_not_a_course_flow():
    assert classify_product_kind("Протокол") == "protocol"
    assert classify_product_kind("Курс") == "main_course"
    assert classify_product_kind("Курс 15") == "course_15"
