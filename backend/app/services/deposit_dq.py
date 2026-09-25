"""Deposit Data Quality for Course 15 (Phase 8F) — read-only classification.

Classes A/B/C/D for owner review before fully-paid LTV Entry cutover (8G).

NO automatic correction.
NO rewrite of service_amount from a catalog price (forbidden hardcode 1300).
The possible-deposit amount band is a DQ *flag* range only (covers 200–300 examples).
"""

from __future__ import annotations

from collections import defaultdict
from datetime import UTC, datetime
from decimal import Decimal
from typing import Literal

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from app.models import Lead, SalesKpiManualSale, User
from app.models.patient_purchase import PatientPurchase, PatientPurchasePayment
from app.services.product_lexicon import product_display_label

DepositClass = Literal[
    "clear_partial",  # A
    "technically_full_possible_deposit",  # B
    "clear_full",  # C
    "unknown",  # D
]

CLASS_A = "clear_partial"
CLASS_B = "technically_full_possible_deposit"
CLASS_C = "clear_full"
CLASS_D = "unknown"

CLASS_LABELS = {
    CLASS_A: "A · Clear partial",
    CLASS_B: "B · Technically full, possible deposit",
    CLASS_C: "C · Clear full",
    CLASS_D: "D · Unknown",
}

# DQ attention band ONLY — not catalog price, not auto-rewrite target.
# Covers audit examples sa=pa=200–300 on Course 15. Configurable via API.
POSSIBLE_DEPOSIT_MAX_DEFAULT = Decimal("500")
EPS = Decimal("0.01")


def _dec(v) -> Decimal:
    return Decimal(str(v or 0))


def _utc(dt: datetime | None) -> datetime | None:
    if dt is None:
        return None
    if dt.tzinfo is None:
        return dt.replace(tzinfo=UTC)
    return dt.astimezone(UTC)


def course15_purchase_in_scope(p: PatientPurchase) -> bool:
    if (p.product_kind or "") != "course_15":
        return False
    st = (p.status or "").strip()
    return st not in ("cancelled", "returned")


def classify_course15_deposit(
    *,
    service_amount,
    paid_amount,
    possible_deposit_max: Decimal = POSSIBLE_DEPOSIT_MAX_DEFAULT,
    related_higher_service: bool = False,
) -> tuple[DepositClass, list[str]]:
    """Pure classifier. Returns (class, evidence reasons)."""
    sa = _dec(service_amount)
    pa = _dec(paid_amount)
    band = _dec(possible_deposit_max)
    reasons: list[str] = []

    if sa <= 0:
        reasons.append("service_amount<=0 — недостаточно evidence contracted amount")
        return CLASS_D, reasons

    if sa > pa + EPS:
        reasons.append(f"service_amount ({sa}) > paid_amount ({pa}) — clear partial/deposit vs recorded contract")
        return CLASS_A, reasons

    # technically full: pa >= sa
    reasons.append(f"paid_amount ({pa}) >= service_amount ({sa}) — money predicate passes")

    in_band = sa <= band + EPS
    if in_band:
        reasons.append(
            f"service_amount ({sa}) within possible-deposit DQ band (≤{band}) — "
            "attention only, NOT catalog rewrite"
        )
        if related_higher_service:
            reasons.append("same Lead has other Course15 with higher service_amount")
        return CLASS_B, reasons

    reasons.append(
        f"service_amount ({sa}) above possible-deposit DQ band (>{band}) — "
        "treated as clear full relative to recorded contract"
    )
    if related_higher_service:
        reasons.append("same Lead has other Course15 with higher service_amount (info)")
    return CLASS_C, reasons


def _related_higher(sa: Decimal, siblings: list[PatientPurchase], self_id: int) -> bool:
    for o in siblings:
        if int(o.id) == self_id:
            continue
        if not course15_purchase_in_scope(o):
            continue
        if _dec(o.service_amount) > sa + EPS:
            return True
    return False


async def build_deposit_dq_report(
    db: AsyncSession,
    *,
    company_id: int,
    possible_deposit_max: Decimal | float | int | str = POSSIBLE_DEPOSIT_MAX_DEFAULT,
    class_filter: str | None = None,
    q: str | None = None,
    limit: int = 500,
) -> dict:
    """Read-only Course15 deposit DQ. No writes, no auto-fix."""
    band = _dec(possible_deposit_max)
    purchases = list(
        (
            await db.execute(
                select(PatientPurchase)
                .where(
                    PatientPurchase.company_id == company_id,
                    PatientPurchase.product_kind == "course_15",
                )
                .order_by(PatientPurchase.purchased_at.desc())
            )
        ).scalars().all()
    )
    scoped = [p for p in purchases if course15_purchase_in_scope(p)]

    by_lead: dict[int, list[PatientPurchase]] = defaultdict(list)
    for p in scoped:
        if p.lead_id is not None:
            by_lead[int(p.lead_id)].append(p)

    purchase_ids = [int(p.id) for p in scoped]
    payments_by_purchase: dict[int, list[PatientPurchasePayment]] = defaultdict(list)
    if purchase_ids:
        pays = (
            await db.execute(
                select(PatientPurchasePayment).where(
                    PatientPurchasePayment.company_id == company_id,
                    PatientPurchasePayment.purchase_id.in_(purchase_ids),
                )
            )
        ).scalars().all()
        for pay in pays:
            payments_by_purchase[int(pay.purchase_id)].append(pay)

    lead_ids = {int(p.lead_id) for p in scoped if p.lead_id is not None}
    leads: dict[int, Lead] = {}
    if lead_ids:
        for lead in (
            await db.execute(select(Lead).where(Lead.id.in_(lead_ids)))
        ).scalars().all():
            leads[int(lead.id)] = lead

    kpi_ids = [
        int(p.source_id)
        for p in scoped
        if (p.source_type or "") == "kpi_manual_sale"
    ]
    kpi_by_id: dict[int, SalesKpiManualSale] = {}
    manager_ids: set[int] = set()
    if kpi_ids:
        for sale in (
            await db.execute(
                select(SalesKpiManualSale).where(
                    SalesKpiManualSale.company_id == company_id,
                    SalesKpiManualSale.id.in_(kpi_ids),
                )
            )
        ).scalars().all():
            kpi_by_id[int(sale.id)] = sale
            if getattr(sale, "manager_user_id", None):
                manager_ids.add(int(sale.manager_user_id))

    managers: dict[int, str] = {}
    if manager_ids:
        for u in (
            await db.execute(select(User).where(User.id.in_(manager_ids)))
        ).scalars().all():
            managers[int(u.id)] = u.full_name or u.email or f"#{u.id}"

    counts = {CLASS_A: 0, CLASS_B: 0, CLASS_C: 0, CLASS_D: 0}
    rows: list[dict] = []
    qn = (q or "").strip().casefold()

    for p in scoped:
        sa = _dec(p.service_amount)
        siblings = by_lead.get(int(p.lead_id), []) if p.lead_id is not None else []
        higher = _related_higher(sa, siblings, int(p.id))
        klass, reasons = classify_course15_deposit(
            service_amount=sa,
            paid_amount=p.paid_amount,
            possible_deposit_max=band,
            related_higher_service=higher,
        )
        counts[klass] += 1

        if class_filter:
            shortcuts = {
                "A": CLASS_A,
                "B": CLASS_B,
                "C": CLASS_C,
                "D": CLASS_D,
                CLASS_A: CLASS_A,
                CLASS_B: CLASS_B,
                CLASS_C: CLASS_C,
                CLASS_D: CLASS_D,
            }
            want = shortcuts.get(class_filter.strip()) or shortcuts.get(class_filter.strip().upper())
            if want and want != klass:
                continue
            if not want:
                continue

        lead = leads.get(int(p.lead_id)) if p.lead_id is not None else None
        patient_name = (
            (lead.name if lead else None)
            or p.client_name
            or "—"
        )
        patient_phone = (lead.phone if lead else None) or p.client_phone

        if qn:
            blob = f"{patient_name} {patient_phone or ''} {p.product_name or ''}".casefold()
            if qn not in blob and (p.lead_id is None or qn not in str(p.lead_id)):
                continue

        kpi = (
            kpi_by_id.get(int(p.source_id))
            if (p.source_type or "") == "kpi_manual_sale"
            else None
        )
        manager_name = None
        if kpi is not None and getattr(kpi, "manager_user_id", None):
            manager_name = managers.get(int(kpi.manager_user_id))

        pays = payments_by_purchase.get(int(p.id), [])
        pay_rows = [
            {
                "id": int(pay.id),
                "source_type": pay.source_type,
                "source_id": int(pay.source_id),
                "amount": str(_dec(pay.amount)),
                "is_refund": bool(getattr(pay, "is_refund", False) or _dec(pay.amount) < 0),
                "paid_at": _utc(getattr(pay, "paid_at", None)),
            }
            for pay in sorted(pays, key=lambda x: _utc(getattr(x, "paid_at", None)) or datetime.min.replace(tzinfo=UTC))
        ]

        related = [
            {
                "purchase_id": int(o.id),
                "service_amount": str(_dec(o.service_amount)),
                "paid_amount": str(_dec(o.paid_amount)),
                "purchased_at": _utc(o.purchased_at),
                "status": o.status,
            }
            for o in siblings
            if int(o.id) != int(p.id)
        ]

        rows.append(
            {
                "deposit_class": klass,
                "deposit_class_label": CLASS_LABELS[klass],
                "purchase_id": int(p.id),
                "lead_id": int(p.lead_id) if p.lead_id is not None else None,
                "patient_name": patient_name,
                "patient_phone": patient_phone,
                "product_kind": "course_15",
                "product_name": p.product_name,
                "product_label": product_display_label("course_15", p.product_name),
                "source_type": p.source_type,
                "source_id": int(p.source_id),
                "booking_id": int(p.source_id) if (p.source_type or "") == "booking_appointment" else None,
                "kpi_sale_id": int(p.source_id) if (p.source_type or "") == "kpi_manual_sale" else None,
                "service_amount": str(sa),
                "paid_amount": str(_dec(p.paid_amount)),
                "status": p.status,
                "purchased_at": _utc(p.purchased_at),
                "manager_name": manager_name,
                "payments": pay_rows,
                "payments_count": len(pay_rows),
                "related_course15": related,
                "related_higher_service": higher,
                "evidence_reasons": reasons,
                "target_entry_would_pass": sa > 0 and _dec(p.paid_amount) + EPS >= sa,
            }
        )

    # counts are full-population; rows may be filtered
    if class_filter or qn:
        # recompute display note; keep full counts
        pass

    rows = rows[: max(1, min(int(limit), 2000))]

    return {
        "predicate": "course_15_purchase_not_cancelled_returned",
        "read_only": True,
        "auto_fix": False,
        "hardcode_catalog_price": False,
        "possible_deposit_max": str(band),
        "note": (
            "Read-only Deposit DQ for Course 15 before fully-paid Entry cutover. "
            "Class B uses an attention band (not a catalog rewrite to 1300). "
            "No automatic correction."
        ),
        "counts": counts,
        "total_in_scope": sum(counts.values()),
        "rows_returned": len(rows),
        "class_labels": CLASS_LABELS,
        "rows": rows,
    }
