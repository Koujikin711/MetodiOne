"""Phase 8F: Course15 Deposit DQ — read-only A/B/C/D (no auto-fix)."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from decimal import Decimal

from app.models.patient_purchase import PatientPurchase
from app.services.deposit_dq import (
    CLASS_A,
    CLASS_B,
    CLASS_C,
    CLASS_D,
    CLASS_FOLLOWUP,
    POSSIBLE_DEPOSIT_MAX_DEFAULT,
    classify_course15_deposit,
    classify_course15_for_dq,
    is_free_followup_inspection,
)


def test_default_band_covers_audit_examples_not_rewrite():
    assert POSSIBLE_DEPOSIT_MAX_DEFAULT == Decimal("500")


def test_class_a_clear_partial_1300_300():
    klass, reasons = classify_course15_deposit(
        service_amount=Decimal("1300"),
        paid_amount=Decimal("300"),
    )
    assert klass == CLASS_A
    assert any("clear partial" in r.lower() or ">" in r for r in reasons)


def test_class_b_technically_full_300_300():
    klass, reasons = classify_course15_deposit(
        service_amount=Decimal("300"),
        paid_amount=Decimal("300"),
    )
    assert klass == CLASS_B
    assert any("band" in r.lower() or "possible-deposit" in r.lower() for r in reasons)
    # must NOT claim rewrite to 1300
    assert not any("1300" in r and "rewrite" in r.lower() for r in reasons)


def test_class_b_200_200():
    klass, _ = classify_course15_deposit(
        service_amount=Decimal("200"),
        paid_amount=Decimal("200"),
    )
    assert klass == CLASS_B


def test_class_c_clear_full_above_band():
    klass, reasons = classify_course15_deposit(
        service_amount=Decimal("1300"),
        paid_amount=Decimal("1300"),
    )
    assert klass == CLASS_C
    assert any("clear full" in r.lower() or "above" in r.lower() for r in reasons)


def test_class_d_zero_service():
    klass, _ = classify_course15_deposit(
        service_amount=Decimal("0"),
        paid_amount=Decimal("0"),
    )
    assert klass == CLASS_D


def test_band_is_configurable_not_catalog_price():
    """Raising band does not invent true price — only changes DQ flag boundary."""
    klass_low, _ = classify_course15_deposit(
        service_amount=Decimal("400"),
        paid_amount=Decimal("400"),
        possible_deposit_max=Decimal("300"),
    )
    klass_high, _ = classify_course15_deposit(
        service_amount=Decimal("400"),
        paid_amount=Decimal("400"),
        possible_deposit_max=Decimal("500"),
    )
    assert klass_low == CLASS_C
    assert klass_high == CLASS_B


def _row(**kw) -> PatientPurchase:
    base = dict(
        id=1,
        company_id=1,
        lead_id=7,
        source_type="booking_appointment",
        source_id=1,
        product_kind="course_15",
        product_name="Курс 15",
        service_amount=Decimal("0"),
        paid_amount=Decimal("0"),
        status="active",
        purchased_at=datetime(2026, 6, 15, tzinfo=UTC),
    )
    base.update(kw)
    return PatientPurchase(**base)


def test_zero_after_clear_full_is_followup_not_class_d():
    course = _row(
        id=1,
        source_id=1,
        service_amount=Decimal("1300"),
        paid_amount=Decimal("1300"),
        purchased_at=datetime(2026, 6, 1, tzinfo=UTC),
    )
    visit = _row(
        id=2,
        source_id=2,
        service_amount=Decimal("0"),
        paid_amount=Decimal("0"),
        purchased_at=datetime(2026, 6, 15, tzinfo=UTC),
    )
    assert is_free_followup_inspection(visit, [course, visit]) is True
    klass, _ = classify_course15_for_dq(visit, [course, visit])
    assert klass == CLASS_FOLLOWUP
    assert klass != CLASS_D


def test_admin_price_1100_and_1200_fully_paid_opens_followup():
    """Сумму курса задаёт админ. 1100 и 1200 — такой же закрытый договор, как 1300."""
    for amount in (Decimal("1100"), Decimal("1200")):
        course = _row(
            id=1,
            source_id=1,
            service_amount=amount,
            paid_amount=amount,
            purchased_at=datetime(2026, 6, 1, tzinfo=UTC),
        )
        visit = _row(id=2, source_id=2, purchased_at=datetime(2026, 6, 15, tzinfo=UTC))
        assert is_free_followup_inspection(visit, [course, visit]) is True
        assert classify_course15_deposit(service_amount=amount, paid_amount=amount)[0] == CLASS_C


def test_zero_after_clear_partial_stays_class_d():
    course = _row(
        id=1,
        source_id=1,
        service_amount=Decimal("1300"),
        paid_amount=Decimal("300"),
        purchased_at=datetime(2026, 6, 1, tzinfo=UTC),
    )
    visit = _row(id=2, source_id=2, purchased_at=datetime(2026, 6, 20, tzinfo=UTC))
    assert classify_course15_deposit(service_amount=Decimal("1300"), paid_amount=Decimal("300"))[0] == CLASS_A
    assert is_free_followup_inspection(visit, [course, visit]) is False
    klass, _ = classify_course15_for_dq(visit, [course, visit])
    assert klass == CLASS_D


def test_zero_after_possible_deposit_stays_class_d():
    deposit = _row(
        id=1,
        source_id=1,
        service_amount=Decimal("300"),
        paid_amount=Decimal("300"),
        purchased_at=datetime(2026, 6, 1, tzinfo=UTC),
    )
    visit = _row(id=2, source_id=2, purchased_at=datetime(2026, 6, 20, tzinfo=UTC))
    assert is_free_followup_inspection(visit, [deposit, visit]) is False
    klass, _ = classify_course15_for_dq(visit, [deposit, visit])
    assert klass == CLASS_D


def test_zero_without_prior_course_stays_class_d():
    visit = _row(purchased_at=datetime(2026, 6, 15, tzinfo=UTC))
    assert is_free_followup_inspection(visit, [visit]) is False
    klass, _ = classify_course15_for_dq(visit, [visit])
    assert klass == CLASS_D


def test_doctor_visit_is_free_only_a_month_after_paid_course_or_protocol():
    """Курс и Протокол: приём к врачу бесплатный с 30-го дня. Массаж и ранний визит — нет."""
    start = datetime(2026, 6, 1, tzinfo=UTC)
    course = _row(
        id=1,
        source_id=1,
        product_kind="main_course",
        product_name="Курс",
        service_amount=Decimal("17000"),
        paid_amount=Decimal("17000"),
        purchased_at=start,
    )
    early = _row(
        id=2,
        source_id=2,
        product_kind="other_service",
        product_name="Консультация",
        purchased_at=start + timedelta(days=10),
    )
    doctor = _row(
        id=3,
        source_id=3,
        product_kind="other_service",
        product_name="Приём к врачу",
        purchased_at=start + timedelta(days=30),
    )
    massage = _row(
        id=4,
        source_id=4,
        product_kind="other_service",
        product_name="Массаж",
        purchased_at=start + timedelta(days=40),
    )
    paid_consult = _row(
        id=5,
        source_id=5,
        product_kind="other_service",
        product_name="Консультация",
        service_amount=Decimal("150"),
        paid_amount=Decimal("150"),
        purchased_at=start + timedelta(days=40),
    )
    siblings = [course, early, doctor, massage, paid_consult]
    assert is_free_followup_inspection(early, siblings) is False
    assert is_free_followup_inspection(doctor, siblings) is True
    assert is_free_followup_inspection(massage, siblings) is False
    assert is_free_followup_inspection(paid_consult, siblings) is False

    protocol = _row(
        id=6,
        source_id=6,
        product_kind="protocol",
        product_name="Протокол",
        service_amount=Decimal("3000"),
        paid_amount=Decimal("3000"),
        purchased_at=start,
    )
    after_protocol = _row(
        id=7,
        source_id=7,
        product_kind="other_service",
        product_name="Консультация",
        purchased_at=start + timedelta(days=30),
    )
    assert is_free_followup_inspection(after_protocol, [protocol, after_protocol]) is True

    partial = _row(
        id=8,
        source_id=8,
        product_kind="protocol",
        product_name="Протокол",
        service_amount=Decimal("3000"),
        paid_amount=Decimal("300"),
        purchased_at=start,
    )
    assert is_free_followup_inspection(after_protocol, [partial, after_protocol]) is False


def test_main_course_first_of_three_stages_opens_doctor_visit():
    """Курс на три этапа: треть суммы открывает приём с 30-го дня. Аванс и Курс 15 — нет."""
    start = datetime(2026, 6, 1, tzinfo=UTC)
    third = (Decimal("18000") / Decimal(3)).quantize(Decimal("0.01"))
    course = _row(
        id=1,
        source_id=1,
        product_kind="main_course",
        product_name="Курс",
        service_amount=Decimal("18000"),
        paid_amount=third,
        purchased_at=start,
    )
    doctor = _row(
        id=2,
        source_id=2,
        product_kind="other_service",
        product_name="Консультация",
        purchased_at=start + timedelta(days=30),
    )
    early = _row(
        id=3,
        source_id=3,
        product_kind="other_service",
        product_name="Консультация",
        purchased_at=start + timedelta(days=10),
    )
    assert is_free_followup_inspection(doctor, [course, doctor, early]) is True
    assert is_free_followup_inspection(early, [course, doctor, early]) is False

    deposit = _row(
        id=4,
        source_id=4,
        product_kind="main_course",
        product_name="Курс",
        service_amount=Decimal("18000"),
        paid_amount=Decimal("300"),
        purchased_at=start,
    )
    assert is_free_followup_inspection(doctor, [deposit, doctor]) is False

    course15 = _row(
        id=5,
        source_id=5,
        product_kind="course_15",
        product_name="Курс 15",
        service_amount=Decimal("1300"),
        paid_amount=Decimal("433"),
        purchased_at=start,
    )
    assert is_free_followup_inspection(doctor, [course15, doctor]) is False


def test_related_higher_only_enriches_b_reasons():
    klass, reasons = classify_course15_deposit(
        service_amount=Decimal("300"),
        paid_amount=Decimal("300"),
        related_higher_service=True,
    )
    assert klass == CLASS_B
    assert any("higher service_amount" in r for r in reasons)
