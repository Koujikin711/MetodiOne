"""Phase 8A: dual LTV Entry eligibility (CURRENT purchase / TARGET fully_paid)."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from decimal import Decimal

from app.models.patient_purchase import PatientPurchase, PatientPurchasePayment
from app.services.deposit_dq import is_cashless_purchase, is_free_followup_inspection
from app.services.patient_ltv import compute_lead_ltv
from app.services.patient_ltv_analytics import LTV_WINDOWS_DAYS
from app.services.ltv_entry_eligibility import (
    ENTRY_MODE_FULLY_PAID,
    ENTRY_MODE_PURCHASE,
    PRODUCTION_ENTRY_MODE,
    entry_purchase_count,
    first_entry_at,
    first_entry_purchase,
    purchase_is_fully_paid_for_entry,
)


def _p(**kw) -> PatientPurchase:
    base = dict(
        company_id=1,
        lead_id=1,
        source_type="kpi_manual_sale",
        source_id=1,
        product_kind="course_15",
        product_name="Курс 15",
        service_amount=Decimal("1300"),
        paid_amount=Decimal("0"),
        status="active",
        purchased_at=datetime(2026, 6, 1, tzinfo=UTC),
    )
    base.update(kw)
    return PatientPurchase(**base)


def test_production_mode_is_purchase():
    assert PRODUCTION_ENTRY_MODE == ENTRY_MODE_PURCHASE


def test_clear_partial_not_fully_paid_entry():
    """CASE: sa=1300 pa=300 — Purchase Event yes; TARGET Entry no."""
    p = _p(paid_amount=Decimal("300"), service_amount=Decimal("1300"))
    assert purchase_is_fully_paid_for_entry(p) is False
    assert first_entry_purchase([p], ENTRY_MODE_PURCHASE) is p
    assert first_entry_purchase([p], ENTRY_MODE_FULLY_PAID) is None


def test_clear_full_relative_to_actual_amount():
    """Individual contracted amount 1100 fully paid → TARGET Entry."""
    p = _p(service_amount=Decimal("1100"), paid_amount=Decimal("1100"))
    assert purchase_is_fully_paid_for_entry(p) is True
    assert first_entry_at([p], ENTRY_MODE_FULLY_PAID) == p.purchased_at


def test_technically_full_possible_deposit_still_passes_predicate():
    """sa=pa=300 passes money predicate — Deposit DQ (8F) must classify; no hardcode 1300."""
    p = _p(service_amount=Decimal("300"), paid_amount=Decimal("300"))
    assert purchase_is_fully_paid_for_entry(p) is True


def test_included_visit_does_not_move_entry_in_either_mode():
    """Повторный нулевой визит после полного курса не становится датой входа."""
    course = _p(
        id=1,
        source_id=1,
        service_amount=Decimal("1300"),
        paid_amount=Decimal("1300"),
        purchased_at=datetime(2026, 6, 1, tzinfo=UTC),
    )
    visit = _p(
        id=2,
        source_id=2,
        source_type="booking_appointment",
        service_amount=Decimal("0"),
        paid_amount=Decimal("0"),
        purchased_at=datetime(2026, 6, 20, tzinfo=UTC),
    )
    assert first_entry_purchase([visit, course], ENTRY_MODE_PURCHASE) is course
    assert first_entry_purchase([visit, course], ENTRY_MODE_FULLY_PAID) is course
    assert entry_purchase_count([course, visit], ENTRY_MODE_PURCHASE) == 1
    assert entry_purchase_count([course, visit], ENTRY_MODE_FULLY_PAID) == 1
    pay = PatientPurchasePayment(
        id=1,
        company_id=1,
        purchase_id=1,
        source_type="kpi_payment",
        source_id=1,
        amount=Decimal("1300"),
        is_refund=False,
        paid_at=course.purchased_at,
    )
    zero_pay = PatientPurchasePayment(
        id=2,
        company_id=1,
        purchase_id=2,
        source_type="booking_payment",
        source_id=2,
        amount=Decimal("0"),
        is_refund=False,
        paid_at=visit.purchased_at,
    )
    with_visit = compute_lead_ltv([course, visit], [pay, zero_pay])
    without_visit = compute_lead_ltv([course], [pay])
    assert with_visit.paid_ltv == without_visit.paid_ltv
    assert with_visit.sales_value == without_visit.sales_value


def test_zero_service_amount_not_entry_even_if_completed():
    p = _p(
        service_amount=Decimal("0"),
        paid_amount=Decimal("0"),
        status="completed",
        source_type="booking_appointment",
    )
    assert purchase_is_fully_paid_for_entry(p) is False
    assert first_entry_purchase([p], ENTRY_MODE_FULLY_PAID) is None
    assert first_entry_purchase([p], ENTRY_MODE_PURCHASE) is None


def test_paid_procedure_counts_admin_course_price_does_not():
    """1100 — договор админа. Массаж 150 входит в повтор. Нулевой осмотр — нет."""
    course = _p(
        id=1,
        source_id=1,
        service_amount=Decimal("1100"),
        paid_amount=Decimal("1100"),
        purchased_at=datetime(2026, 6, 1, tzinfo=UTC),
    )
    visit = _p(
        id=2,
        source_id=2,
        source_type="booking_appointment",
        service_amount=Decimal("0"),
        paid_amount=Decimal("0"),
        purchased_at=datetime(2026, 6, 10, tzinfo=UTC),
    )
    massage = _p(
        id=3,
        source_id=3,
        source_type="booking_appointment",
        product_kind="other_service",
        product_name="Массаж",
        service_amount=Decimal("150"),
        paid_amount=Decimal("150"),
        purchased_at=datetime(2026, 6, 20, tzinfo=UTC),
    )
    assert first_entry_purchase([visit, massage, course], ENTRY_MODE_PURCHASE) is course
    assert entry_purchase_count([course, visit, massage], ENTRY_MODE_PURCHASE) == 2
    partial = _p(
        id=4,
        source_id=4,
        service_amount=Decimal("1200"),
        paid_amount=Decimal("300"),
        purchased_at=datetime(2026, 5, 1, tzinfo=UTC),
    )
    early_zero = _p(
        id=5,
        source_id=5,
        source_type="booking_appointment",
        service_amount=Decimal("0"),
        paid_amount=Decimal("0"),
        purchased_at=datetime(2026, 5, 20, tzinfo=UTC),
    )
    assert first_entry_purchase([early_zero, partial], ENTRY_MODE_PURCHASE) is partial


def test_paid_500_after_class_c_lands_in_d30_through_d365_zero_does_not():
    """Процедура 500 после класса C входит в D30–D365. Осмотр за 0 не входит ни в кассу, ни в число пациентов."""
    t0 = datetime(2026, 6, 1, tzinfo=UTC)
    course = _p(
        id=1,
        source_id=1,
        service_amount=Decimal("1100"),
        paid_amount=Decimal("1100"),
        purchased_at=t0,
    )
    visit = _p(
        id=2,
        source_id=2,
        source_type="booking_appointment",
        service_amount=Decimal("0"),
        paid_amount=Decimal("0"),
        purchased_at=t0 + timedelta(days=10),
    )
    procedure = _p(
        id=3,
        source_id=3,
        source_type="booking_appointment",
        product_kind="other_service",
        product_name="ТМС",
        service_amount=Decimal("500"),
        paid_amount=Decimal("500"),
        purchased_at=t0 + timedelta(days=20),
    )
    assert is_free_followup_inspection(visit, [course, visit, procedure]) is True
    assert is_cashless_purchase(visit) is True
    assert is_cashless_purchase(procedure) is False
    money = [p for p in (course, visit, procedure) if not is_cashless_purchase(p)]
    assert money == [course, procedure]
    pays = {
        1: t0,
        3: t0 + timedelta(days=20),
    }
    amounts = {1: Decimal("1100"), 3: Decimal("500")}
    windows = {}
    for d in LTV_WINDOWS_DAYS:
        end = t0 + timedelta(days=1) if d == 0 else t0 + timedelta(days=d)
        windows[d] = sum((amounts[pid] for pid, pt in pays.items() if t0 <= pt < end), Decimal("0"))
    assert windows[0] == Decimal("1100")
    assert windows[30] == Decimal("1600")
    assert windows[90] == windows[180] == windows[365] == Decimal("1600")


def test_first_entry_shifts_when_deposit_then_full():
    deposit = _p(
        id=1,
        source_id=1,
        paid_amount=Decimal("300"),
        service_amount=Decimal("1300"),
        purchased_at=datetime(2026, 1, 1, tzinfo=UTC),
    )
    massage = _p(
        id=2,
        source_id=2,
        product_kind="other_service",
        product_name="Массаж",
        service_amount=Decimal("150"),
        paid_amount=Decimal("150"),
        purchased_at=datetime(2026, 2, 1, tzinfo=UTC),
    )
    assert first_entry_purchase([deposit, massage], ENTRY_MODE_PURCHASE) is deposit
    assert first_entry_purchase([deposit, massage], ENTRY_MODE_FULLY_PAID) is massage
    assert first_entry_at([deposit, massage], ENTRY_MODE_PURCHASE) != first_entry_at(
        [deposit, massage], ENTRY_MODE_FULLY_PAID,
    )


def test_returned_excluded_from_fully_paid_entry():
    p = _p(
        service_amount=Decimal("1300"),
        paid_amount=Decimal("1300"),
        status="returned",
    )
    assert purchase_is_fully_paid_for_entry(p) is False


def test_entry_purchase_count_modes():
    partial = _p(id=1, source_id=1, paid_amount=Decimal("300"), service_amount=Decimal("1300"))
    full = _p(
        id=2,
        source_id=2,
        product_kind="other_service",
        product_name="ЭЭГ",
        service_amount=Decimal("400"),
        paid_amount=Decimal("400"),
        purchased_at=datetime(2026, 3, 1, tzinfo=UTC),
    )
    assert entry_purchase_count([partial, full], ENTRY_MODE_PURCHASE) == 2
    assert entry_purchase_count([partial, full], ENTRY_MODE_FULLY_PAID) == 1


def test_no_hardcoded_course15_price_in_predicate():
    """1300 is not special — 1200 fully paid is Entry; 1300/300 is not."""
    assert purchase_is_fully_paid_for_entry(
        _p(service_amount=Decimal("1200"), paid_amount=Decimal("1200")),
    )
    assert not purchase_is_fully_paid_for_entry(
        _p(service_amount=Decimal("1300"), paid_amount=Decimal("300")),
    )
