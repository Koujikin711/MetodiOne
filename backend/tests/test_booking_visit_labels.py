from datetime import datetime, timedelta, timezone

from app.services.booking_visit_labels import (
    CourseStreamSettings,
    _labels_for_client_group,
    compute_course_stream_labels,
    visit_person_key,
)


def _dt(days: int, hour: int = 10) -> datetime:
    base = datetime(2026, 1, 1, hour, 0, tzinfo=timezone.utc)
    return base + timedelta(days=days)


def test_stream_day_is_sequential_not_calendar():
    """Пауза без записей не увеличивает номер дня — только реальные визиты."""
    cfg = CourseStreamSettings(enabled=True, max_days=15, min_day_for_next=10, gap_days=10)
    appts = [
        (1, _dt(0)),
        (2, _dt(14)),
    ]
    out = compute_course_stream_labels(appts, cfg)
    assert out[1].visit_label == "1:1"
    assert out[2].visit_label == "1:2"


def test_max_days_starts_new_stream_by_session_count():
    cfg = CourseStreamSettings(enabled=True, max_days=3, min_day_for_next=10, gap_days=10)
    appts = [(i, _dt(i)) for i in range(1, 5)]
    out = compute_course_stream_labels(appts, cfg)
    assert out[1].visit_label == "1:1"
    assert out[2].visit_label == "1:2"
    assert out[3].visit_label == "1:3"
    assert out[4].visit_label == "2:1"


def test_gap_after_min_day_starts_new_stream():
    cfg = CourseStreamSettings(enabled=True, max_days=15, min_day_for_next=2, gap_days=5)
    appts = [
        (1, _dt(0)),
        (2, _dt(1)),
        (3, _dt(10)),
    ]
    out = compute_course_stream_labels(appts, cfg)
    assert out[1].visit_label == "1:1"
    assert out[2].visit_label == "1:2"
    assert out[3].visit_label == "2:1"


def test_same_phone_different_people_are_not_one_chain():
    def norm(phone):
        digits = "".join(ch for ch in (phone or "") if ch.isdigit())
        return digits or None

    phone = "+992900000111"
    ali = visit_person_key(lead_id=None, patient_name="Махмудов Али", phone=phone, norm_phone=norm)
    haticha = visit_person_key(lead_id=None, patient_name="Махмудова Хатича", phone=phone, norm_phone=norm)
    assert ali != haticha
    same = visit_person_key(lead_id=5, patient_name="Другое имя", phone=phone, norm_phone=norm)
    again = visit_person_key(lead_id=5, patient_name="Махмудов Али", phone="другой", norm_phone=norm)
    assert same == again


def test_no_show_does_not_advance_stream_only_completed_count():
    cfg = CourseStreamSettings(enabled=True, max_days=15, min_day_for_next=10, gap_days=10)
    completed = [(1, _dt(0)), (3, _dt(5))]
    booked = [(2, _dt(2))]
    out = _labels_for_client_group(completed, booked, enabled=True, cfg=cfg)
    assert out[1].visit_label == "1:1"
    assert out[3].visit_label == "1:2"
    assert out[2].visit_label == "1:2"
