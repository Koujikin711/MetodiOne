"""LTV Entry eligibility — dual modes (Phase 8A).

CURRENT (production): first valid Purchase Event by purchased_at.
TARGET (design only until 8G): first fully-paid purchase vs service_amount.

Paid LTV math is NOT defined here and MUST NOT change.
Deposit DQ (sa==pa==200–300 on Course15) is Phase 8F — not auto-fixed here.
"""

from __future__ import annotations

from datetime import UTC, datetime
from decimal import Decimal
from typing import Literal

from app.models.patient_purchase import PatientPurchase

EntryMode = Literal["purchase", "fully_paid"]

ENTRY_MODE_PURCHASE: EntryMode = "purchase"
ENTRY_MODE_FULLY_PAID: EntryMode = "fully_paid"

PRODUCTION_ENTRY_MODE: EntryMode = ENTRY_MODE_PURCHASE


def _utc(dt: datetime | None) -> datetime | None:
    if dt is None:
        return None
    if dt.tzinfo is None:
        return dt.replace(tzinfo=UTC)
    return dt.astimezone(UTC)


def _eligible_base(p: PatientPurchase) -> bool:
    """Shared: not cancelled; has purchased_at. Returned kept for CURRENT parity with cohort."""
    st = (p.status or "").strip()
    if st == "cancelled":
        return False
    return p.purchased_at is not None


def purchase_is_fully_paid_for_entry(p: PatientPurchase) -> bool:
    """TARGET Entry predicate relative to actual contracted ``service_amount``.

    - No catalog price hardcode.
    - ``service_amount <= 0`` → not Entry (placeholders / zero booking rows).
    - ``status=completed`` alone is insufficient when amount is zero.
    - Caveat: deposit recorded as sa=pa=300 still passes → Phase 8F class B.
    """
    st = (p.status or "").strip()
    if st in ("returned", "cancelled"):
        return False
    sa = Decimal(str(p.service_amount or 0))
    pa = Decimal(str(p.paid_amount or 0))
    if sa <= 0:
        return False
    return pa + Decimal("0.01") >= sa


def purchase_counts_for_entry(p: PatientPurchase, mode: EntryMode) -> bool:
    if mode == ENTRY_MODE_PURCHASE:
        # Match production cohort: cancelled excluded; returned may still anchor first_at.
        return _eligible_base(p)
    if mode == ENTRY_MODE_FULLY_PAID:
        return purchase_is_fully_paid_for_entry(p) and p.purchased_at is not None
    raise ValueError(f"unknown entry mode: {mode}")


def entry_purchases(purchases: list[PatientPurchase], mode: EntryMode) -> list[PatientPurchase]:
    seq = [p for p in purchases if purchase_counts_for_entry(p, mode)]
    seq.sort(
        key=lambda p: _utc(p.purchased_at) or datetime.max.replace(tzinfo=UTC),
    )
    return seq


def first_entry_purchase(purchases: list[PatientPurchase], mode: EntryMode) -> PatientPurchase | None:
    seq = entry_purchases(purchases, mode)
    return seq[0] if seq else None


def first_entry_at(purchases: list[PatientPurchase], mode: EntryMode) -> datetime | None:
    p = first_entry_purchase(purchases, mode)
    return _utc(p.purchased_at) if p else None


def last_entry_purchase(purchases: list[PatientPurchase], mode: EntryMode) -> PatientPurchase | None:
    seq = entry_purchases(purchases, mode)
    return seq[-1] if seq else None


def entry_purchase_count(purchases: list[PatientPurchase], mode: EntryMode) -> int:
    """Count of entry-eligible purchases (TARGET excludes returned; CURRENT excludes cancelled only)."""
    if mode == ENTRY_MODE_PURCHASE:
        return len(
            [
                p
                for p in purchases
                if (p.status or "").strip() not in ("cancelled", "returned") and p.purchased_at is not None
            ],
        )
    return len(entry_purchases(purchases, mode))
