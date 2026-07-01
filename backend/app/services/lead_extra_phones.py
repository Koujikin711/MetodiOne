"""Дополнительные телефоны лида (родитель / WhatsApp для связи)."""

from __future__ import annotations

import re

from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Lead, LeadExtraPhone, PipelineStage


def norm_phone(raw: str | None) -> str | None:
    if not raw:
        return None
    digits = re.sub(r"\D+", "", raw)
    return digits or None


def phones_match(a: str | None, b: str | None) -> bool:
    na, nb = norm_phone(a), norm_phone(b)
    if not na or not nb:
        return False
    if na == nb:
        return True
    if len(na) >= 9 and len(nb) >= 9 and na[-9:] == nb[-9:]:
        return True
    return False


async def list_extra_phones(db: AsyncSession, lead_id: int) -> list[str]:
    rows = (
        await db.execute(
            select(LeadExtraPhone.phone)
            .where(LeadExtraPhone.lead_id == lead_id)
            .order_by(LeadExtraPhone.sort_order.asc(), LeadExtraPhone.id.asc()),
        )
    ).all()
    return [str(r[0]) for r in rows if r[0]]


async def get_first_extra_phone(db: AsyncSession, lead_id: int) -> str | None:
    phones = await list_extra_phones(db, lead_id)
    return phones[0] if phones else None


async def sync_lead_extra_phones(
    db: AsyncSession,
    *,
    company_id: int,
    lead_id: int,
    extra_phones: list[str],
    primary_phone: str | None = None,
) -> None:
    """Заменяет доп. номера лида (без дублей с основным)."""
    primary_norm = norm_phone(primary_phone)
    seen: set[str] = set()
    normalized: list[str] = []
    for raw in extra_phones:
        p = norm_phone(raw)
        if not p or len(p) < 7:
            continue
        if primary_norm and phones_match(p, primary_norm):
            continue
        if p in seen:
            continue
        seen.add(p)
        normalized.append(p)

    await db.execute(delete(LeadExtraPhone).where(LeadExtraPhone.lead_id == lead_id))
    for idx, phone in enumerate(normalized):
        db.add(
            LeadExtraPhone(
                company_id=company_id,
                lead_id=lead_id,
                phone=phone,
                label="Доп. номер" if idx == 0 else None,
                sort_order=idx,
            ),
        )
    await db.flush()


async def find_lead_by_any_phone(
    db: AsyncSession,
    *,
    company_id: int,
    phone: str | None,
    pipeline_id: int | None = None,
) -> Lead | None:
    digits = norm_phone(phone)
    if not digits or len(digits) < 7:
        return None

    base = select(Lead).where(Lead.company_id == company_id)
    if pipeline_id is not None:
        base = base.join(PipelineStage, PipelineStage.id == Lead.status_id).where(
            PipelineStage.pipeline_id == pipeline_id,
        )

    exact = (
        await db.execute(
            base.where(Lead.phone == digits).order_by(Lead.id.desc()).limit(1),
        )
    ).scalars().first()
    if exact is not None:
        return exact

    tail = digits[-9:] if len(digits) >= 9 else digits
    candidates = (
        await db.execute(
            base.where(Lead.phone.is_not(None), Lead.phone.ilike(f"%{tail}")).order_by(Lead.id.desc()).limit(40),
        )
    ).scalars().all()
    for lead in candidates:
        if phones_match(lead.phone, digits):
            return lead

    extra_q = select(Lead).join(LeadExtraPhone, LeadExtraPhone.lead_id == Lead.id).where(
        LeadExtraPhone.company_id == company_id,
        LeadExtraPhone.phone == digits,
    )
    if pipeline_id is not None:
        extra_q = extra_q.join(PipelineStage, PipelineStage.id == Lead.status_id).where(
            PipelineStage.pipeline_id == pipeline_id,
        )
    found = (await db.execute(extra_q.order_by(Lead.id.desc()).limit(1))).scalars().first()
    if found is not None:
        return found

    extra_tail_q = (
        select(Lead)
        .join(LeadExtraPhone, LeadExtraPhone.lead_id == Lead.id)
        .where(
            Lead.company_id == company_id,
            LeadExtraPhone.phone.ilike(f"%{tail}"),
        )
    )
    if pipeline_id is not None:
        extra_tail_q = extra_tail_q.join(PipelineStage, PipelineStage.id == Lead.status_id).where(
            PipelineStage.pipeline_id == pipeline_id,
        )
    extra_tail = (await db.execute(extra_tail_q.order_by(Lead.id.desc()).limit(40))).scalars().all()
    for lead in extra_tail:
        rows = (
            await db.execute(select(LeadExtraPhone.phone).where(LeadExtraPhone.lead_id == lead.id))
        ).all()
        for (ep,) in rows:
            if phones_match(ep, digits):
                return lead
    return None
