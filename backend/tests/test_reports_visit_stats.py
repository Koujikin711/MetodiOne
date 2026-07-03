from app.routers.reports import _aggregate_expert_visit_stats
from app.services.booking_visit_labels import VisitLabelInfo


def test_first_and_repeat_from_visit_labels():
    rows = [
        (1, 10, "+79001111111", "completed"),
        (2, 10, "+79001111111", "completed"),
        (3, 10, "+79002222222", "booked"),
    ]
    visit_map = {
        1: VisitLabelInfo(visit_number=39, visit_label="39"),
        2: VisitLabelInfo(visit_number=40, visit_label="40"),
        3: VisitLabelInfo(visit_number=1, visit_label="1"),
    }
    stats = _aggregate_expert_visit_stats(rows, visit_map)
    assert len(stats[10]["first_phones"]) == 1
    assert len(stats[10]["repeat_phones"]) == 1


def test_visit_stats_skip_cancelled():
    rows = [
        (1, 5, "+79003333333", "completed"),
        (2, 5, "+79003333333", "cancelled"),
    ]
    visit_map = {
        1: VisitLabelInfo(visit_number=2, visit_label="2"),
        2: VisitLabelInfo(visit_number=3, visit_label="3"),
    }
    stats = _aggregate_expert_visit_stats(rows, visit_map)
    assert len(stats[5]["repeat_phones"]) == 1


def test_course_stream_repeat_patient():
    rows = [(1, 7, "+79004444444", "completed")]
    visit_map = {
        1: VisitLabelInfo(
            visit_number=10,
            visit_stream=2,
            visit_stream_day=10,
            visit_label="2:10",
        ),
    }
    stats = _aggregate_expert_visit_stats(rows, visit_map)
    assert len(stats[7]["repeat_phones"]) == 1
