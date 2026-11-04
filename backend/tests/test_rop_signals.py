"""Сигналы планёрки РОП."""

from datetime import UTC, datetime, timedelta

from app.services.rop_signals import (
    ManagerSignalInput,
    collect_signals,
    detect_offline,
    detect_overload,
    detect_unreplied,
    waiting_unreplied,
)


def _m(**kwargs) -> ManagerSignalInput:
    base = dict(
        manager_id=1,
        manager_name="Азиза",
        is_online=True,
        active_leads=0,
        hot_leads=0,
        unreplied_count=0,
    )
    base.update(kwargs)
    return ManagerSignalInput(**base)


def test_waiting_unreplied_inbound_without_reply():
    now = datetime(2026, 11, 4, 12, 0, tzinfo=UTC)
    old = now - timedelta(hours=5)
    assert waiting_unreplied(
        messages=[("in", old)],
        now=now,
        threshold_hours=4,
        lead_created_at=old,
    )
    assert not waiting_unreplied(
        messages=[("in", old), ("out", now - timedelta(hours=1))],
        now=now,
        threshold_hours=4,
        lead_created_at=old,
    )


def test_waiting_unreplied_no_messages_old_card():
    now = datetime(2026, 11, 4, 12, 0, tzinfo=UTC)
    created = now - timedelta(hours=6)
    assert waiting_unreplied(messages=[], now=now, threshold_hours=4, lead_created_at=created)
    assert not waiting_unreplied(
        messages=[],
        now=now,
        threshold_hours=4,
        lead_created_at=now - timedelta(hours=1),
    )


def test_detect_unreplied_and_offline():
    unreplied = detect_unreplied([_m(unreplied_count=7)])
    assert unreplied[0].kind == "unreplied"
    assert unreplied[0].severity == "critical"
    offline = detect_offline([_m(is_online=False, hot_leads=3, manager_name="Дилшод")])
    assert offline[0].kind == "offline"
    assert "Дилшод" in offline[0].title


def test_detect_overload_vs_median():
    managers = [
        _m(manager_id=1, manager_name="А", active_leads=4),
        _m(manager_id=2, manager_name="Б", active_leads=5),
        _m(manager_id=3, manager_name="В", active_leads=24),
    ]
    over = detect_overload(managers)
    assert len(over) == 1
    assert over[0].manager_name == "В"


def test_collect_signals_order():
    managers = [
        _m(manager_id=1, manager_name="Азиза", unreplied_count=2, is_online=False, hot_leads=1, active_leads=4),
        _m(manager_id=2, manager_name="Мадина", is_online=True, active_leads=30, hot_leads=0),
        _m(manager_id=3, manager_name="Дилшод", is_online=True, active_leads=5),
    ]
    kinds = [s.kind for s in collect_signals(managers)]
    assert kinds[0] == "unreplied"
    assert "offline" in kinds
    assert "overload" in kinds
