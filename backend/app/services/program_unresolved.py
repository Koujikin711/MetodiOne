"""Unresolved Main Course / Protocol KPI sales — DQ suggestions (no auto-link)."""

from __future__ import annotations

import re
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
from app.services.phone_match import phone_digits
from app.services.product_lexicon import product_display_label

PROGRAM_KINDS = frozenset({"main_course", "protocol"})

# suggestion_confidence values (UI). Never means auto-safe link.
CONF_HIGH = "high_confidence"
CONF_REVIEW = "review_required"
CONF_AMBIGUOUS = "ambiguous"
CONF_NONE = "no_candidate"

_NAME_NOISE = re.compile(r"[^\w\sа-яёӣқғҳҷўғҳҷӯқҳҷ\u0400-\u04FF]+", re.IGNORECASE)
_WS = re.compile(r"\s+")


def _phone_keys(raw: str | None) -> set[str]:
    d = phone_digits(raw)
    if not d:
        return set()
    keys = {d}
    if len(d) >= 9:
        keys.add(d[-9:])
    return keys


def _name_tokens(raw: str | None) -> list[str]:
    if not raw:
        return []
    s = raw.casefold().strip()
    # Instagram / emoji nick → weak identity
    if s.startswith("@") or "instagram" in s:
        return []
    s = _NAME_NOISE.sub(" ", s)
    s = _WS.sub(" ", s).strip()
    toks = [t for t in s.split(" ") if len(t) >= 2]
    return toks


def fio_match_level(sale_name: str | None, lead_name: str | None) -> str:
    """exact | partial | mismatch | empty — suggestion only, not merge key."""
    a = _name_tokens(sale_name)
    b = _name_tokens(lead_name)
    if not a or not b:
        return "empty"
    if a == b or " ".join(a) == " ".join(b):
        return "exact"
    sa, sb = set(a), set(b)
    inter = sa & sb
    if not inter:
        return "mismatch"
    # substantial overlap (e.g. surname + given)
    if len(inter) >= 2:
        return "exact"
    if len(inter) == 1 and (len(sa) == 1 or len(sb) == 1):
        return "partial"
    # one shared long token (≥4) among multi-token names
    if any(len(t) >= 4 for t in inter):
        return "partial"
    return "mismatch"


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


def classify_phone_candidates(
    phone: str | None,
    *,
    phone_index: dict[str, set[int]],
    lead_meta: dict[int, tuple[str, str | None]],
) -> tuple[str, list[dict]]:
    """Phone-only candidate list. ≥2 → ambiguous; 0 → none; 1 → single (not yet high)."""
    keys = _phone_keys(phone)
    if not keys:
        return CONF_NONE, []

    found: set[int] = set()
    for k in keys:
        found |= phone_index.get(k, set())

    candidates: list[dict] = []
    for lid in sorted(found):
        name, lphone = lead_meta.get(lid, (f"#{lid}", None))
        candidates.append({"lead_id": lid, "lead_name": name, "lead_phone": lphone})

    if not candidates:
        return CONF_NONE, []
    if len(candidates) > 1:
        return CONF_AMBIGUOUS, candidates
    return "single_phone", candidates


def enrich_single_candidate(
    *,
    sale_client_name: str | None,
    candidate: dict,
    booking_patient_names: list[str],
) -> tuple[str, dict]:
    """Upgrade single phone hit → high_confidence | review_required + evidence flags."""
    lead_name = candidate.get("lead_name")
    fio = fio_match_level(sale_client_name, lead_name if isinstance(lead_name, str) else None)
    booking_fio_ok = False
    for bn in booking_patient_names:
        lvl = fio_match_level(sale_client_name, bn)
        if lvl in ("exact", "partial"):
            booking_fio_ok = True
            break

    evidence = {
        "phone": True,
        "fio": fio,  # exact|partial|mismatch|empty
        "booking": booking_fio_ok,
        "warning": None,
    }

    high = fio in ("exact", "partial") or booking_fio_ok
    if high:
        return CONF_HIGH, evidence

    evidence["warning"] = "Телефон совпадает, данные пациента отличаются или недостаточны"
    return CONF_REVIEW, evidence


async def build_program_unresolved_report(db: AsyncSession, *, company_id: int) -> dict:
    """KPI program sales without lead_id + suggestion classification (no auto-link)."""
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

    # Booking patient names by lead (for supporting evidence)
    booking_names: dict[int, list[str]] = defaultdict(list)
    appt_rows = (
        await db.execute(
            select(BookingAppointment.lead_id, BookingAppointment.patient_name).where(
                BookingAppointment.company_id == company_id,
                BookingAppointment.lead_id.is_not(None),
            )
        )
    ).all()
    for lid, pname in appt_rows:
        if lid is None or not pname:
            continue
        booking_names[int(lid)].append(str(pname))

    out_rows: list[dict] = []
    counts = {"main_course": 0, "protocol": 0}
    class_counts = {
        "main_course": {CONF_HIGH: 0, CONF_REVIEW: 0, CONF_AMBIGUOUS: 0, CONF_NONE: 0},
        "protocol": {CONF_HIGH: 0, CONF_REVIEW: 0, CONF_AMBIGUOUS: 0, CONF_NONE: 0},
    }

    for sale, item_name, mgr_name, mgr_email in rows:
        kind = classify_product_kind(item_name)
        if kind not in PROGRAM_KINDS:
            continue
        counts[kind] = counts.get(kind, 0) + 1

        phone_class, cands = classify_phone_candidates(
            sale.client_phone,
            phone_index=phone_index,
            lead_meta=lead_meta,
        )

        evidence: dict = {
            "phone": False,
            "fio": "empty",
            "booking": False,
            "warning": None,
        }
        conf = CONF_NONE
        suggested = None

        if phone_class == CONF_AMBIGUOUS:
            conf = CONF_AMBIGUOUS
            evidence["phone"] = True
            evidence["warning"] = "Несколько возможных пациентов (один телефон — несколько Lead)"
        elif phone_class == CONF_NONE:
            conf = CONF_NONE
        else:
            # single phone candidate
            cand = cands[0]
            conf, evidence = enrich_single_candidate(
                sale_client_name=sale.client_name,
                candidate=cand,
                booking_patient_names=booking_names.get(int(cand["lead_id"]), []),
            )
            suggested = cand

        class_counts[kind][conf] = class_counts[kind].get(conf, 0) + 1

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
                "manager_name": str(
                    mgr_name or mgr_email or (f"#{sale.manager_user_id}" if sale.manager_user_id else "—")
                ),
                "suggestion_confidence": conf,
                # legacy alias for older UI — never treat as auto-safe
                "suggestion_confidence_legacy": (
                    "unique" if conf in (CONF_HIGH, CONF_REVIEW) else conf if conf != CONF_NONE else "none"
                ),
                "suggested_lead": suggested,
                "candidate_leads": cands[:5],
                "evidence": evidence,
                "match_evidence": [
                    k
                    for k, v in (
                        ("phone", evidence.get("phone")),
                        ("fio_" + str(evidence.get("fio")), evidence.get("fio") in ("exact", "partial")),
                        ("booking", evidence.get("booking")),
                    )
                    if v
                ],
            }
        )

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
        "classification": {
            "main_course": class_counts["main_course"],
            "protocol": class_counts["protocol"],
        },
        "rows": out_rows,
        "note": (
            "HIGH CONFIDENCE ≠ auto-link. Phone alone is not patient identity "
            "(parent may have several children). Owner confirms manually via link-lead."
        ),
    }
