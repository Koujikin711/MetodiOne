"""Unresolved Main Course / Protocol KPI sales — DQ suggestions (no auto-link)."""

from __future__ import annotations

from collections import defaultdict
from decimal import Decimal

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import (
    BookingAppointment,
    Lead,
    LeadExtraPhone,
    SalesKpiManualSale,
    SalesKpiPlanItem,
    User,
)
from app.services.patient_ltv import classify_product_kind
from app.services.phone_match import phone_digits, phones_equivalent
from app.services.product_lexicon import product_display_label

PROGRAM_KINDS = frozenset({"main_course", "protocol"})


def _phone_keys(raw: str | None) -> set[str]:
    d = phone_digits(raw)
    if not d:
        return set()
    keys = {d}
    if len(d) >= 9:
        keys.add(d[-9:])
    return keys


async def build_phone_to_leads_index(db: AsyncSession, *, company_id: int) -> dict[str, set[int]]:
    """Phone-digit keys → Lead ids (Lead.phone, extra phones, booking patient_phone)."""
    index: dict[str, set[int]] = defaultdict(set)

    leads = (
        await db.execute(select(Lead.id, Lead.phone).where(Lead.company_id == company_id))
    ).all()
    lead_ids = [int(i) for i, _ in leads]
    for lid, phone in leads:
        for k in _phone_keys(phone):
            index[k].add(int(lid))

    if lead_ids:
        extras = (
            await db.execute(
                select(LeadExtraPhone.lead_id, LeadExtraPhone.phone).where(
                    LeadExtraPhone.company_id == company_id,
                    LeadExtraPhone.lead_id.in_(lead_ids),
                )
            )
        ).all()
        for lid, phone in extras:
            for k in _phone_keys(phone):
                index[k].add(int(lid))

    appts = (
        await db.execute(
            select(BookingAppointment.lead_id, BookingAppointment.patient_phone).where(
                BookingAppointment.company_id == company_id,
                BookingAppointment.lead_id.is_not(None),
            )
        )
    ).all()
    for lid, phone in appts:
        if lid is None:
            continue
        for k in _phone_keys(phone):
            index[k].add(int(lid))

    return index


def suggest_leads_for_phone(
    phone: str | None,
    *,
    phone_index: dict[str, set[int]],
    lead_meta: dict[int, tuple[str, str | None]],
) -> tuple[str, list[dict], list[str]]:
    """Returns confidence, candidates[{id,name,phone}], evidence strings. Never auto-picks for write."""
    keys = _phone_keys(phone)
    if not keys:
        return "none", [], []

    found: set[int] = set()
    for k in keys:
        found |= phone_index.get(k, set())

    # Also scan by phones_equivalent against lead phones (small set of candidates from index)
    if not found and phone:
        # fallback: no index hit
        pass

    candidates: list[dict] = []
    for lid in sorted(found):
        name, lphone = lead_meta.get(lid, (f"#{lid}", None))
        if phone and lphone and not phones_equivalent(phone, lphone):
            # index may have matched via booking phone; keep if any key overlapped
            pass
        candidates.append({"lead_id": lid, "lead_name": name, "lead_phone": lphone})

    evidence: list[str] = []
    if not candidates:
        return "none", [], []
    if len(keys) and any(len(k) >= 9 for k in keys):
        evidence.append("phone_last9_or_full")
    if len(candidates) == 1:
        evidence.append("unique_phone_candidate")
        return "unique", candidates, evidence
    evidence.append("ambiguous_phone_candidates")
    return "ambiguous", candidates, evidence


async def build_program_unresolved_report(db: AsyncSession, *, company_id: int) -> dict:
    """KPI program sales without lead_id + optional phone suggestions."""
    rows = (
        await db.execute(
            select(SalesKpiManualSale, SalesKpiPlanItem.name, User.full_name, User.email)
            .join(SalesKpiPlanItem, SalesKpiPlanItem.id == SalesKpiManualSale.plan_item_id)
            .join(User, User.id == SalesKpiManualSale.manager_user_id, isouter=True)
            .where(
                SalesKpiManualSale.company_id == company_id,
                SalesKpiManualSale.lead_id.is_(None),
                SalesKpiManualSale.status.notin_(("cancelled",)),
            )
            .order_by(SalesKpiManualSale.sold_at.desc())
        )
    ).all()

    phone_index = await build_phone_to_leads_index(db, company_id=company_id)
    leads = (
        await db.execute(select(Lead.id, Lead.name, Lead.phone).where(Lead.company_id == company_id))
    ).all()
    lead_meta = {int(i): (str(n or f"#{i}"), ph) for i, n, ph in leads}

    out_rows: list[dict] = []
    counts = {"main_course": 0, "protocol": 0, "other": 0}

    for sale, item_name, mgr_name, mgr_email in rows:
        kind = classify_product_kind(item_name)
        if kind not in PROGRAM_KINDS:
            continue
        counts[kind] = counts.get(kind, 0) + 1
        conf, cands, evidence = suggest_leads_for_phone(
            sale.client_phone,
            phone_index=phone_index,
            lead_meta=lead_meta,
        )
        suggested = cands[0] if conf == "unique" and cands else None
        out_rows.append(
            {
                "sale_id": int(sale.id),
                "sold_at": sale.sold_at,
                "client_name": sale.client_name,
                "client_phone": sale.client_phone,
                "product_kind": kind,
                "product_name": str(item_name or ""),
                "product_display": product_display_label(kind, item_name),
                "service_amount": Decimal(str(sale.service_amount or 0)),
                "paid_amount": Decimal(str(sale.paid_amount or 0)),
                "status": sale.status,
                "manager_id": int(sale.manager_user_id) if sale.manager_user_id else None,
                "manager_name": str(mgr_name or mgr_email or (f"#{sale.manager_user_id}" if sale.manager_user_id else "—")),
                "suggestion_confidence": conf,
                "suggested_lead": suggested,
                "candidate_leads": cands[:5],
                "match_evidence": evidence,
            }
        )

    # Linked program purchases (for UI cards)
    from app.models import PatientPurchase

    linked = (
        await db.execute(
            select(PatientPurchase.product_kind, PatientPurchase.id).where(
                PatientPurchase.company_id == company_id,
                PatientPurchase.lead_id.is_not(None),
                PatientPurchase.product_kind.in_(list(PROGRAM_KINDS)),
                PatientPurchase.status.notin_(("cancelled", "returned")),
            )
        )
    ).all()
    linked_counts = {"main_course": 0, "protocol": 0}
    for kind, _pid in linked:
        k = (kind or "").strip()
        if k in linked_counts:
            linked_counts[k] += 1

    return {
        "unresolved_main_course": counts.get("main_course", 0),
        "unresolved_protocol": counts.get("protocol", 0),
        "linked_main_course": linked_counts["main_course"],
        "linked_protocol": linked_counts["protocol"],
        "rows": out_rows,
        "note": "Suggested Lead — подсказка по телефону. Привязка только вручную через link-lead. Без auto-merge.",
    }
