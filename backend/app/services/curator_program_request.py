"""Заявка куратора на Курс / Протокол. Деньги вносит только админ в KPI."""

from __future__ import annotations

from datetime import UTC, datetime

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import (
    CuratorProgramRequest,
    Lead,
    PatientPurchase,
    SalesKpiManualSale,
    SalesKpiPlanItem,
    User,
)
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
                "program_label": (
            f"{program_label(req.program_kind)} {req.note}".strip()
            if req.note
            else program_label(req.program_kind)
        ),
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


def _person_key(name: str | None, phone: str | None) -> tuple[str, str]:
    folded = (name or "").replace("ё", "е").replace("Ё", "Е").casefold().strip()
    digits = "".join(ch for ch in (phone or "") if ch.isdigit())
    tail = digits[-9:] if len(digits) >= 9 else digits
    return folded, tail


async def _open_protocol_requests(
    db: AsyncSession,
    *,
    company_id: int,
    kinds: frozenset[str] | None = None,
) -> list[CuratorProgramRequest]:
    allowed = kinds or frozenset({"protocol"})
    return list(
        (
            await db.execute(
                select(CuratorProgramRequest).where(
                    CuratorProgramRequest.company_id == company_id,
                    CuratorProgramRequest.status == OPEN_STATUS,
                    CuratorProgramRequest.program_kind.in_(allowed),
                ),
            )
        ).scalars().all()
    )


def _request_matches_row(req: CuratorProgramRequest, row: dict) -> bool:
    lead_id = row.get("lead_id")
    if lead_id is not None and req.lead_id is not None:
        return int(req.lead_id) == int(lead_id)
    if lead_id is not None or req.lead_id is not None:
        return False
    return _person_key(req.patient_name, req.patient_phone) == _person_key(
        row.get("patient_name"),
        row.get("patient_phone"),
    )


async def attach_protocol_request_ids(
    db: AsyncSession,
    *,
    company_id: int,
    rows: list[dict],
) -> None:
    reqs = await _open_protocol_requests(
        db, company_id=company_id, kinds=frozenset({"protocol", "main_course"}),
    )
    for row in rows:
        match = next((req for req in reqs if _request_matches_row(req, row)), None)
        row["next_request_id"] = int(match.id) if match else None
        row["next_request_kind"] = match.program_kind if match else None


async def create_next_protocol_request(
    db: AsyncSession,
    *,
    company_id: int,
    user: User,
    sequence_no: int,
    lead_id: int | None = None,
    sale_id: int | None = None,
    program_kind: str = "protocol",
) -> CuratorProgramRequest:
    """Заявка админу: следующий Протокол или Курс. Оплату вносит админ в KPI."""
    kind = (program_kind or "protocol").strip()
    if kind not in ("protocol", "main_course"):
        raise HTTPException(status_code=400, detail="Можно отправить только Курс или Протокол")
    next_no = int(sequence_no) + 1
    if kind == "protocol" and (next_no < 2 or next_no > 21):
        raise HTTPException(status_code=400, detail="Неверный номер протокола")
    note = f"№{next_no}" if kind == "protocol" else None
    now = datetime.now(UTC)
    open_kinds = frozenset({"protocol", "main_course"})

    if lead_id is not None:
        lead = await db.get(Lead, int(lead_id))
        if lead is None or lead.company_id != company_id:
            raise HTTPException(status_code=404, detail="Пациент не найден")
        has_protocol = await db.scalar(
            select(PatientPurchase.id).where(
                PatientPurchase.company_id == company_id,
                PatientPurchase.lead_id == int(lead_id),
                PatientPurchase.product_kind == "protocol",
            ).limit(1),
        )
        if has_protocol is None:
            has_protocol = await db.scalar(
                select(SalesKpiManualSale.id)
                .join(SalesKpiPlanItem, SalesKpiPlanItem.id == SalesKpiManualSale.plan_item_id)
                .where(
                    SalesKpiManualSale.company_id == company_id,
                    SalesKpiManualSale.lead_id == int(lead_id),
                    SalesKpiPlanItem.name.ilike("%протокол%"),
                )
                .limit(1),
            )
        if has_protocol is None:
            raise HTTPException(status_code=400, detail="У пациента нет Протокола")
        booking = await load_booking_identity_by_lead(db, company_id=company_id, lead_ids=[int(lead_id)])
        name, phone = display_patient_identity(
            lead_name=lead.name,
            lead_phone=lead.phone,
            booking=booking.get(int(lead_id)),
        )
        manager_id = int(lead.manager_id) if lead.manager_id else None
        existing = next(
            (
                row
                for row in await _open_protocol_requests(db, company_id=company_id, kinds=open_kinds)
                if row.lead_id == int(lead_id)
            ),
            None,
        )
    elif sale_id is not None:
        sale = await db.get(SalesKpiManualSale, int(sale_id))
        if sale is None or sale.company_id != company_id:
            raise HTTPException(status_code=404, detail="Продажа не найдена")
        if sale.lead_id is not None:
            return await create_next_protocol_request(
                db,
                company_id=company_id,
                user=user,
                sequence_no=sequence_no,
                lead_id=int(sale.lead_id),
                program_kind=kind,
            )
        item_name = await db.scalar(
            select(SalesKpiPlanItem.name).where(SalesKpiPlanItem.id == sale.plan_item_id),
        )
        if classify_product_kind(item_name) != "protocol":
            raise HTTPException(status_code=400, detail="Это не продажа Протокола")
        name = (sale.client_name or "").strip() or "—"
        phone = (sale.client_phone or "").strip()
        manager_id = int(sale.manager_user_id) if sale.manager_user_id else None
        key = _person_key(name, phone)
        existing = next(
            (
                row
                for row in await _open_protocol_requests(db, company_id=company_id, kinds=open_kinds)
                if row.lead_id is None and _person_key(row.patient_name, row.patient_phone) == key
            ),
            None,
        )
        lead_id = None
    else:
        raise HTTPException(status_code=400, detail="Укажите пациента или продажу")

    if existing is not None:
        existing.program_kind = kind
        existing.note = note
        existing.patient_name = name
        existing.patient_phone = phone or ""
        existing.manager_user_id = manager_id
        existing.updated_at = now
        await db.commit()
        await db.refresh(existing)
        return existing

    req = CuratorProgramRequest(
        company_id=company_id,
        lead_id=int(lead_id) if lead_id is not None else None,
        program_kind=kind,
        status=OPEN_STATUS,
        note=note,
        patient_name=name,
        patient_phone=phone or "",
        manager_user_id=manager_id,
        requested_by_user_id=int(user.id),
        created_at=now,
        updated_at=now,
    )
    db.add(req)
    await db.commit()
    await db.refresh(req)
    return req


async def withdraw_next_protocol_request(
    db: AsyncSession,
    *,
    company_id: int,
    request_id: int,
) -> None:
    row = await db.get(CuratorProgramRequest, request_id)
    if (
        row is None
        or row.company_id != company_id
        or row.status != OPEN_STATUS
        or row.program_kind not in ("protocol", "main_course")
    ):
        raise HTTPException(status_code=404, detail="Заявки у админа нет")
    row.status = "withdrawn"
    row.updated_at = datetime.now(UTC)
    await db.commit()


async def accept_requests_for_sale(
    db: AsyncSession,
    *,
    company_id: int,
    lead_id: int | None,
    product_name: str | None,
    sale_id: int,
    client_name: str | None = None,
    client_phone: str | None = None,
) -> None:
    kind = classify_product_kind(product_name)
    if kind not in PROGRAM_KINDS:
        return
    rows: list[CuratorProgramRequest] = []
    if lead_id is not None:
        rows = list(
            (
                await db.execute(
                    select(CuratorProgramRequest).where(
                        CuratorProgramRequest.company_id == company_id,
                        CuratorProgramRequest.lead_id == int(lead_id),
                        CuratorProgramRequest.status == OPEN_STATUS,
                        CuratorProgramRequest.program_kind == kind,
                    ),
                )
            ).scalars().all()
        )
    if kind in ("protocol", "main_course") and (client_name or client_phone):
        key = _person_key(client_name, client_phone)
        seen = {int(row.id) for row in rows}
        for row in await _open_protocol_requests(db, company_id=company_id, kinds=frozenset({kind})):
            if int(row.id) in seen or row.lead_id is not None:
                continue
            if _person_key(row.patient_name, row.patient_phone) == key and key[0]:
                rows.append(row)
    now = datetime.now(UTC)
    for row in rows:
        row.status = "accepted"
        row.sale_id = int(sale_id)
        row.updated_at = now
