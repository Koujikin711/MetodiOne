"""Сборка Patient Journey из purchases + явных events (Phase 2–4)."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from decimal import Decimal

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import PatientJourney, PatientJourneyEpisode, PatientJourneyEvent, PatientPurchase


def _utc(dt: datetime | None) -> datetime | None:
    if dt is None:
        return None
    if dt.tzinfo is None:
        return dt.replace(tzinfo=UTC)
    return dt.astimezone(UTC)


def purchase_is_fulfilled(p: PatientPurchase) -> bool:
    st = (p.status or "").strip()
    if st in ("returned", "cancelled"):
        return False
    if st == "completed":
        return True
    sa = Decimal(str(p.service_amount or 0))
    pa = Decimal(str(p.paid_amount or 0))
    if sa <= 0:
        return st == "completed"
    return pa + Decimal("0.01") >= sa


def month_bucket_for_episode(started_at: datetime, at: datetime | None = None) -> int:
    """Month 1/2/3 относительно старта episode (календарные 30 дней)."""
    start = _utc(started_at)
    now = _utc(at) or datetime.now(UTC)
    assert start is not None
    days = max(0, (now.date() - start.date()).days)
    return min(3, days // 30 + 1)


async def ensure_journey(db: AsyncSession, *, company_id: int, lead_id: int) -> PatientJourney:
    row = (
        await db.execute(
            select(PatientJourney).where(
                PatientJourney.company_id == company_id,
                PatientJourney.lead_id == lead_id,
            ),
        )
    ).scalar_one_or_none()
    if row:
        return row
    row = PatientJourney(company_id=company_id, lead_id=lead_id)
    db.add(row)
    await db.flush()
    return row


async def sync_journey_for_lead(db: AsyncSession, *, company_id: int, lead_id: int) -> PatientJourney:
    """Пересчитать путь Lead из реальных purchases + events.

    Masterclass / Course15 — enrichment, НЕ prerequisite и НЕ фильтр LTV.
    Branch = маркер первой main/protocol покупки (аналитика); оба продукта остаются в ledger.
    Не создаём fake master_class / completion из последующих продаж.
    """
    j = await ensure_journey(db, company_id=company_id, lead_id=lead_id)
    purchases = (
        await db.execute(
            select(PatientPurchase).where(
                PatientPurchase.company_id == company_id,
                PatientPurchase.lead_id == lead_id,
            ).order_by(PatientPurchase.purchased_at.asc()),
        )
    ).scalars().all()

    c15 = [p for p in purchases if p.product_kind == "course_15" and (p.status or "") != "cancelled"]
    if not c15:
        j.course_15_status = "none"
        j.course_15_started_at = None
        j.course_15_completed_at = None
    else:
        j.course_15_started_at = _utc(c15[0].purchased_at)
        if any(purchase_is_fulfilled(p) or (p.status or "") == "completed" for p in c15):
            j.course_15_status = "completed"
            done = [p for p in c15 if purchase_is_fulfilled(p) or (p.status or "") == "completed"]
            j.course_15_completed_at = _utc(done[-1].purchased_at) if done else _utc(c15[-1].purchased_at)
        else:
            j.course_15_status = "active"
            j.course_15_completed_at = None

    mk = (
        await db.execute(
            select(PatientJourneyEvent)
            .where(
                PatientJourneyEvent.company_id == company_id,
                PatientJourneyEvent.lead_id == lead_id,
                PatientJourneyEvent.event_type == "master_class",
            )
            .order_by(PatientJourneyEvent.occurred_at.asc())
            .limit(1),
        )
    ).scalar_one_or_none()
    j.master_class_at = _utc(mk.occurred_at) if mk else None

    main_ps = [p for p in purchases if p.product_kind == "main_course" and (p.status or "") not in ("cancelled", "returned")]
    proto_ps = [p for p in purchases if p.product_kind == "protocol" and (p.status or "") not in ("cancelled", "returned")]

    # Маркер первой program-ветки по timestamp (не запрет второй покупки, не требует МК).
    if j.branch == "none":
        if main_ps and not proto_ps:
            j.branch = "main_course"
            j.branch_started_at = _utc(main_ps[0].purchased_at)
        elif proto_ps and not main_ps:
            j.branch = "protocols"
            j.branch_started_at = _utc(proto_ps[0].purchased_at)
        elif main_ps and proto_ps:
            first_main = _utc(main_ps[0].purchased_at)
            first_proto = _utc(proto_ps[0].purchased_at)
            if first_main and first_proto:
                if first_main < first_proto:
                    j.branch = "main_course"
                    j.branch_started_at = first_main
                elif first_proto < first_main:
                    j.branch = "protocols"
                    j.branch_started_at = first_proto
                # equal timestamps — leave none (true ambiguity)
    elif j.branch == "main_course" and not j.branch_started_at and main_ps:
        j.branch_started_at = _utc(main_ps[0].purchased_at)
    elif j.branch == "protocols" and not j.branch_started_at and proto_ps:
        j.branch_started_at = _utc(proto_ps[0].purchased_at)

    await _sync_episodes(db, company_id=company_id, lead_id=lead_id, kind="main_course", purchases=main_ps)
    await _sync_episodes(db, company_id=company_id, lead_id=lead_id, kind="protocol", purchases=proto_ps)

    j.updated_at = datetime.now(UTC)
    await db.flush()
    return j


async def _sync_episodes(
    db: AsyncSession,
    *,
    company_id: int,
    lead_id: int,
    kind: str,
    purchases: list[PatientPurchase],
) -> None:
    """Эпизоды #1…N по порядку покупок (без hardcode max 12)."""
    existing = (
        await db.execute(
            select(PatientJourneyEpisode).where(
                PatientJourneyEpisode.company_id == company_id,
                PatientJourneyEpisode.lead_id == lead_id,
                PatientJourneyEpisode.kind == kind,
            ),
        )
    ).scalars().all()
    by_purchase = {int(e.purchase_id): e for e in existing if e.purchase_id is not None}
    for idx, p in enumerate(purchases, start=1):
        pid = int(p.id)
        if pid in by_purchase:
            e = by_purchase[pid]
            e.sequence_no = idx
            e.status = "completed" if purchase_is_fulfilled(p) else ("cancelled" if p.status == "cancelled" else "active")
            e.started_at = _utc(p.purchased_at) or e.started_at
            continue
        db.add(
            PatientJourneyEpisode(
                company_id=company_id,
                lead_id=lead_id,
                kind=kind,
                sequence_no=idx,
                status="completed" if purchase_is_fulfilled(p) else "active",
                started_at=_utc(p.purchased_at) or datetime.now(UTC),
                purchase_id=pid,
                curator_flow_id=None,
            ),
        )
    await db.flush()


async def record_master_class(
    db: AsyncSession,
    *,
    company_id: int,
    lead_id: int,
    occurred_at: datetime | None = None,
) -> PatientJourneyEvent:
    ev = PatientJourneyEvent(
        company_id=company_id,
        lead_id=lead_id,
        event_type="master_class",
        occurred_at=_utc(occurred_at) or datetime.now(UTC),
    )
    db.add(ev)
    await db.flush()
    await sync_journey_for_lead(db, company_id=company_id, lead_id=lead_id)
    return ev
