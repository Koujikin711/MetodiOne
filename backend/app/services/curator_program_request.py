"""Заявка куратора на Курс / Протокол. Деньги вносит только админ в KPI."""

from __future__ import annotations

from datetime import UTC, datetime

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import CuratorProgramRequest, Lead, PatientPurchase, User
from app.services.booking_patient_name import display_patient_identity, load_booking_identity_by_lead
from app.services.course15_queue import classify_course15_queue_state
from app.services.patient_ltv import classify_product_kind

OPEN_STATUS = "pending"
PROGRAM_KINDS = frozenset({"main_course", "protocol"})


def program_label(kind: str) -> str:
    if kind == "main_course":
        return "Курс"
    if kind == "protocol":
        return "Протокол"
    return kind


def sale_kind_matches_request(program_kind: str, product_name: str | None) -> bool:
    return program_kind in PROGRAM_KINDS and classify_product_kind(product_name) == program_kind


async def pending_program_by_lead(
    db: AsyncSession,
    *,
    company_id: int,
    lead_ids: list[int],
) -> dict[int, str]:
    if not lead_ids:
        return {}
    rows = (
        await db.execute(
            select(CuratorProgramRequest.lead_id, CuratorProgramRequest.program_kind).where(
                CuratorProgramRequest.company_id == company_id,
                CuratorProgramRequest.lead_id.in_(lead_ids),
                CuratorProgramRequest.status == OPEN_STATUS,
            ),
        )
    ).all()
    return {int(lid): str(kind) for lid, kind in rows}


async def create_program_request(
    db: AsyncSession,
    *,
    company_id: int,
    lead_id: int,
    program_kind: str,
    user: User,
) -> CuratorProgramRequest:
    if program_kind not in PROGRAM_KINDS:
        raise HTTPException(status_code=400, detail="Можно подтвердить только Курс или Протокол")
    lead = await db.get(Lead, lead_id)
    if lead is None or lead.company_id != company_id:
        raise HTTPException(status_code=404, detail="Пациент не найден")

    purchases = (
        await db.execute(
            select(PatientPurchase).where(
                PatientPurchase.company_id == company_id,
                PatientPurchase.lead_id == lead_id,
                PatientPurchase.status.notin_(("cancelled",)),
            ),
        )
    ).scalars().all()
    info = classify_course15_queue_state(list(purchases))
    if info is None:
        raise HTTPException(status_code=400, detail="У пациента нет Курса 15 в очереди")
    if info["state"] in ("converted_to_course", "converted_to_protocol"):
        raise HTTPException(status_code=400, detail="Курс или Протокол уже куплен")

    booking = await load_booking_identity_by_lead(db, company_id=company_id, lead_ids=[lead_id])
    name, phone = display_patient_identity(
        lead_name=lead.name,
        lead_phone=lead.phone,
        booking=booking.get(lead_id),
    )
    now = datetime.now(UTC)
    existing = (
        await db.execute(
            select(CuratorProgramRequest).where(
                CuratorProgramRequest.company_id == company_id,
                CuratorProgramRequest.lead_id == lead_id,
                CuratorProgramRequest.status == OPEN_STATUS,
            ),
        )
    ).scalars().all()
    for row in existing:
        if row.program_kind == program_kind:
            row.patient_name = name
            row.patient_phone = phone
            row.manager_user_id = int(lead.manager_id) if lead.manager_id else None
            row.updated_at = now
            await db.commit()
            await db.refresh(row)
            return row
        row.status = "withdrawn"
        row.updated_at = now

    req = CuratorProgramRequest(
        company_id=company_id,
        lead_id=lead_id,
        program_kind=program_kind,
        status=OPEN_STATUS,
        patient_name=name,
        patient_phone=phone,
        manager_user_id=int(lead.manager_id) if lead.manager_id else None,
        requested_by_user_id=int(user.id),
        created_at=now,
        updated_at=now,
    )
    db.add(req)
    await db.commit()
    await db.refresh(req)
    return req


async def withdraw_program_request(
    db: AsyncSession,
    *,
    company_id: int,
    lead_id: int,
) -> None:
    rows = (
        await db.execute(
            select(CuratorProgramRequest).where(
                CuratorProgramRequest.company_id == company_id,
                CuratorProgramRequest.lead_id == lead_id,
                CuratorProgramRequest.status == OPEN_STATUS,
            ),
        )
    ).scalars().all()
    if not rows:
        raise HTTPException(status_code=404, detail="Заявки у админа нет")
    now = datetime.now(UTC)
    for row in rows:
        row.status = "withdrawn"
        row.updated_at = now
    await db.commit()


async def list_pending_requests(
    db: AsyncSession,
    *,
    company_id: int,
) -> list[dict]:
    rows = (
        await db.execute(
            select(CuratorProgramRequest, User.full_name, User.email)
            .outerjoin(User, User.id == CuratorProgramRequest.requested_by_user_id)
            .where(
                CuratorProgramRequest.company_id == company_id,
                CuratorProgramRequest.status == OPEN_STATUS,
            )
            .order_by(CuratorProgramRequest.created_at.asc()),
        )
    ).all()
    mgr_ids = [int(r.manager_user_id) for r, _, _ in rows if r.manager_user_id]
    mgr_map: dict[int, str] = {}
    if mgr_ids:
        for uid, fname, email in (
            await db.execute(select(User.id, User.full_name, User.email).where(User.id.in_(mgr_ids)))
        ).all():
            mgr_map[int(uid)] = str(fname or email or "")
    out: list[dict] = []
    for req, fname, email in rows:
        out.append(
            {
                "id": int(req.id),
                "lead_id": int(req.lead_id),
                "program_kind": req.program_kind,
                "program_label": program_label(req.program_kind),
                "patient_name": req.patient_name,
                "patient_phone": req.patient_phone,
                "manager_user_id": int(req.manager_user_id) if req.manager_user_id else None,
                "manager_name": mgr_map.get(int(req.manager_user_id)) if req.manager_user_id else None,
                "requested_by_name": str(fname or email or ""),
                "created_at": req.created_at,
            },
        )
    return out


async def dismiss_program_request(
    db: AsyncSession,
    *,
    company_id: int,
    request_id: int,
) -> None:
    row = await db.get(CuratorProgramRequest, request_id)
    if row is None or row.company_id != company_id or row.status != OPEN_STATUS:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Заявка не найдена")
    row.status = "dismissed"
    row.updated_at = datetime.now(UTC)
    await db.commit()


async def accept_requests_for_sale(
    db: AsyncSession,
    *,
    company_id: int,
    lead_id: int | None,
    product_name: str | None,
    sale_id: int,
) -> None:
    if lead_id is None:
        return
    kind = classify_product_kind(product_name)
    if kind not in PROGRAM_KINDS:
        return
    rows = (
        await db.execute(
            select(CuratorProgramRequest).where(
                CuratorProgramRequest.company_id == company_id,
                CuratorProgramRequest.lead_id == int(lead_id),
                CuratorProgramRequest.status == OPEN_STATUS,
                CuratorProgramRequest.program_kind == kind,
            ),
        )
    ).scalars().all()
    now = datetime.now(UTC)
    for row in rows:
        row.status = "accepted"
        row.sale_id = int(sale_id)
        row.updated_at = now
