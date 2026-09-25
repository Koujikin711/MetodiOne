"""Phase 8A: CURRENT vs TARGET LTV Entry cohort comparison (no production cutover)."""

from __future__ import annotations

from collections import defaultdict
from datetime import UTC, datetime, timedelta
from decimal import Decimal

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import PatientPurchase, PatientPurchasePayment
from app.services.ltv_entry_eligibility import (
    ENTRY_MODE_FULLY_PAID,
    ENTRY_MODE_PURCHASE,
    EntryMode,
    PRODUCTION_ENTRY_MODE,
    entry_purchase_count,
    first_entry_at,
    first_entry_purchase,
    last_entry_purchase,
)
from app.services.patient_ltv import compute_lead_ltv
from app.services.patient_ltv_analytics import LTV_WINDOWS_DAYS, purchase_event_identity


def _utc(dt: datetime) -> datetime:
    if dt.tzinfo is None:
        return dt.replace(tzinfo=UTC)
    return dt.astimezone(UTC)


def _empty_mode_snapshot(mode: EntryMode) -> dict:
    return {
        "entry_mode": mode,
        "patients": 0,
        "avg_paid_ltv": Decimal("0"),
        "avg_sales_value": Decimal("0"),
        "repeat_purchase_rate": Decimal("0"),
        "purchases_per_patient": Decimal("0"),
        "avg_lifetime_days": Decimal("0"),
        "ltv_windows": {f"d{d}": Decimal("0") for d in LTV_WINDOWS_DAYS},
        "first_product_top": [],
    }


def _cohort_snapshot_for_mode(
    *,
    mode: EntryMode,
    by_lead: dict[int, list[PatientPurchase]],
    pays_by_purchase: dict[int, list[PatientPurchasePayment]],
    cohort_from: datetime,
    cohort_to: datetime,
) -> dict:
    cohort_leads: list[int] = []
    first_at: dict[int, datetime] = {}
    for lid, pur_list in by_lead.items():
        t0 = first_entry_at(pur_list, mode)
        if t0 is None:
            continue
        if cohort_from <= t0 < cohort_to:
            cohort_leads.append(lid)
            first_at[lid] = t0

    n = len(cohort_leads)
    if n == 0:
        return _empty_mode_snapshot(mode)

    paid_sum = Decimal("0")
    sales_sum = Decimal("0")
    lifetime_sum = 0
    lifetime_n = 0
    repeat_n = 0
    purchases_n = 0
    window_sums = {d: Decimal("0") for d in LTV_WINDOWS_DAYS}
    first_product_counts: dict[str, int] = defaultdict(int)

    for lid in cohort_leads:
        pur_list = by_lead[lid]
        pay_list: list[PatientPurchasePayment] = []
        for p in pur_list:
            pay_list.extend(pays_by_purchase.get(int(p.id), []))
        snap = compute_lead_ltv(pur_list, pay_list)
        # Paid LTV / Sales Value — same financial formulas; only Entry/cohort differs.
        paid_sum += snap.paid_ltv
        sales_sum += snap.sales_value

        pc = entry_purchase_count(pur_list, mode)
        purchases_n += pc
        if pc >= 2:
            repeat_n += 1

        first_p = first_entry_purchase(pur_list, mode)
        last_p = last_entry_purchase(pur_list, mode)
        if first_p and last_p and first_p.purchased_at and last_p.purchased_at:
            fa = _utc(first_p.purchased_at)
            la = _utc(last_p.purchased_at)
            lifetime_sum += max(0, (la.date() - fa.date()).days)
            lifetime_n += 1

        if first_p is not None:
            _key, name = purchase_event_identity(first_p.product_kind, first_p.product_name)
            first_product_counts[name] += 1

        t0 = first_at[lid]
        for d in LTV_WINDOWS_DAYS:
            end = t0 + timedelta(days=d) if d > 0 else t0 + timedelta(days=1)
            if d == 0:
                end = t0 + timedelta(days=1)
            w_paid = Decimal("0")
            for pay in pay_list:
                pt = pay.paid_at
                if pt is None:
                    continue
                pt = _utc(pt)
                if t0 <= pt < end:
                    w_paid += Decimal(str(pay.amount or 0))
            window_sums[d] += w_paid

    top_first = sorted(first_product_counts.items(), key=lambda x: (-x[1], x[0]))[:8]

    return {
        "entry_mode": mode,
        "patients": n,
        "avg_paid_ltv": (paid_sum / n) if n else Decimal("0"),
        "avg_sales_value": (sales_sum / n) if n else Decimal("0"),
        "repeat_purchase_rate": (Decimal(repeat_n) / Decimal(n)) if n else Decimal("0"),
        "purchases_per_patient": (Decimal(purchases_n) / Decimal(n)) if n else Decimal("0"),
        "avg_lifetime_days": (Decimal(lifetime_sum) / Decimal(lifetime_n)) if lifetime_n else Decimal("0"),
        "ltv_windows": {f"d{d}": (window_sums[d] / n) if n else Decimal("0") for d in LTV_WINDOWS_DAYS},
        "first_product_top": [{"product": name, "patients": cnt} for name, cnt in top_first],
    }


async def build_ltv_entry_compare_report(
    db: AsyncSession,
    *,
    company_id: int,
    cohort_from: datetime,
    cohort_to: datetime,
) -> dict:
    """Side-by-side CURRENT (purchase) vs TARGET (fully_paid). Does not cut over production."""
    purchases = (
        await db.execute(
            select(PatientPurchase).where(
                PatientPurchase.company_id == company_id,
                PatientPurchase.lead_id.is_not(None),
                PatientPurchase.status.notin_(("cancelled",)),
            ),
        )
    ).scalars().all()
    by_lead: dict[int, list[PatientPurchase]] = defaultdict(list)
    for p in purchases:
        by_lead[int(p.lead_id)].append(p)

    payments_all = (
        await db.execute(
            select(PatientPurchasePayment).where(PatientPurchasePayment.company_id == company_id),
        )
    ).scalars().all()
    pays_by_purchase: dict[int, list[PatientPurchasePayment]] = defaultdict(list)
    for pay in payments_all:
        pays_by_purchase[int(pay.purchase_id)].append(pay)

    current = _cohort_snapshot_for_mode(
        mode=ENTRY_MODE_PURCHASE,
        by_lead=by_lead,
        pays_by_purchase=pays_by_purchase,
        cohort_from=cohort_from,
        cohort_to=cohort_to,
    )
    target = _cohort_snapshot_for_mode(
        mode=ENTRY_MODE_FULLY_PAID,
        by_lead=by_lead,
        pays_by_purchase=pays_by_purchase,
        cohort_from=cohort_from,
        cohort_to=cohort_to,
    )

    changed = 0
    only_current = 0
    only_target = 0
    for lid, pur_list in by_lead.items():
        a = first_entry_at(pur_list, ENTRY_MODE_PURCHASE)
        b = first_entry_at(pur_list, ENTRY_MODE_FULLY_PAID)
        if a is None and b is None:
            continue
        if a is None and b is not None:
            only_target += 1
            changed += 1
            continue
        if a is not None and b is None:
            only_current += 1
            changed += 1
            continue
        assert a is not None and b is not None
        if a != b:
            changed += 1

    return {
        "cohort_from": cohort_from,
        "cohort_to": cohort_to,
        "production_entry_mode": PRODUCTION_ENTRY_MODE,
        "cutover_blocked_reason": (
            "Phase 8G cutover blocked until Phase 8F Deposit DQ is reviewed. "
            "paid>=service alone is insufficient while Course15 sa=pa=200–300 may be deposits. "
            "No hardcode of catalog prices."
        ),
        "note": (
            "CURRENT = production cohort (purchase-based Entry). "
            "TARGET = fully-paid Entry projection. "
            "Paid LTV formula identical (payments − refunds). "
            "This endpoint does not change /ltv/cohort."
        ),
        "current": current,
        "target": target,
        "diff": {
            "patients_delta": int(target["patients"]) - int(current["patients"]),
            "first_at_changed_patients": changed,
            "entry_only_under_current": only_current,
            "entry_only_under_target": only_target,
        },
    }
