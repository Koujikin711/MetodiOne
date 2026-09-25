"""Phase 8F: Course15 Deposit DQ — read-only A/B/C/D (no auto-fix)."""

from __future__ import annotations

from decimal import Decimal

from app.services.deposit_dq import (
    CLASS_A,
    CLASS_B,
    CLASS_C,
    CLASS_D,
    POSSIBLE_DEPOSIT_MAX_DEFAULT,
    classify_course15_deposit,
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


def test_related_higher_only_enriches_b_reasons():
    klass, reasons = classify_course15_deposit(
        service_amount=Decimal("300"),
        paid_amount=Decimal("300"),
        related_higher_service=True,
    )
    assert klass == CLASS_B
    assert any("higher service_amount" in r for r in reasons)
