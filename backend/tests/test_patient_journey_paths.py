"""Universal Journey: Masterclass/Course15 ≠ gate; LTV по реальным purchases."""

from __future__ import annotations

from datetime import UTC, datetime
from decimal import Decimal

from app.models.patient_purchase import PatientPurchase, PatientPurchasePayment
from app.services.patient_journey_paths import (
    LeadJourneyFacts,
    LeadPurchaseFact,
    classify_product_origin,
    conversion_flags,
    course15_funnel_leaf,
    first_product_kind,
    master_class_recorded,
)
from app.services.patient_ltv import compute_lead_ltv


def _facts(kinds: list[str], *, mk: bool = False, c15_status: str = "none") -> LeadJourneyFacts:
    return LeadJourneyFacts(
        purchases=[LeadPurchaseFact(product_kind=k) for k in kinds],
        master_class_at=datetime(2026, 3, 1, tzinfo=UTC) if mk else None,
        course_15_status=c15_status if c15_status != "none" else ("completed" if "course_15" in kinds else "none"),
    )


def _ltv_for_kinds(kinds: list[str]) -> Decimal:
    purchases = [
        PatientPurchase(
            id=i,
            company_id=1,
            lead_id=1,
            source_type="kpi_manual_sale",
            source_id=i,
            product_kind=k,
            product_name=k,
            service_amount=Decimal("100"),
            paid_amount=Decimal("100"),
            status="completed",
            purchased_at=datetime(2026, 1, i, tzinfo=UTC),
        )
        for i, k in enumerate(kinds, start=1)
    ]
    payments = [
        PatientPurchasePayment(
            id=i,
            company_id=1,
            purchase_id=i,
            source_type="kpi_payment",
            source_id=i,
            amount=Decimal("100"),
            is_refund=False,
            paid_at=datetime(2026, 1, i, tzinfo=UTC),
        )
        for i in range(1, len(kinds) + 1)
    ]
    return compute_lead_ltv(purchases, payments).paid_ltv


def test_a_course15_mk_main():
    f = _facts(["course_15", "main_course"], mk=True)
    assert course15_funnel_leaf(f) == "mk_main"
    assert conversion_flags(f)["course15_to_main"] is True
    assert conversion_flags(f)["course15_to_main_without_mk"] is False
    assert classify_product_origin(f, "main_course") == "after_course15_with_mk"


def test_b_course15_main_without_mk_still_in_ltv():
    kinds = ["course_15", "main_course"]
    f = _facts(kinds, mk=False)
    assert master_class_recorded(f) is False
    assert course15_funnel_leaf(f) == "no_mk_main"
    assert conversion_flags(f)["course15_to_main_without_mk"] is True
    assert classify_product_origin(f, "main_course") == "after_course15_mk_not_recorded"
    assert _ltv_for_kinds(kinds) == Decimal("200")


def test_c_course15_protocol_without_mk():
    f = _facts(["course_15", "protocol"], mk=False)
    assert course15_funnel_leaf(f) == "no_mk_protocol"
    assert conversion_flags(f)["course15_to_protocol_without_mk"] is True
    assert _ltv_for_kinds(["course_15", "protocol"]) == Decimal("200")


def test_d_qeeg_main_no_course15():
    f = _facts(["other_service", "main_course"], mk=False)
    assert first_product_kind(f) == "other_service"
    assert course15_funnel_leaf(f) is None
    assert classify_product_origin(f, "main_course") == "without_course15"
    assert _ltv_for_kinds(["other_service", "main_course"]) == Decimal("200")


def test_e_osteopath_protocol_sequence():
    f = _facts(["other_service", "protocol", "protocol"], mk=False)
    assert first_product_kind(f) == "other_service"
    assert classify_product_origin(f, "protocol") == "without_course15"
    assert _ltv_for_kinds(["other_service", "protocol", "protocol"]) == Decimal("300")


def test_f_main_as_first_product():
    f = _facts(["main_course"], mk=False)
    assert first_product_kind(f) == "main_course"
    assert classify_product_origin(f, "main_course") == "as_first_product"


def test_g_protocol_as_first_product():
    f = _facts(["protocol"], mk=False)
    assert first_product_kind(f) == "protocol"
    assert classify_product_origin(f, "protocol") == "as_first_product"


def test_h_late_masterclass_does_not_change_purchase_ltv():
    """Добавление MK event меняет path analytics, не Paid LTV."""
    kinds = ["course_15", "main_course"]
    ltv_before = _ltv_for_kinds(kinds)
    f_before = _facts(kinds, mk=False)
    f_after = _facts(kinds, mk=True)
    assert ltv_before == _ltv_for_kinds(kinds)
    assert course15_funnel_leaf(f_before) == "no_mk_main"
    assert course15_funnel_leaf(f_after) == "mk_main"
    assert conversion_flags(f_before)["course15_to_main_without_mk"] is True
    assert conversion_flags(f_after)["course15_to_main_without_mk"] is False


def test_i_main_without_course15_completion_still_valid():
    f = _facts(["course_15", "main_course"], mk=False, c15_status="active")
    assert f.course_15_status == "active"
    assert classify_product_origin(f, "main_course") == "after_course15_mk_not_recorded"
    assert _ltv_for_kinds(["course_15", "main_course"]) == Decimal("200")


def test_no_fake_masterclass_from_main_purchase():
    f = _facts(["main_course"], mk=False)
    assert master_class_recorded(f) is False
    assert conversion_flags(f)["course15_to_masterclass"] is False
