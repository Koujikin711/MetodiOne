"""Phase 8D: Protocol 30-day curator queue (no daily diary)."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from decimal import Decimal

from app.models.patient_purchase import PatientPurchase
from app.services.protocol_queue import (
    ACTIVE_QUEUE_STATES,
    PROTOCOL_DURATION_DAYS,
    classify_protocol_episodes,
    requires_attention,
)


def _p(
    *,
    id: int,
    kind: str = "protocol",
    name: str = "Протокол",
    sa: str = "3000",
    pa: str = "3000",
    status: str = "active",
    at: datetime,
) -> PatientPurchase:
    return PatientPurchase(
        id=id,
        company_id=1,
        lead_id=10,
        source_type="kpi_manual_sale",
        source_id=id,
        product_kind=kind,
        product_name=name,
        service_amount=Decimal(sa),
        paid_amount=Decimal(pa),
        status=status,
        purchased_at=at,
    )


def test_duration_is_30_days():
    assert PROTOCOL_DURATION_DAYS == 30


def test_protocol_only_active_mid_term():
    start = datetime(2026, 6, 1, tzinfo=UTC)
    now = start + timedelta(days=10)
    eps = classify_protocol_episodes([_p(id=1, at=start)], now=now, ending_soon_days=7)
    assert len(eps) == 1
    assert eps[0]["state"] == "active"
    assert eps[0]["sequence_no"] == 1
    assert eps[0]["days_remaining"] == 20
    assert eps[0]["state"] in ACTIVE_QUEUE_STATES


def test_ending_soon_configurable():
    start = datetime(2026, 6, 1, tzinfo=UTC)
    now = start + timedelta(days=25)
    eps = classify_protocol_episodes([_p(id=1, at=start)], now=now, ending_soon_days=7)
    assert eps[0]["state"] == "ending_soon"
    assert eps[0]["days_remaining"] == 5

    eps2 = classify_protocol_episodes([_p(id=1, at=start)], now=now, ending_soon_days=3)
    assert eps2[0]["state"] == "active"


def test_ended_waiting_next():
    start = datetime(2026, 6, 1, tzinfo=UTC)
    now = start + timedelta(days=35)
    eps = classify_protocol_episodes([_p(id=1, at=start)], now=now)
    assert eps[0]["state"] == "ended_waiting_next"


def test_protocol_2_closes_waiting_on_1_keeps_2_active():
    t1 = datetime(2026, 6, 1, tzinfo=UTC)
    t2 = datetime(2026, 7, 10, tzinfo=UTC)
    now = t2 + timedelta(days=5)
    eps = classify_protocol_episodes([_p(id=1, at=t1), _p(id=2, at=t2)], now=now)
    assert len(eps) == 2
    assert eps[0]["sequence_no"] == 1
    assert eps[0]["state"] == "next_protocol_sold"
    assert eps[0]["state"] not in ACTIVE_QUEUE_STATES
    assert eps[1]["sequence_no"] == 2
    assert eps[1]["state"] == "active"
    assert eps[1]["previous_protocols"][0]["sequence_no"] == 1


def test_massage_and_course_do_not_close_protocol_waiting():
    start = datetime(2026, 6, 1, tzinfo=UTC)
    now = start + timedelta(days=40)
    ps = [
        _p(id=1, kind="protocol", at=start),
        _p(id=2, kind="other_service", name="Массаж", sa="150", pa="150", at=start + timedelta(days=5)),
        _p(id=3, kind="main_course", name="Курс", sa="17000", pa="17000", at=start + timedelta(days=10)),
    ]
    eps = classify_protocol_episodes(ps, now=now)
    assert len(eps) == 1
    assert eps[0]["state"] == "ended_waiting_next"


def test_no_protocol_not_in_queue():
    ps = [
        _p(id=1, kind="course_15", name="Курс 15", sa="1300", pa="1300", at=datetime(2026, 6, 1, tzinfo=UTC)),
    ]
    assert classify_protocol_episodes(ps) == []


def test_requires_attention_rules():
    ok, reason = requires_attention(
        state="ended_waiting_next", days_remaining=-2, next_contact_at=None,
    )
    assert ok and reason

    ok2, reason2 = requires_attention(
        state="ending_soon", days_remaining=0, next_contact_at=None,
    )
    assert ok2 and "сегодня" in (reason2 or "")

    past = datetime.now(UTC) - timedelta(hours=1)
    ok3, _ = requires_attention(
        state="active", days_remaining=20, next_contact_at=past,
    )
    assert ok3


def test_returned_protocol_excluded():
    start = datetime(2026, 6, 1, tzinfo=UTC)
    assert classify_protocol_episodes([_p(id=1, at=start, status="returned")]) == []
