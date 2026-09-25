"""Phase 8C: Course15 waiting / next-product queue classification."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from decimal import Decimal

from app.models.patient_purchase import PatientPurchase
from app.services.course15_queue import (
    ACTIVE_QUEUE_STATES,
    classify_course15_queue_state,
    next_program_purchase_counts,
    requires_attention,
)


def _p(
    *,
    id: int,
    kind: str,
    name: str,
    sa: str = "1300",
    pa: str = "1300",
    status: str = "active",
    day: int = 1,
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
        purchased_at=datetime(2026, 6, day, tzinfo=UTC),
    )


def test_case_a_course15_only_active_or_waiting():
    # fully paid → waiting; partial → active
    full = [_p(id=1, kind="course_15", name="Курс 15", sa="1300", pa="1300")]
    info = classify_course15_queue_state(full)
    assert info is not None
    assert info["state"] == "waiting_next_step"
    assert info["state"] in ACTIVE_QUEUE_STATES

    partial = [_p(id=2, kind="course_15", name="Курс 15", sa="1300", pa="300")]
    info2 = classify_course15_queue_state(partial)
    assert info2 is not None
    assert info2["state"] == "active"


def test_case_b_massage_keeps_waiting():
    ps = [
        _p(id=1, kind="course_15", name="Курс 15", day=1),
        _p(id=2, kind="other_service", name="Массаж", sa="150", pa="150", day=5),
    ]
    assert classify_course15_queue_state(ps)["state"] == "waiting_next_step"


def test_case_c_tms_eeg_keep_waiting():
    ps = [
        _p(id=1, kind="course_15", name="Курс 15", day=1),
        _p(id=2, kind="other_service", name="ТМС", sa="300", pa="300", day=3),
        _p(id=3, kind="other_service", name="ЭЭГ", sa="400", pa="400", day=4),
    ]
    assert classify_course15_queue_state(ps)["state"] == "waiting_next_step"


def test_case_d_course_closes_waiting():
    ps = [
        _p(id=1, kind="course_15", name="Курс 15", day=1),
        _p(id=2, kind="main_course", name="Курс", sa="17000", pa="5000", day=10),
    ]
    info = classify_course15_queue_state(ps)
    assert info["state"] == "converted_to_course"
    assert info["state"] not in ACTIVE_QUEUE_STATES


def test_case_e_protocol_closes_waiting():
    ps = [
        _p(id=1, kind="course_15", name="Курс 15", day=1),
        _p(id=2, kind="protocol", name="Протокол", sa="3000", pa="3000", day=10),
    ]
    assert classify_course15_queue_state(ps)["state"] == "converted_to_protocol"


def test_case_f_massage_then_course_closes():
    ps = [
        _p(id=1, kind="course_15", name="Курс 15", day=1),
        _p(id=2, kind="other_service", name="Массаж", sa="150", pa="150", day=5),
        _p(id=3, kind="main_course", name="Курс", sa="17000", pa="17000", day=20),
    ]
    assert classify_course15_queue_state(ps)["state"] == "converted_to_course"


def test_case_g_eeg_then_protocol_closes():
    ps = [
        _p(id=1, kind="course_15", name="Курс 15", day=1),
        _p(id=2, kind="other_service", name="ЭЭГ", sa="400", pa="400", day=5),
        _p(id=3, kind="protocol", name="Протокол", sa="3000", pa="1000", day=15),
    ]
    assert classify_course15_queue_state(ps)["state"] == "converted_to_protocol"


def test_case_h_course_without_course15_not_in_queue():
    ps = [_p(id=1, kind="main_course", name="Курс", sa="17000", pa="17000", day=1)]
    assert classify_course15_queue_state(ps) is None


def test_case_i_protocol_without_course15_not_in_queue():
    ps = [_p(id=1, kind="protocol", name="Протокол", sa="3000", pa="3000", day=1)]
    assert classify_course15_queue_state(ps) is None


def test_case_j_masterclass_not_required():
    """No masterclass purchase — Course still closes waiting."""
    ps = [
        _p(id=1, kind="course_15", name="Курс 15", day=1),
        _p(id=2, kind="main_course", name="Курс", sa="17000", pa="17000", day=10),
    ]
    assert classify_course15_queue_state(ps)["state"] == "converted_to_course"


def test_case_k_identity_is_lead_not_phone():
    """Classification is per-purchase list of one Lead — phone never appears."""
    a = [_p(id=1, kind="course_15", name="Курс 15", day=1)]
    b = [
        _p(id=1, kind="course_15", name="Курс 15", day=1),
        _p(id=2, kind="main_course", name="Курс", sa="17000", pa="1", day=2),
    ]
    assert classify_course15_queue_state(a)["state"] == "waiting_next_step"
    assert classify_course15_queue_state(b)["state"] == "converted_to_course"


def test_case_l_unresolved_excluded_by_caller():
    """Purchases without lead_id are not passed into classify (API filters lead_id NOT NULL)."""
    p = _p(id=1, kind="course_15", name="Курс 15")
    p.lead_id = None
    # Still classifies if called — build_course15_queue excludes NULL lead_id
    assert classify_course15_queue_state([p]) is not None


def test_next_program_predicate_excludes_returned():
    p = _p(id=1, kind="main_course", name="Курс", status="returned")
    assert next_program_purchase_counts(p) is False


def test_requires_attention_waiting_and_overdue_contact():
    ok, reason = requires_attention(state="waiting_next_step", next_contact_at=None)
    assert ok and reason

    past = datetime.now(UTC) - timedelta(days=1)
    ok2, reason2 = requires_attention(state="active", next_contact_at=past)
    assert ok2 and "просрочен" in (reason2 or "")

    future = datetime.now(UTC) + timedelta(days=1)
    ok3, _ = requires_attention(state="active", next_contact_at=future)
    assert not ok3
