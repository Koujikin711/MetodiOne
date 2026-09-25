"""Phase 5: cohort LTV analytics (first_purchase_at), backend-only formulas."""

from __future__ import annotations

from collections import defaultdict
from datetime import UTC, datetime, timedelta
from decimal import Decimal

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Lead, PatientJourney, PatientPurchase, PatientPurchasePayment
from app.services.patient_ltv import compute_lead_ltv


LTV_WINDOWS_DAYS = (0, 30, 90, 180, 365)


async def build_ltv_cohort_report(
    db: AsyncSession,
    *,
    company_id: int,
    cohort_from: datetime,
    cohort_to: datetime,
) -> dict:
    """Cohort = пациенты с first_purchase_at ∈ [from, to). Не revenue месяца."""
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

    cohort_leads: list[int] = []
    first_at: dict[int, datetime] = {}
    for lid, pur_list in by_lead.items():
        times = [p.purchased_at for p in pur_list if p.purchased_at is not None]
        if not times:
            continue
        t0 = min(times if times[0].tzinfo else [t.replace(tzinfo=UTC) if t.tzinfo is None else t for t in times])
        # normalize
        norm = []
        for t in times:
            if t.tzinfo is None:
                t = t.replace(tzinfo=UTC)
            else:
                t = t.astimezone(UTC)
            norm.append(t)
        t0 = min(norm)
        if cohort_from <= t0 < cohort_to:
            cohort_leads.append(lid)
            first_at[lid] = t0

    n = len(cohort_leads)
    if n == 0:
        return {
            "cohort_from": cohort_from,
            "cohort_to": cohort_to,
            "patients": 0,
            "avg_paid_ltv": Decimal("0"),
            "avg_sales_value": Decimal("0"),
            "repeat_purchase_rate": Decimal("0"),
            "purchases_per_patient": Decimal("0"),
            "avg_lifetime_days": Decimal("0"),
            "ltv_windows": {f"d{d}": Decimal("0") for d in LTV_WINDOWS_DAYS},
            "journey": {
                "course_15_started": 0,
                "course_15_completed": 0,
                "master_class": 0,
                "branch_main_course": 0,
                "branch_protocols": 0,
            },
            "patients_rows": [],
        }

    paid_sum = Decimal("0")
    sales_sum = Decimal("0")
    lifetime_sum = 0
    lifetime_n = 0
    repeat_n = 0
    purchases_n = 0
    window_sums = {d: Decimal("0") for d in LTV_WINDOWS_DAYS}
    rows_out: list[dict] = []

    for lid in cohort_leads:
        pur_list = by_lead[lid]
        pay_list = []
        for p in pur_list:
            pay_list.extend(pays_by_purchase.get(int(p.id), []))
        snap = compute_lead_ltv(pur_list, pay_list)
        paid_sum += snap.paid_ltv
        sales_sum += snap.sales_value
        purchases_n += snap.purchase_count
        if snap.purchase_count >= 2:
            repeat_n += 1
        if snap.lifetime_days is not None:
            lifetime_sum += snap.lifetime_days
            lifetime_n += 1
        t0 = first_at[lid]
        for d in LTV_WINDOWS_DAYS:
            end = t0 + timedelta(days=d) if d > 0 else t0 + timedelta(seconds=1)
            # D0 = payments on first purchase day roughly: paid_at < t0+1day
            if d == 0:
                end = t0 + timedelta(days=1)
            w_paid = Decimal("0")
            for pay in pay_list:
                pt = pay.paid_at
                if pt is None:
                    continue
                if pt.tzinfo is None:
                    pt = pt.replace(tzinfo=UTC)
                else:
                    pt = pt.astimezone(UTC)
                if t0 <= pt < end:
                    w_paid += Decimal(str(pay.amount or 0))
            window_sums[d] += w_paid
        rows_out.append(
            {
                "lead_id": lid,
                "paid_ltv": snap.paid_ltv,
                "sales_value": snap.sales_value,
                "purchase_count": snap.purchase_count,
                "outstanding": snap.outstanding,
                "first_purchase_at": snap.first_purchase_at,
                "last_purchase_at": snap.last_purchase_at,
                "lifetime_days": snap.lifetime_days,
            },
        )

    journeys = (
        await db.execute(
            select(PatientJourney).where(
                PatientJourney.company_id == company_id,
                PatientJourney.lead_id.in_(cohort_leads),
            ),
        )
    ).scalars().all()
    jmap = {int(j.lead_id): j for j in journeys}

    journey_stats = {
        "course_15_started": sum(1 for lid in cohort_leads if (jmap.get(lid) and jmap[lid].course_15_status in ("active", "completed"))),
        "course_15_completed": sum(1 for lid in cohort_leads if (jmap.get(lid) and jmap[lid].course_15_status == "completed")),
        "master_class": sum(1 for lid in cohort_leads if (jmap.get(lid) and jmap[lid].master_class_at is not None)),
        "branch_main_course": sum(1 for lid in cohort_leads if (jmap.get(lid) and jmap[lid].branch == "main_course")),
        "branch_protocols": sum(1 for lid in cohort_leads if (jmap.get(lid) and jmap[lid].branch == "protocols")),
    }

    # names
    leads = (
        await db.execute(select(Lead.id, Lead.name, Lead.phone).where(Lead.id.in_(cohort_leads)))
    ).all()
    name_map = {int(i): (n, ph) for i, n, ph in leads}
    for r in rows_out:
        n, ph = name_map.get(int(r["lead_id"]), (None, None))
        r["patient_name"] = n
        r["patient_phone"] = ph

    rows_out.sort(key=lambda x: float(x["paid_ltv"]), reverse=True)

    return {
        "cohort_from": cohort_from,
        "cohort_to": cohort_to,
        "patients": n,
        "avg_paid_ltv": (paid_sum / n) if n else Decimal("0"),
        "avg_sales_value": (sales_sum / n) if n else Decimal("0"),
        "repeat_purchase_rate": (Decimal(repeat_n) / Decimal(n)) if n else Decimal("0"),
        "purchases_per_patient": (Decimal(purchases_n) / Decimal(n)) if n else Decimal("0"),
        "avg_lifetime_days": (Decimal(lifetime_sum) / Decimal(lifetime_n)) if lifetime_n else Decimal("0"),
        "ltv_windows": {f"d{d}": (window_sums[d] / n) if n else Decimal("0") for d in LTV_WINDOWS_DAYS},
        "journey": journey_stats,
        "patients_rows": rows_out[:200],
    }
