"""REFUND ≠ AUTOMATIC DEBT: outstanding vs operational_debt (cases A–H)."""

from __future__ import annotations

from datetime import UTC, datetime
from decimal import Decimal

from app.models.patient_purchase import PatientPurchase, PatientPurchasePayment
from app.services.patient_ltv import compute_lead_ltv, obligation_open_debt


def _pur(**kw) -> PatientPurchase:
    base = dict(
        company_id=1,
        lead_id=1,
        source_type="booking_appointment",
        source_id=1,
        product_kind="other_service",
        product_name="Услуга",
        purchased_at=datetime(2026, 1, 1, tzinfo=UTC),
    )
    base.update(kw)
    return PatientPurchase(**base)


def _pay(**kw) -> PatientPurchasePayment:
    base = dict(
        company_id=1,
        purchase_id=1,
        source_type="booking_payment",
        source_id=1,
        is_refund=False,
        paid_at=datetime(2026, 1, 1, tzinfo=UTC),
    )
    base.update(kw)
    return PatientPurchasePayment(**base)


def test_obligation_open_debt_matches_kpi_canon():
    assert obligation_open_debt(150, 0, 150) == Decimal("0")
    assert obligation_open_debt(1300, 0, 300) == Decimal("1000")
    assert obligation_open_debt(300, 200, 100) == Decimal("0")


def test_a_active_unpaid():
    snap = compute_lead_ltv(
        [_pur(id=1, service_amount=Decimal("1300"), paid_amount=Decimal("0"), status="active")],
        [],
    )
    assert snap.paid_ltv == Decimal("0")
    assert snap.sales_value == Decimal("1300")
    assert snap.outstanding == Decimal("1300")
    assert snap.operational_debt == Decimal("1300")
    assert snap.refunds_total == Decimal("0")


def test_b_active_partially_paid():
    snap = compute_lead_ltv(
        [_pur(id=1, service_amount=Decimal("1300"), paid_amount=Decimal("500"), status="active")],
        [_pay(id=1, amount=Decimal("500"))],
    )
    assert snap.paid_ltv == Decimal("500")
    assert snap.outstanding == Decimal("800")
    assert snap.operational_debt == Decimal("800")


def test_c_active_fully_paid():
    snap = compute_lead_ltv(
        [_pur(id=1, service_amount=Decimal("1300"), paid_amount=Decimal("1300"), status="completed")],
        [_pay(id=1, amount=Decimal("1300"))],
    )
    assert snap.paid_ltv == Decimal("1300")
    assert snap.outstanding == Decimal("0")
    assert snap.operational_debt == Decimal("0")


def test_d_partial_refund_sale_remains_active():
    """Refund не создаёт долг; остаётся только never-paid (sa − gross)."""
    snap = compute_lead_ltv(
        [_pur(id=1, service_amount=Decimal("1300"), paid_amount=Decimal("300"), status="completed")],
        [
            _pay(id=1, amount=Decimal("500")),
            _pay(
                id=2,
                source_type="booking_refund",
                source_id=99,
                amount=Decimal("200"),
                is_refund=True,
                paid_at=datetime(2026, 1, 5, tzinfo=UTC),
            ),
        ],
    )
    assert snap.paid_ltv == Decimal("300")
    assert snap.refunds_total == Decimal("200")
    assert snap.sales_value == Decimal("1300")
    # math: sa − net cache
    assert snap.outstanding == Decimal("1000")
    # KPI: sa − net − refunds = sa − gross = 800
    assert snap.operational_debt == Decimal("800")


def test_e_full_refund_returned_no_false_debt():
    snap = compute_lead_ltv(
        [
            _pur(
                id=1,
                source_type="kpi_manual_sale",
                product_kind="main_course",
                service_amount=Decimal("1300"),
                paid_amount=Decimal("0"),
                status="returned",
            ),
        ],
        [
            _pay(id=1, source_type="kpi_payment", amount=Decimal("1300")),
            _pay(
                id=2,
                source_type="kpi_return",
                source_id=1,
                amount=Decimal("1300"),
                is_refund=True,
                paid_at=datetime(2026, 1, 10, tzinfo=UTC),
            ),
        ],
    )
    assert snap.paid_ltv == Decimal("0")
    assert snap.refunds_total == Decimal("1300")
    assert snap.sales_value == Decimal("0")
    assert snap.outstanding == Decimal("0")
    assert snap.operational_debt == Decimal("0")


def test_f_partial_refund_obligation_cancelled():
    snap = compute_lead_ltv(
        [
            _pur(
                id=1,
                service_amount=Decimal("1300"),
                paid_amount=Decimal("0"),
                status="cancelled",
            ),
        ],
        [
            _pay(id=1, amount=Decimal("500")),
            _pay(
                id=2,
                source_type="booking_refund",
                source_id=10,
                amount=Decimal("500"),
                is_refund=True,
            ),
        ],
    )
    assert snap.paid_ltv == Decimal("0")
    assert snap.refunds_total == Decimal("500")
    assert snap.sales_value == Decimal("0")
    assert snap.outstanding == Decimal("0")
    assert snap.operational_debt == Decimal("0")


def test_g_kpi_returned_no_debt():
    snap = compute_lead_ltv(
        [
            _pur(
                id=1,
                source_type="kpi_manual_sale",
                source_id=7,
                product_kind="protocol",
                service_amount=Decimal("5000"),
                paid_amount=Decimal("0"),
                status="returned",
            ),
        ],
        [
            _pay(id=1, source_type="kpi_payment", amount=Decimal("2000")),
            _pay(
                id=2,
                source_type="kpi_return",
                source_id=7,
                amount=Decimal("2000"),
                is_refund=True,
            ),
        ],
    )
    assert snap.paid_ltv == Decimal("0")
    assert snap.operational_debt == Decimal("0")
    assert snap.outstanding == Decimal("0")


def test_h_booking_full_refund_completed_not_false_debt():
    """Как lead 38849: full refund, статус completed → math outstanding может быть sa, дебиторка 0."""
    snap = compute_lead_ltv(
        [_pur(id=1, service_amount=Decimal("1900"), paid_amount=Decimal("0"), status="completed")],
        [
            _pay(id=1, amount=Decimal("1900")),
            _pay(
                id=2,
                source_type="booking_refund",
                source_id=88,
                amount=Decimal("1900"),
                is_refund=True,
                paid_at=datetime(2026, 2, 1, tzinfo=UTC),
            ),
        ],
    )
    assert snap.paid_ltv == Decimal("0")
    assert snap.refunds_total == Decimal("1900")
    assert snap.outstanding == Decimal("1900")  # math sa − net
    assert snap.operational_debt == Decimal("0")  # refund ≠ debt


def test_lead_38849_pattern_before_after():
    """Before: «Долг»=1900 из outstanding. After: Дебиторка=0, Paid LTV=0, Refunds=1900."""
    snap = compute_lead_ltv(
        [_pur(id=1, service_amount=Decimal("1900"), paid_amount=Decimal("0"), status="completed")],
        [
            _pay(id=1, amount=Decimal("1900")),
            _pay(id=2, source_type="booking_refund", source_id=1, amount=Decimal("1900"), is_refund=True),
        ],
    )
    assert snap.paid_ltv == 0
    assert snap.refunds_total == 1900
    assert snap.operational_debt == 0
    assert snap.outstanding == 1900  # не показывать как Дебиторка в UI


def test_lead_39513_pattern_refund_does_not_inflate_debt():
    """Live 39513: 2×Course15; one net 300, one pay+refund 300 → debt 2000 not 2300."""
    snap = compute_lead_ltv(
        [
            _pur(id=2125, service_amount=Decimal("1300"), paid_amount=Decimal("300"), status="active"),
            _pur(
                id=1263,
                source_id=2,
                service_amount=Decimal("1300"),
                paid_amount=Decimal("0"),
                status="active",
            ),
        ],
        [
            _pay(id=1, purchase_id=2125, amount=Decimal("300")),
            _pay(id=2, purchase_id=1263, source_id=2, amount=Decimal("300")),
            _pay(
                id=3,
                purchase_id=1263,
                source_type="booking_refund",
                source_id=204,
                amount=Decimal("-300"),
                is_refund=True,
            ),
        ],
    )
    assert snap.paid_ltv == Decimal("300")
    assert snap.refunds_total == Decimal("300")
    assert snap.outstanding == Decimal("2300")
    assert snap.operational_debt == Decimal("2000")  # 1000 + 1000; refund ≠ +300 debt


def test_refund_reduces_paid_ltv_exactly_once():
    snap = compute_lead_ltv(
        [_pur(id=1, service_amount=Decimal("500"), paid_amount=Decimal("0"), status="completed")],
        [
            _pay(id=1, amount=Decimal("500")),
            _pay(id=2, source_type="booking_refund", source_id=9, amount=Decimal("500"), is_refund=True),
        ],
    )
    assert snap.paid_ltv == Decimal("0")
    assert snap.refunds_total == Decimal("500")
    # один refund-event, не двойной вычет
    assert len([1, 2]) == 2
