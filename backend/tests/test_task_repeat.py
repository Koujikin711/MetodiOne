from datetime import datetime
from zoneinfo import ZoneInfo

from app.services.task_repeat import is_due, roll_to_today, same_hour_tomorrow

_TZ = ZoneInfo("Asia/Dushanbe")


def test_overdue_daily_task_moves_to_today_same_hour() -> None:
    deadline = datetime(2026, 10, 10, 14, 30, tzinfo=_TZ)
    now = datetime(2026, 10, 12, 9, 0, tzinfo=_TZ)
    moved = roll_to_today(deadline, now)
    assert moved is not None
    assert moved.tzinfo is None
    assert moved.date().isoformat() == "2026-10-12"
    assert (moved.hour, moved.minute) == (14, 30)


def test_warning_starts_at_the_same_hour() -> None:
    deadline = datetime(2026, 10, 12, 14, 0, tzinfo=_TZ)
    assert not is_due(deadline, datetime(2026, 10, 12, 13, 59, tzinfo=_TZ))
    assert is_due(deadline, datetime(2026, 10, 12, 14, 0, tzinfo=_TZ))


def test_warning_stages_are_30_then_15_then_the_hour() -> None:
    from datetime import timedelta

    from app.services.task_repeat import warn_stage

    deadline = datetime(2026, 10, 12, 14, 0, tzinfo=_TZ)
    assert warn_stage(deadline, deadline - timedelta(minutes=31)) is None
    assert warn_stage(deadline, deadline - timedelta(minutes=30)) == "30"
    assert warn_stage(deadline, deadline - timedelta(minutes=16)) == "30"
    assert warn_stage(deadline, deadline - timedelta(minutes=15)) == "15"
    assert warn_stage(deadline, deadline - timedelta(minutes=1)) == "15"
    assert warn_stage(deadline, deadline) == "due"


def test_manager_chat_text_names_the_task_and_phone() -> None:
    from app.services.task_team_chat import manager_task_chat_text

    text = manager_task_chat_text(
        title="Связаться с клиентом",
        deadline=datetime(2026, 10, 12, 10, 0),
        client_name="Абдуллоева Рухшона",
        client_phone="9001112233",
    )
    assert "Новая задача: Связаться с клиентом" in text
    assert "Клиент: Абдуллоева Рухшона" in text
    assert "Номер: 9001112233" in text
    assert "12.10.2026 10:00" in text


def test_next_day_keeps_the_hour() -> None:
    deadline = datetime(2026, 10, 12, 14, 15, tzinfo=_TZ)
    nxt = same_hour_tomorrow(deadline)
    assert nxt.tzinfo is None
    assert nxt.date().isoformat() == "2026-10-13"
    assert (nxt.hour, nxt.minute) == (14, 15)
