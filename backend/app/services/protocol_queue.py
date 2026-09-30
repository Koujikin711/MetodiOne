"""Protocol Curator queue (Phase 8D) — 30-day term control, no daily diary.

Derived from Lead + PatientPurchase. One row per Protocol #N episode.
Duration = 30 days from start (purchased_at). Ending-soon threshold via API param.
"""

from __future__ import annotations

import re
import unicodedata
from collections import defaultdict
from datetime import UTC, datetime, timedelta
from typing import Literal

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import (
    ChatThread,
    Lead,
    LeadWaitingCallback,
    PatientPurchase,
    SalesKpiManualSale,
    SalesKpiPlanItem,
    User,
)
from app.services.booking_patient_name import display_patient_identity, load_booking_identity_by_lead
from app.services.patient_ltv import classify_product_kind
from app.services.phone_match import phone_digits
from app.services.product_lexicon import product_display_label

ProtocolQueueState = Literal[
    "active",
    "ending_soon",
    "ended_waiting_next",
    "next_protocol_sold",
]

PROTOCOL_DURATION_DAYS = 30
PROTOCOL_ENDING_SOON_DAYS_DEFAULT = 7
PROTOCOL_PREDICATE = "purchase_linked"

ACTIVE_QUEUE_STATES = frozenset({"active", "ending_soon", "ended_waiting_next"})


def _utc(dt: datetime | None) -> datetime | None:
    if dt is None:
        return None
    if dt.tzinfo is None:
        return dt.replace(tzinfo=UTC)
    return dt.astimezone(UTC)


def protocol_purchase_counts(p: PatientPurchase) -> bool:
    if (p.product_kind or "") != "protocol":
        return False
    st = (p.status or "").strip()
    return st not in ("cancelled", "returned", "refused")


def purchase_closed_by_kpi_sale(p: PatientPurchase, closed_sale_ids: set[int]) -> bool:
    """Отказ/возврат на продаже KPI закрывает протокол, даже если карточка ещё active."""
    if (p.source_type or "") != "kpi_manual_sale" or not closed_sale_ids:
        return False
    try:
        return int(p.source_id) in closed_sale_ids
    except (TypeError, ValueError):
        return False


def protocol_sale_ids_already_linked(purchases: list[PatientPurchase]) -> set[int]:
    """KPI-продажа уже есть в очереди, если по ней есть покупка с пациентом."""
    return {
        int(p.source_id)
        for p in purchases
        if (p.source_type or "") == "kpi_manual_sale"
        and p.lead_id is not None
        and protocol_purchase_counts(p)
    }


def classify_protocol_episodes(
    purchases: list[PatientPurchase],
    *,
    now: datetime | None = None,
    ending_soon_days: int = PROTOCOL_ENDING_SOON_DAYS_DEFAULT,
) -> list[dict]:
    """All Protocol #N episodes for one Lead (order by purchased_at).

    Next Protocol purchase closes waiting on the previous episode
    (state=next_protocol_sold). Massage/TMS/Course do not.
    """
    protocols = [p for p in purchases if protocol_purchase_counts(p)]
    if not protocols:
        return []

    def _at(p: PatientPurchase) -> datetime:
        return _utc(p.purchased_at) or datetime.min.replace(tzinfo=UTC)

    protocols_sorted = sorted(protocols, key=_at)
    n = _utc(now) or datetime.now(UTC)
    soon = max(0, min(int(ending_soon_days), 30))
    out: list[dict] = []

    for idx, current in enumerate(protocols_sorted, start=1):
        start = _at(current)
        expected_end = start + timedelta(days=PROTOCOL_DURATION_DAYS)
        days_remaining = (expected_end.date() - n.date()).days
        later = protocols_sorted[idx:]  # after this one
        previous = [
            {
                "sequence_no": j,
                "purchase_id": int(p.id),
                "started_at": _at(p),
                "expected_end_at": _at(p) + timedelta(days=PROTOCOL_DURATION_DAYS),
                "product_name": p.product_name,
            }
            for j, p in enumerate(protocols_sorted[: idx - 1], start=1)
        ]

        if later:
            nxt = later[0]
            state: ProtocolQueueState = "next_protocol_sold"
            next_id, next_at = int(nxt.id), _at(nxt)
        elif days_remaining < 0:
            state = "ended_waiting_next"
            next_id, next_at = None, None
        elif days_remaining <= soon:
            state = "ending_soon"
            next_id, next_at = None, None
        else:
            state = "active"
            next_id, next_at = None, None

        out.append(
            {
                "state": state,
                "sequence_no": idx,
                "protocols_count": len(protocols_sorted),
                "purchase_id": int(current.id),
                "started_at": start,
                "expected_end_at": expected_end,
                "days_remaining": days_remaining,
                "previous_protocols": previous,
                "product_name": current.product_name,
                "next_protocol_purchase_id": next_id,
                "next_protocol_at": next_at,
            },
        )
    return out


def _protocol_client_key(name: str | None, phone: str | None) -> str | None:
    """Ключ серии #1, #2, #3 для продаж без карточки. Не привязывает Lead."""
    digits = phone_digits(phone)
    if len(digits) < 9:
        return None
    raw = unicodedata.normalize("NFKC", name or "").casefold().replace("ё", "е")
    raw = re.sub(r"\s+", " ", raw).strip()
    if len(raw) < 3:
        return None
    return f"{digits[-9:]}|{raw}"


def cluster_unlinked_protocols(
    items: list[tuple[PatientPurchase, str]],
) -> list[list[tuple[PatientPurchase, str]]]:
    """Одинаковые имя и телефон без карточки — одна серия протоколов."""
    groups: dict[str, list[tuple[PatientPurchase, str]]] = {}
    order: list[str] = []
    singles: list[list[tuple[PatientPurchase, str]]] = []
    for item in items:
        purchase, _mgr = item
        key = _protocol_client_key(purchase.client_name, purchase.client_phone)
        if key is None:
            singles.append([item])
            continue
        if key not in groups:
            groups[key] = []
            order.append(key)
        groups[key].append(item)
    return [groups[key] for key in order] + singles


def next_sale_label(state: ProtocolQueueState) -> str:
    if state == "next_protocol_sold":
        return "Следующий Протокол куплен"
    if state == "ended_waiting_next":
        return "Срок закончился — следующий Протокол не куплен"
    if state == "ending_soon":
        return "Срок скоро — связаться по следующему Протоколу"
    return "в сроке Протокола"


def requires_attention(
    *,
    state: ProtocolQueueState,
    days_remaining: int,
    next_contact_at: datetime | None,
    now: datetime | None = None,
) -> tuple[bool, str | None]:
    if state == "ended_waiting_next":
        return True, "Срок Протокола закончился — следующий не куплен"
    if state == "ending_soon":
        if days_remaining == 0:
            return True, "Срок Протокола заканчивается сегодня"
        return True, f"Срок Протокола заканчивается через {days_remaining} дн."
    if next_contact_at is not None:
        n = now or datetime.now(UTC)
        nc = _utc(next_contact_at)
        if nc is not None and nc < n:
            return True, "Следующий контакт просрочен"
    return False, None


async def build_protocol_queue(
    db: AsyncSession,
    *,
    company_id: int,
    include_converted: bool = False,
    ending_soon_days: int = PROTOCOL_ENDING_SOON_DAYS_DEFAULT,
    q: str | None = None,
) -> dict:
    purchases = (
        await db.execute(
            select(PatientPurchase).where(
                PatientPurchase.company_id == company_id,
                PatientPurchase.lead_id.is_not(None),
                PatientPurchase.status.notin_(("cancelled",)),
            ),
        )
    ).scalars().all()

    closed_sale_ids = {
        int(sale_id)
        for sale_id in (
            await db.execute(
                select(SalesKpiManualSale.id).where(
                    SalesKpiManualSale.company_id == company_id,
                    SalesKpiManualSale.status.in_(("returned", "refused", "cancelled")),
                ),
            )
        ).scalars().all()
    }
    purchases = [p for p in purchases if not purchase_closed_by_kpi_sale(p, closed_sale_ids)]

    by_lead: dict[int, list[PatientPurchase]] = defaultdict(list)
    for p in purchases:
        by_lead[int(p.lead_id)].append(p)

    already = protocol_sale_ids_already_linked(purchases)
    sale_rows = (
        await db.execute(
            select(SalesKpiManualSale, SalesKpiPlanItem.name, User.full_name)
            .join(SalesKpiPlanItem, SalesKpiPlanItem.id == SalesKpiManualSale.plan_item_id)
            .outerjoin(User, User.id == SalesKpiManualSale.manager_user_id)
            .where(
                SalesKpiManualSale.company_id == company_id,
                SalesKpiManualSale.status.notin_(("returned", "refused", "cancelled")),
            ),
        )
    ).all()
    unlinked: list[tuple[PatientPurchase, str]] = []
    for sale, item_name, mgr_name in sale_rows:
        if classify_product_kind(item_name) != "protocol":
            continue
        if int(sale.id) in already:
            continue
        synthetic = PatientPurchase(
            id=-int(sale.id),
            company_id=company_id,
            lead_id=int(sale.lead_id) if sale.lead_id is not None else None,
            source_type="kpi_manual_sale",
            source_id=int(sale.id),
            product_kind="protocol",
            product_name=str(item_name or "Протокол"),
            service_amount=sale.service_amount or 0,
            paid_amount=sale.paid_amount or 0,
            status=(sale.status or "active").strip(),
            purchased_at=sale.sold_at,
            client_name=sale.client_name,
            client_phone=sale.client_phone,
        )
        if sale.lead_id is not None:
            by_lead[int(sale.lead_id)].append(synthetic)
        else:
            unlinked.append((synthetic, str(mgr_name or "").strip()))

    now = datetime.now(UTC)
    # (lead_id, episode_info)
    classified: list[tuple[int, dict]] = []
    for lid, pur_list in by_lead.items():
        for ep in classify_protocol_episodes(
            pur_list, now=now, ending_soon_days=ending_soon_days,
        ):
            if not include_converted and ep["state"] not in ACTIVE_QUEUE_STATES:
                continue
            classified.append((lid, ep))

    empty = {
        "predicate": PROTOCOL_PREDICATE,
        "duration_days": PROTOCOL_DURATION_DAYS,
        "ending_soon_days": ending_soon_days,
        "include_converted": include_converted,
        "note": (
            "Очередь Протоколов: контроль 30-дневного срока и следующей продажи. "
            "Без daily Дневник/Фото/Жалоба. Multi-state: Курс может идти параллельно. "
            "Каждый Protocol #N — отдельная строка. "
            "Показаны уже купленные протоколы, в том числе без привязки к пациенту."
        ),
        "counts": {
            "active": 0,
            "ending_soon": 0,
            "ended_waiting_next": 0,
            "next_protocol_sold": 0,
            "requires_attention": 0,
        },
        "rows": [],
    }
    if not classified and not unlinked:
        return empty

    lead_ids = sorted({lid for lid, _ in classified})
    leads = []
    if lead_ids:
        leads = (
            await db.execute(select(Lead).where(Lead.company_id == company_id, Lead.id.in_(lead_ids)))
        ).scalars().all()
    lead_map = {int(l.id): l for l in leads}

    mgr_ids = [int(l.manager_id) for l in leads if l.manager_id is not None]
    mgr_map: dict[int, str] = {}
    if mgr_ids:
        for uid, fname, email in (
            await db.execute(select(User.id, User.full_name, User.email).where(User.id.in_(mgr_ids)))
        ).all():
            mgr_map[int(uid)] = str(fname or email or f"#{uid}")

    cbs = []
    if lead_ids:
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

    threads = []
    if lead_ids:
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

    booking_by_lead = await load_booking_identity_by_lead(db, company_id=company_id, lead_ids=lead_ids) if lead_ids else {}

    term = (q or "").strip().casefold()
    dig_term = "".join(ch for ch in term if ch.isdigit())
    counts = {
        "active": 0,
        "ending_soon": 0,
        "ended_waiting_next": 0,
        "next_protocol_sold": 0,
        "requires_attention": 0,
    }
    rows: list[dict] = []

    for lid, info in classified:
        lead = lead_map.get(lid)
        if lead is None:
            continue
        name, phone = display_patient_identity(
            lead_name=lead.name,
            lead_phone=lead.phone,
            booking=booking_by_lead.get(lid),
        )
        if term:
            dig_p = "".join(ch for ch in (phone or "") if ch.isdigit())
            lead_name = (lead.name or "").casefold()
            name_ok = term in name.casefold() or term in lead_name
            id_ok = term in str(lid)
            phone_ok = bool(dig_term) and len(dig_term) >= 3 and dig_term in dig_p
            if not (name_ok or id_ok or phone_ok):
                continue

        state: ProtocolQueueState = info["state"]
        counts[state] = counts.get(state, 0) + 1
        next_c = next_by_lead.get(lid)
        last_c = last_cb_by_lead.get(lid) or chat_last.get(lid)
        days_rem = int(info["days_remaining"])
        attn, attn_reason = requires_attention(
            state=state,
            days_remaining=days_rem,
            next_contact_at=next_c,
            now=now,
        )
        if attn:
            counts["requires_attention"] += 1

        prev_label = ", ".join(
            f"#{x['sequence_no']}" for x in info["previous_protocols"]
        ) or "—"

        rows.append(
            {
                "lead_id": lid,
                "patient_name": name,
                "patient_phone": phone,
                "product_label": product_display_label("protocol", info.get("product_name")),
                "sequence_no": info["sequence_no"],
                "protocols_count": info["protocols_count"],
                "state": state,
                "state_label": {
                    "active": "В сроке",
                    "ending_soon": "Скоро конец",
                    "ended_waiting_next": "Срок вышел — ждёт следующий",
                    "next_protocol_sold": "Следующий Протокол куплен",
                }.get(state, state),
                "started_at": info["started_at"],
                "expected_end_at": info["expected_end_at"],
                "days_remaining": days_rem,
                "previous_protocols_label": prev_label,
                "previous_protocols": info["previous_protocols"],
                "manager_name": mgr_map.get(int(lead.manager_id)) if lead.manager_id else None,
                "responsible_name": mgr_map.get(int(lead.manager_id)) if lead.manager_id else None,
                "last_contact_at": last_c,
                "next_contact_at": next_c,
                "next_sale_status": next_sale_label(state),
                "requires_attention": attn,
                "attention_reason": attn_reason,
                "purchase_id": info["purchase_id"],
            },
        )

    state_labels = {
        "active": "В сроке",
        "ending_soon": "Скоро конец",
        "ended_waiting_next": "Срок вышел — ждёт следующий",
        "next_protocol_sold": "Следующий Протокол куплен",
    }
    by_purchase_id = {int(purchase.id): (purchase, mgr) for purchase, mgr in unlinked}
    for group in cluster_unlinked_protocols(unlinked):
        episodes = classify_protocol_episodes(
            [purchase for purchase, _mgr in group],
            now=now,
            ending_soon_days=ending_soon_days,
        )
        for info in episodes:
            if not include_converted and info["state"] not in ACTIVE_QUEUE_STATES:
                continue
            found = by_purchase_id.get(int(info["purchase_id"]))
            if found is None:
                continue
            synthetic, mgr_name = found
            name = (synthetic.client_name or "").strip() or "—"
            phone = (synthetic.client_phone or "").strip()
            if term:
                dig_p = "".join(ch for ch in phone if ch.isdigit())
                name_ok = term in name.casefold()
                phone_ok = bool(dig_term) and len(dig_term) >= 3 and dig_term in dig_p
                if not (name_ok or phone_ok):
                    continue
            state = info["state"]
            counts[state] = counts.get(state, 0) + 1
            days_rem = int(info["days_remaining"])
            attn, attn_reason = requires_attention(
                state=state,
                days_remaining=days_rem,
                next_contact_at=None,
                now=now,
            )
            if attn:
                counts["requires_attention"] += 1
            prev_label = ", ".join(
                f"#{x['sequence_no']}" for x in info["previous_protocols"]
            ) or "—"
            rows.append(
                {
                    "lead_id": None,
                    "patient_name": name,
                    "patient_phone": phone or None,
                    "product_label": product_display_label("protocol", info.get("product_name")),
                    "sequence_no": info["sequence_no"],
                    "protocols_count": info["protocols_count"],
                    "state": state,
                    "state_label": state_labels.get(state, state),
                    "started_at": info["started_at"],
                    "expected_end_at": info["expected_end_at"],
                    "days_remaining": days_rem,
                    "previous_protocols_label": prev_label,
                    "previous_protocols": info["previous_protocols"],
                    "manager_name": mgr_name or None,
                    "responsible_name": mgr_name or None,
                    "last_contact_at": None,
                    "next_contact_at": None,
                    "next_sale_status": next_sale_label(state),
                    "requires_attention": attn,
                    "attention_reason": attn_reason,
                    "purchase_id": int(synthetic.source_id),
                },
            )

    order = {
        "ended_waiting_next": 0,
        "ending_soon": 1,
        "active": 2,
        "next_protocol_sold": 3,
    }
    rows.sort(
        key=lambda r: (
            0 if r["requires_attention"] else 1,
            order.get(r["state"], 9),
            r["days_remaining"],
            (r["patient_name"] or "").casefold(),
            r["sequence_no"],
        ),
    )

    return {
        "predicate": PROTOCOL_PREDICATE,
        "duration_days": PROTOCOL_DURATION_DAYS,
        "ending_soon_days": ending_soon_days,
        "include_converted": include_converted,
        "note": empty["note"],
        "counts": counts,
        "rows": rows,
    }
