"""Course 90-day program period (Phase 8E).

Overlays expected program end on existing Course Journal memberships.
Does NOT create CuratorFlowMembership duplicates.
Does NOT treat absence of Booking as end of work.
Paid LTV math unchanged.
"""

from __future__ import annotations

from collections import defaultdict
from datetime import UTC, date, datetime, timedelta
from typing import Literal

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import CuratorFlowMembership, PatientPurchase

COURSE_DURATION_DAYS = 90
COURSE_ENDING_SOON_DAYS_DEFAULT = 14

CourseProgramStatus = Literal["active", "ending_soon", "ended"]
CourseProgramStartSource = Literal["purchase", "membership_joined"]


def _utc(dt: datetime | None) -> datetime | None:
    if dt is None:
        return None
    if dt.tzinfo is None:
        return dt.replace(tzinfo=UTC)
    return dt.astimezone(UTC)


def main_course_purchase_counts(p: PatientPurchase) -> bool:
    if (p.product_kind or "") != "main_course":
        return False
    st = (p.status or "").strip()
    return st not in ("cancelled", "returned")


def resolve_course_program_start(
    *,
    joined_on: date,
    kpi_sale_id: int | None,
    purchases: list[PatientPurchase],
) -> tuple[date, CourseProgramStartSource, int | None]:
    """Canonical start for Course program period.

    Priority:
    1. main_course purchase matching membership.kpi_sale_id (kpi_manual_sale)
    2. main_course purchase closest to joined_on (by calendar day)
    3. membership.joined_on (no inventing from Booking absence)
    """
    mains = [p for p in purchases if main_course_purchase_counts(p)]

    if kpi_sale_id is not None:
        for p in mains:
            if (p.source_type or "") == "kpi_manual_sale" and int(p.source_id) == int(kpi_sale_id):
                at = _utc(p.purchased_at)
                if at is not None:
                    return at.date(), "purchase", int(p.id)

    if mains:

        def _dist(p: PatientPurchase) -> tuple[int, datetime]:
            at = _utc(p.purchased_at) or datetime.min.replace(tzinfo=UTC)
            return abs((at.date() - joined_on).days), at

        best = min(mains, key=_dist)
        at = _utc(best.purchased_at)
        if at is not None:
            return at.date(), "purchase", int(best.id)

    return joined_on, "membership_joined", None


def classify_course_program_period(
    *,
    joined_on: date,
    kpi_sale_id: int | None = None,
    purchases: list[PatientPurchase] | None = None,
    now: date | datetime | None = None,
    ending_soon_days: int = COURSE_ENDING_SOON_DAYS_DEFAULT,
    duration_days: int = COURSE_DURATION_DAYS,
) -> dict:
    """Derive Course program period for one membership."""
    if isinstance(now, datetime):
        today = _utc(now).date() if now else date.today()
    elif isinstance(now, date):
        today = now
    else:
        today = datetime.now(UTC).date()

    soon = max(0, min(int(ending_soon_days), int(duration_days)))
    started_on, source, purchase_id = resolve_course_program_start(
        joined_on=joined_on,
        kpi_sale_id=kpi_sale_id,
        purchases=list(purchases or []),
    )
    expected_end_on = started_on + timedelta(days=int(duration_days))
    days_remaining = (expected_end_on - today).days
    day_index = (today - started_on).days + 1  # 1..duration while active

    if days_remaining < 0:
        status: CourseProgramStatus = "ended"
    elif days_remaining <= soon:
        status = "ending_soon"
    else:
        status = "active"

    return {
        "program_started_on": started_on,
        "program_expected_end_on": expected_end_on,
        "program_days_remaining": days_remaining,
        "program_day_index": day_index,
        "program_duration_days": int(duration_days),
        "program_status": status,
        "program_start_source": source,
        "program_purchase_id": purchase_id,
    }


def membership_period_fields(
    m: CuratorFlowMembership,
    purchases_by_lead: dict[int, list[PatientPurchase]],
    *,
    now: date | datetime | None = None,
    ending_soon_days: int = COURSE_ENDING_SOON_DAYS_DEFAULT,
) -> dict:
    lead_id = int(m.lead_id) if m.lead_id is not None else None
    purchases = purchases_by_lead.get(lead_id, []) if lead_id is not None else []
    return classify_course_program_period(
        joined_on=m.joined_on,
        kpi_sale_id=int(m.kpi_sale_id) if m.kpi_sale_id is not None else None,
        purchases=purchases,
        now=now,
        ending_soon_days=ending_soon_days,
    )


async def load_main_course_purchases_by_lead(
    db: AsyncSession,
    *,
    company_id: int,
    lead_ids: list[int],
) -> dict[int, list[PatientPurchase]]:
    if not lead_ids:
        return {}
    rows = (
        await db.execute(
            select(PatientPurchase).where(
                PatientPurchase.company_id == company_id,
                PatientPurchase.lead_id.in_(lead_ids),
                PatientPurchase.product_kind == "main_course",
            )
        )
    ).scalars().all()
    out: dict[int, list[PatientPurchase]] = defaultdict(list)
    for p in rows:
        if p.lead_id is None:
            continue
        if not main_course_purchase_counts(p):
            continue
        out[int(p.lead_id)].append(p)
    return dict(out)
