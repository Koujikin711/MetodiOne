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
    assert warn_stage(deadline, deadline + timedelta(hours=3)) == "due"
    assert warn_stage(deadline, deadline + timedelta(days=1)) is None


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


def test_weekday_repeat_skips_days_that_were_not_chosen() -> None:
    from app.services.task_repeat import align_weekday_deadline

    deadline = datetime(2026, 10, 12, 9, 0, tzinfo=_TZ)
    now = datetime(2026, 10, 13, 8, 0, tzinfo=_TZ)
    moved = align_weekday_deadline(deadline, [0, 2], now)
    assert moved is not None
    assert moved.date().isoformat() == "2026-10-14"
    assert (moved.hour, moved.minute) == (9, 0)


def test_weekday_repeat_lands_on_a_chosen_day() -> None:
    from app.services.task_repeat import align_weekday_deadline

    deadline = datetime(2026, 10, 12, 9, 45, tzinfo=_TZ)
    now = datetime(2026, 10, 14, 8, 0, tzinfo=_TZ)
    moved = align_weekday_deadline(deadline, [0, 2], now)
    assert moved is not None
    assert moved.date().isoformat() == "2026-10-14"
    assert (moved.hour, moved.minute) == (9, 45)


def test_future_chosen_weekday_is_left_alone() -> None:
    from app.services.task_repeat import align_weekday_deadline

    deadline = datetime(2026, 10, 14, 9, 0, tzinfo=_TZ)
    now = datetime(2026, 10, 13, 8, 0, tzinfo=_TZ)
    assert align_weekday_deadline(deadline, [0, 2], now) is None


def test_one_date_task_is_not_shifted_onto_weekdays() -> None:
    from app.services.task_repeat import align_weekday_deadline

    deadline = datetime(2026, 10, 10, 9, 0, tzinfo=_TZ)
    now = datetime(2026, 10, 13, 8, 0, tzinfo=_TZ)
    assert align_weekday_deadline(deadline, [], now) is None


def test_next_chosen_weekday_keeps_the_hour() -> None:
    from datetime import timedelta

    from app.services.task_repeat import next_weekday_after, warn_stage

    deadline = datetime(2026, 10, 12, 9, 45, tzinfo=_TZ)
    nxt = next_weekday_after(deadline, [0, 2])
    assert nxt.tzinfo is None
    assert nxt.date().isoformat() == "2026-10-14"
    assert (nxt.hour, nxt.minute) == (9, 45)
    assert warn_stage(nxt.replace(tzinfo=_TZ), nxt.replace(tzinfo=_TZ) - timedelta(minutes=30)) == "30"
    assert warn_stage(nxt.replace(tzinfo=_TZ), nxt.replace(tzinfo=_TZ) - timedelta(minutes=15)) == "15"
    assert warn_stage(nxt.replace(tzinfo=_TZ), nxt.replace(tzinfo=_TZ)) == "due"


def test_several_calendar_dates_land_on_the_earliest_upcoming() -> None:
    from app.services.task_repeat import align_concrete_deadline

    deadline = datetime(2026, 10, 13, 9, 0, tzinfo=_TZ)
    now = datetime(2026, 10, 13, 8, 0, tzinfo=_TZ)
    moved = align_concrete_deadline(deadline, ["2026-10-22", "2026-10-24", "2026-10-27"], now)
    assert moved is not None
    assert moved.date().isoformat() == "2026-10-22"
    assert (moved.hour, moved.minute) == (9, 0)


def test_chosen_calendar_date_is_left_alone() -> None:
    from app.services.task_repeat import align_concrete_deadline

    deadline = datetime(2026, 10, 24, 9, 0, tzinfo=_TZ)
    now = datetime(2026, 10, 13, 8, 0, tzinfo=_TZ)
    assert align_concrete_deadline(deadline, ["2026-10-22", "2026-10-24"], now) is None


def test_passed_calendar_date_moves_forward_not_back() -> None:
    from app.services.task_repeat import align_concrete_deadline

    deadline = datetime(2026, 10, 22, 9, 0, tzinfo=_TZ)
    now = datetime(2026, 10, 23, 8, 0, tzinfo=_TZ)
    moved = align_concrete_deadline(deadline, ["2026-10-22", "2026-10-24", "2026-10-27"], now)
    assert moved is not None
    assert moved.date().isoformat() == "2026-10-24"
    assert (moved.hour, moved.minute) == (9, 0)


def test_one_calendar_date_is_not_a_series() -> None:
    from app.services.task_repeat import align_concrete_deadline, normalize_dates

    now = datetime(2026, 10, 13, 8, 0, tzinfo=_TZ)
    deadline = datetime(2026, 10, 22, 9, 0, tzinfo=_TZ)
    assert normalize_dates(["2026-10-22", "2026-10-22", "bad"]) == ["2026-10-22"]
    assert align_concrete_deadline(deadline, ["2026-10-22"], now) is None


def test_next_calendar_date_keeps_the_hour_and_warnings() -> None:
    from datetime import timedelta

    from app.services.task_repeat import next_concrete_after, warn_stage

    deadline = datetime(2026, 10, 22, 9, 0, tzinfo=_TZ)
    nxt = next_concrete_after(deadline, ["2026-10-22", "2026-10-27", "2026-10-24"])
    assert nxt is not None
    assert nxt.tzinfo is None
    assert nxt.date().isoformat() == "2026-10-24"
    assert (nxt.hour, nxt.minute) == (9, 0)
    assert next_concrete_after(nxt, ["2026-10-22", "2026-10-24"]) is None
    aware = nxt.replace(tzinfo=_TZ)
    assert warn_stage(aware, aware - timedelta(minutes=30)) == "30"
    assert warn_stage(aware, aware - timedelta(minutes=15)) == "15"
    assert warn_stage(aware, aware) == "due"


def test_next_day_keeps_the_hour() -> None:
    deadline = datetime(2026, 10, 12, 14, 15, tzinfo=_TZ)
    nxt = same_hour_tomorrow(deadline)
    assert nxt.tzinfo is None
    assert nxt.date().isoformat() == "2026-10-13"
    assert (nxt.hour, nxt.minute) == (14, 15)
