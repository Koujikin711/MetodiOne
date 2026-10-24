"""Время ответа РОП: от входящего клиента до ответа менеджера."""

from datetime import UTC, datetime, timedelta

from app.routers.rop import first_reply_minutes


def _at(minutes: int) -> datetime:
    return datetime(2026, 10, 1, 9, 0, tzinfo=UTC) + timedelta(minutes=minutes)


def test_reply_is_after_first_inbound_not_an_earlier_note():
    messages = [
        ("out", 7, _at(0)),
        ("in", None, _at(10)),
        ("out", None, _at(11)),
        ("out", 7, _at(25)),
    ]
    assert first_reply_minutes(messages, 7) == 15


def test_other_person_and_missing_author_do_not_count():
    messages = [
        ("in", None, _at(0)),
        ("out", 3, _at(4)),
        ("out", None, _at(5)),
    ]
    assert first_reply_minutes(messages, 7) is None


def test_no_inbound_has_no_response_time():
    assert first_reply_minutes([("out", 7, _at(3))], 7) is None
