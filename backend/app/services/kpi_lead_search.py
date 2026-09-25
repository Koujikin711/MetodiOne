"""Lead search for KPI sale picker (Phase 8B). No phone auto-select / auto-merge."""

from __future__ import annotations

from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Lead, LeadExtraPhone, PipelineStage, User
from app.services.phone_match import phone_digits


def _phone_keys(raw: str | None) -> set[str]:
    d = phone_digits(raw)
    if not d:
        return set()
    keys = {d}
    if len(d) >= 9:
        keys.add(d[-9:])
    return keys


async def search_leads_for_kpi_sale(
    db: AsyncSession,
    *,
    company_id: int,
    q: str,
    limit: int = 20,
) -> list[dict]:
    """Search by name / phone / Lead ID. Returns each Lead separately (siblings OK).

    Never collapses multiple Leads with the same phone into one row.
    Caller must require explicit user selection — no auto-pick.
    """
    term = (q or "").strip()
    if len(term) < 1:
        return []
    limit = max(1, min(int(limit), 40))

    # Exact Lead.id when query is numeric
    by_id: list[Lead] = []
    if term.isdigit():
        lid = int(term)
        row = (
            await db.execute(
                select(Lead).where(Lead.company_id == company_id, Lead.id == lid),
            )
        ).scalar_one_or_none()
        if row is not None:
            by_id.append(row)

    like = f"%{term}%"
    digits = phone_digits(term)
    filters = [Lead.name.ilike(like), Lead.phone.ilike(like)]
    if digits and len(digits) >= 4:
        filters.append(Lead.phone.ilike(f"%{digits[-9:]}%"))

    name_phone_rows = (
        await db.execute(
            select(Lead)
            .where(Lead.company_id == company_id, or_(*filters))
            .order_by(Lead.id.desc())
            .limit(80),
        )
    ).scalars().all()

    # Extra phones may hold parent number shared across children
    extra_lead_ids: list[int] = []
    if digits and len(digits) >= 4:
        extras = (
            await db.execute(
                select(LeadExtraPhone.lead_id, LeadExtraPhone.phone).where(
                    LeadExtraPhone.company_id == company_id,
                ),
            )
        ).all()
        want = _phone_keys(term)
        for elid, ephone in extras:
            if _phone_keys(ephone) & want:
                extra_lead_ids.append(int(elid))

    extra_leads: list[Lead] = []
    if extra_lead_ids:
        uniq = sorted(set(extra_lead_ids))
        extra_leads = list(
            (
                await db.execute(
                    select(Lead).where(Lead.company_id == company_id, Lead.id.in_(uniq)),
                )
            ).scalars().all(),
        )

    # Preserve order: exact id first, then name/phone, then extras — no phone dedupe
    seen: set[int] = set()
    ordered: list[Lead] = []
    for lead in [*by_id, *name_phone_rows, *extra_leads]:
        lid = int(lead.id)
        if lid in seen:
            continue
        seen.add(lid)
        ordered.append(lead)
        if len(ordered) >= limit:
            break

    if not ordered:
        return []

    manager_ids = [int(l.manager_id) for l in ordered if l.manager_id is not None]
    mgr_map: dict[int, str] = {}
    if manager_ids:
        for uid, fname, email in (
            await db.execute(select(User.id, User.full_name, User.email).where(User.id.in_(manager_ids)))
        ).all():
            mgr_map[int(uid)] = str(fname or email or f"#{uid}")

    stage_ids = [int(l.status_id) for l in ordered if l.status_id is not None]
    stage_map: dict[int, str] = {}
    if stage_ids:
        for sid, sname in (
            await db.execute(select(PipelineStage.id, PipelineStage.name).where(PipelineStage.id.in_(stage_ids)))
        ).all():
            stage_map[int(sid)] = str(sname or "")

    out: list[dict] = []
    for lead in ordered:
        hint = None
        if term.isdigit() and int(lead.id) == int(term):
            hint = "lead_id"
        elif digits and (_phone_keys(lead.phone) & _phone_keys(term)):
            hint = "phone"
        elif digits and int(lead.id) in set(extra_lead_ids):
            hint = "extra_phone"
        elif term.casefold() in (lead.name or "").casefold():
            hint = "name"
        out.append(
            {
                "lead_id": int(lead.id),
                "name": (lead.name or "").strip() or f"Lead #{lead.id}",
                "phone": lead.phone,
                "manager_name": mgr_map.get(int(lead.manager_id)) if lead.manager_id is not None else None,
                "stage_name": stage_map.get(int(lead.status_id)) if lead.status_id is not None else None,
                "match_hint": hint,
            },
        )
    return out


async def resolve_kpi_sale_lead_id(
    db: AsyncSession,
    *,
    company_id: int,
    lead_id: int | None,
) -> int | None:
    """Validate explicit lead_id for create/link. Cross-company → reject."""
    if lead_id is None:
        return None
    lead = await db.get(Lead, int(lead_id))
    if lead is None or lead.company_id != company_id:
        from fastapi import HTTPException

        raise HTTPException(status_code=400, detail="Lead не найден в компании")
    return int(lead.id)
