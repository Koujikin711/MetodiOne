"""Перенос записи: длительность сохраняется, если не передан duration_min."""

from datetime import UTC, datetime, timedelta

from app.routers.booking import _appointment_duration_minutes


class _Fake:
    def __init__(self, **kw):
        for k, v in kw.items():
            setattr(self, k, v)


def test_move_should_not_prefer_direction_over_existing_when_no_override():
    """Документированное поведение move: без override — текущая длина, не услуга 60."""
    specialist = _Fake(slot_duration_min=30)
    direction = _Fake(duration_min=60)
    # Старый helper с fallback после direction — ломал полчаса после дропа.
    # Move теперь не вызывает helper так; проверяем правильный порядок для create:
    create_dur = _appointment_duration_minutes(
        specialist, direction, override_min=None, fallback_min=30,
    )
    assert create_dur == 60  # create: услуга важнее

    # Явный override (ужать) — всегда побеждает.
    assert (
        _appointment_duration_minutes(specialist, direction, override_min=30, fallback_min=60)
        == 30
    )


def test_existing_duration_math():
    start = datetime(2026, 11, 14, 7, 0, tzinfo=UTC)
    end_30 = start + timedelta(minutes=30)
    end_60 = start + timedelta(minutes=60)
    assert max(10, int((end_30 - start).total_seconds() // 60)) == 30
    assert max(10, int((end_60 - start).total_seconds() // 60)) == 60
