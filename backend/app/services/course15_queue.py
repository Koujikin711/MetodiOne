"""Course15 Curator waiting / next-product queue (Phase 8C).

Derived from Lead + PatientPurchase — no second Patient entity, no Telegram daily.
Eligibility for «next program» is centralized so Phase 8G can swap predicate later
without rewriting UI (currently purchase-based, NOT fully-paid cutover).
"""

from __future__ import annotations

from collections import defaultdict
from datetime import UTC, datetime
from typing import Literal

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import ChatThread, Lead, LeadWaitingCallback, PatientJourney, PatientPurchase, User
from app.services.patient_journey import purchase_is_fulfilled
from app.services.product_lexicon import product_display_label

Course15QueueState = Literal[
    "active",
    "waiting_next_step",
    "converted_to_course",
    "converted_to_protocol",
]

NEXT_PROGRAM_KINDS = frozenset({"main_course", "protocol"})
ACTIVE_QUEUE_STATES = frozenset({"active", "waiting_next_step"})

# Predicate version — bump when swapping to fully_paid after 8F/8G approve.
COURSE15_NEXT_PROGRAM_PREDICATE = "purchase_linked"  # future: "fully_paid"


def _utc(dt: datetime | None) -> datetime | None:
    if dt is None:
        return None
    if dt.tzinfo is None:
        return dt.replace(tzinfo=UTC)
    return dt.astimezone(UTC)


def course15_purchase_counts(p: PatientPurchase) -> bool:
    """Participation in Course15 queue (linked purchase assumed by caller)."""
    if (p.product_kind or "") != "course_15":
        return False
    return (p.status or "").strip() != "cancelled"


def next_program_purchase_counts(p: PatientPurchase) -> bool:
    """Backend eligibility for closing Course15 waiting.

    CURRENT (8C): any linked non-cancelled/returned main_course|protocol purchase.
    Do NOT use TARGET fully_paid until Phase 8G after Deposit DQ (8F).
    Frontend must not reimplement this.
    """
    if (p.product_kind or "") not in NEXT_PROGRAM_KINDS:
        return False
    st = (p.status or "").strip()
    return st not in ("cancelled", "returned")


def classify_course15_queue_state(
    purchases: list[PatientPurchase],
) -> dict | None:
    """Classify one Lead's Course15 operational state from purchases.

    Returns None if Lead has no Course15 participation.
    Massage/TMS/EEG/other_service never close waiting.
    Masterclass is ignored (not a gate).
    """
    c15 = [p for p in purchases if course15_purchase_counts(p)]
    if not c15:
        return None

    def _at(p: PatientPurchase) -> datetime:
        return _utc(p.purchased_at) or datetime.min.replace(tzinfo=UTC)

    anchor = max(c15, key=_at)
    anchor_at = _at(anchor)
    earliest = min(c15, key=_at)

    next_ps = [
        p
        for p in purchases
        if next_program_purchase_counts(p)
        and _at(p) >= anchor_at
        and int(p.id) != int(anchor.id)
    ]

    if next_ps:
        first = min(next_ps, key=_at)
        kind = first.product_kind or ""
        state: Course15QueueState = (
            "converted_to_course" if kind == "main_course" else "converted_to_protocol"
        )
        return {
            "state": state,
            "anchor_purchase_id": int(anchor.id),
            "course15_started_at": _utc(earliest.purchased_at),
            "course15_ended_at": None,  # filled from journey when available
            "next_program_kind": kind,
            "next_program_purchase_id": int(first.id),
            "next_program_at": _utc(first.purchased_at),
            "product_name": anchor.product_name,
            "anchor_fulfilled": purchase_is_fulfilled(anchor),
        }

    fulfilled = purchase_is_fulfilled(anchor)
    state = "waiting_next_step" if fulfilled else "active"
    return {
        "state": state,
        "anchor_purchase_id": int(anchor.id),
        "course15_started_at": _utc(earliest.purchased_at),
        "course15_ended_at": None,
        "next_program_kind": None,
        "next_program_purchase_id": None,
        "next_program_at": None,
        "product_name": anchor.product_name,
        "anchor_fulfilled": fulfilled,
    }


def next_step_label(state: Course15QueueState) -> str:
    if state == "active":
        return "в процессе Курс 15"
    if state == "waiting_next_step":
        return "не определён"
    if state == "converted_to_course":
        return "Курс куплен"
    if state == "converted_to_protocol":
        return "Протокол куплен"
    return "не определён"


def requires_attention(
    *,
    state: Course15QueueState,
    next_contact_at: datetime | None,
    now: datetime | None = None,
) -> tuple[bool, str | None]:
    """Deterministic rules only. No «X days without contact» hardcode."""
    if state == "waiting_next_step":
        return True, "Курс 15 завершён — следующий продукт не куплен"
    if next_contact_at is not None:
        n = now or datetime.now(UTC)
        nc = _utc(next_contact_at)
        if nc is not None and nc < n:
            return True, "Следующий контакт просрочен"
    return False, None


async def build_course15_queue(
    db: AsyncSession,
    *,
    company_id: int,
    include_converted: bool = False,
    q: str | None = None,
) -> dict:
    """Active Course15 lifecycle queue (backend-derived)."""
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

    classified: list[tuple[int, dict]] = []
    for lid, pur_list in by_lead.items():
        info = classify_course15_queue_state(pur_list)
        if info is None:
            continue
        if not include_converted and info["state"] not in ACTIVE_QUEUE_STATES:
            continue
        classified.append((lid, info))

    if not classified:
        return {
            "predicate": COURSE15_NEXT_PROGRAM_PREDICATE,
            "include_converted": include_converted,
            "note": (
                "Очередь Курс 15: lifecycle / next product. Не Telegram daily. "
                "Massage/TMS/EEG не закрывают waiting. Курс/Протокол — закрывают. "
                "Eligibility next-program = purchase-linked (не fully-paid cutover)."
            ),
            "counts": {
                "active": 0,
                "waiting_next_step": 0,
                "converted_to_course": 0,
                "converted_to_protocol": 0,
                "requires_attention": 0,
            },
            "rows": [],
        }

    lead_ids = [lid for lid, _ in classified]
    leads = (
        await db.execute(select(Lead).where(Lead.company_id == company_id, Lead.id.in_(lead_ids)))
    ).scalars().all()
    lead_map = {int(l.id): l for l in leads}

    journeys = (
        await db.execute(
            select(PatientJourney).where(
                PatientJourney.company_id == company_id,
                PatientJourney.lead_id.in_(lead_ids),
            ),
        )
    ).scalars().all()
    journey_map = {int(j.lead_id): j for j in journeys}

    mgr_ids = [int(l.manager_id) for l in leads if l.manager_id is not None]
    mgr_map: dict[int, str] = {}
    if mgr_ids:
        for uid, fname, email in (
            await db.execute(select(User.id, User.full_name, User.email).where(User.id.in_(mgr_ids)))
        ).all():
            mgr_map[int(uid)] = str(fname or email or f"#{uid}")

    # next contact: earliest scheduled waiting callback (reuse CRM waiting — no second activity system)
    cbs = (
        await db.execute(
            select(LeadWaitingCallback).where(
                LeadWaitingCallback.company_id == company_id,
                LeadWaitingCallback.lead_id.in_(lead_ids),
                LeadWaitingCallback.status == "scheduled",
            ),
        )
    ).scalars().all()
    next_by_lead: dict[int, datetime] = {}
    last_cb_by_lead: dict[int, datetime] = {}
    now = datetime.now(UTC)
    for cb in cbs:
        lid = int(cb.lead_id)
        at = _utc(cb.scheduled_at)
        if at is None:
            continue
        if at >= now:
            prev = next_by_lead.get(lid)
            if prev is None or at < prev:
                next_by_lead[lid] = at
        else:
            prev = last_cb_by_lead.get(lid)
            if prev is None or at > prev:
                last_cb_by_lead[lid] = at

    # last contact fallback: chat thread updated_at
    threads = (
        await db.execute(
            select(ChatThread.lead_id, ChatThread.updated_at).where(
                ChatThread.company_id == company_id,
                ChatThread.lead_id.in_(lead_ids),
            ),
        )
    ).all()
    chat_last: dict[int, datetime] = {}
    for lid, upd in threads:
        if lid is None or upd is None:
            continue
        u = _utc(upd)
        if u is None:
            continue
        prev = chat_last.get(int(lid))
        if prev is None or u > prev:
            chat_last[int(lid)] = u

    term = (q or "").strip().casefold()
    dig_term = "".join(ch for ch in term if ch.isdigit())
    rows: list[dict] = []
    counts = {
        "active": 0,
        "waiting_next_step": 0,
        "converted_to_course": 0,
        "converted_to_protocol": 0,
        "requires_attention": 0,
    }

    for lid, info in classified:
        lead = lead_map.get(lid)
        if lead is None:
            continue
        name = (lead.name or "").strip() or f"Lead #{lid}"
        phone = lead.phone
        if term:
            dig_p = "".join(ch for ch in (phone or "") if ch.isdigit())
            name_ok = term in name.casefold()
            id_ok = term in str(lid)
            phone_ok = bool(dig_term) and len(dig_term) >= 3 and dig_term in dig_p
            if not (name_ok or id_ok or phone_ok):
                continue

        state: Course15QueueState = info["state"]
        counts[state] = counts.get(state, 0) + 1

        j = journey_map.get(lid)
        started = (j and _utc(j.course_15_started_at)) or info["course15_started_at"]
        # End only when Journey has completed_at — never invent duration
        ended = _utc(j.course_15_completed_at) if j and j.course_15_completed_at else None
        if state == "active":
            ended = None

        next_c = next_by_lead.get(lid)
        last_c = last_cb_by_lead.get(lid) or chat_last.get(lid)
        attn, attn_reason = requires_attention(state=state, next_contact_at=next_c, now=now)
        if attn:
            counts["requires_attention"] += 1

        rows.append(
            {
                "lead_id": lid,
                "patient_name": name,
                "patient_phone": phone,
                "product_label": product_display_label("course_15", info.get("product_name")),
                "state": state,
                "state_label": {
                    "active": "Активен",
                    "waiting_next_step": "Ждёт следующий шаг",
                    "converted_to_course": "Перешёл на Курс",
                    "converted_to_protocol": "Перешёл на Протокол",
                }.get(state, state),
                "started_at": started,
                "ended_at": ended,
                "manager_name": mgr_map.get(int(lead.manager_id)) if lead.manager_id else None,
                "responsible_name": mgr_map.get(int(lead.manager_id)) if lead.manager_id else None,
                "last_contact_at": last_c,
                "next_contact_at": next_c,
                "next_step": next_step_label(state),
                "requires_attention": attn,
                "attention_reason": attn_reason,
                "anchor_purchase_id": info["anchor_purchase_id"],
                "next_program_kind": info["next_program_kind"],
            },
        )

    # waiting first, then active, then attention, then name
    order = {"waiting_next_step": 0, "active": 1, "converted_to_course": 2, "converted_to_protocol": 3}
    rows.sort(
        key=lambda r: (
            0 if r["requires_attention"] else 1,
            order.get(r["state"], 9),
            (r["patient_name"] or "").casefold(),
        ),
    )

    return {
        "predicate": COURSE15_NEXT_PROGRAM_PREDICATE,
        "include_converted": include_converted,
        "note": (
            "Очередь Курс 15: lifecycle / next product. Не Telegram daily. "
            "Massage/TMS/EEG не закрывают waiting. Курс/Протокол — закрывают. "
            "Eligibility next-program = purchase-linked (не fully-paid cutover)."
        ),
        "counts": counts,
        "rows": rows,
    }
