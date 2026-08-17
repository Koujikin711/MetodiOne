"""API для callback «В ожидании»."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import CurrentCompanyId, CurrentUser
from app.core.rbac import is_manager_like
from app.database import get_db
from app.models import Lead, LeadWaitingCallback, UserRole
from app.schemas.waiting_callback import WaitingCallbackCreate, WaitingCallbackRead
from app.services.audit import write_audit_event
from app.services.lead_sales_stages import stage_id_by_name_in_pipeline

router = APIRouter(prefix="/waiting-callbacks", tags=["waiting-callbacks"])


def _to_read(row: LeadWaitingCallback) -> WaitingCallbackRead:
    return WaitingCallbackRead(
        id=row.id,
        lead_id=row.lead_id,
        manager_id=row.manager_id,
        client_name=row.client_name,
        client_phone=row.client_phone or "",
        pain_text=row.pain_text or "",
        scheduled_at=row.scheduled_at,
        status=row.status,
        client_reminder_sent_at=row.client_reminder_sent_at,
        manager_notified_at=row.manager_notified_at,
        created_at=row.created_at,
    )


@router.post("", response_model=WaitingCallbackRead, status_code=status.HTTP_201_CREATED)
async def create_waiting_callback(
    body: WaitingCallbackCreate,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentUser,
    company_id: CurrentCompanyId,
) -> WaitingCallbackRead:
    if current_user.role not in (
        UserRole.owner,
        UserRole.admin,
        UserRole.manager,
        UserRole.super_owner,
    ):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Недостаточно прав")

    lead = await db.get(Lead, body.lead_id)
    if lead is None or lead.company_id != company_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Лид не найден")

    scheduled = body.scheduled_at
    if scheduled.tzinfo is None:
        scheduled = scheduled.replace(tzinfo=UTC)
    if scheduled < datetime.now(UTC) - timedelta(minutes=2):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Дата/время уже в прошлом")

    pain = (body.pain_text or "").strip()
    if not pain:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Заполните «Боль» клиента")

    name = body.client_name.strip()
    if not name:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Укажите ФИО клиента")

    await db.refresh(lead, ["stage"])
    pipeline_id = lead.stage.pipeline_id if lead.stage else None

    if body.set_waiting_stage and pipeline_id is not None:
        waiting_id = await stage_id_by_name_in_pipeline(
            db, pipeline_id=int(pipeline_id), name="В ожидании",
        )
        if waiting_id is not None and lead.status_id != waiting_id:
            lead.status_id = int(waiting_id)

    lead.name = name

    manager_id = lead.manager_id
    if is_manager_like(current_user.role):
        manager_id = current_user.id
        lead.manager_id = current_user.id
    elif manager_id is None:
        manager_id = current_user.id
        lead.manager_id = current_user.id

    # Отменяем предыдущие открытые callback по этому лиду
    prev = (
        await db.execute(
            select(LeadWaitingCallback).where(
                LeadWaitingCallback.company_id == company_id,
                LeadWaitingCallback.lead_id == lead.id,
                LeadWaitingCallback.status == "scheduled",
            ),
        )
    ).scalars().all()
    for p in prev:
        p.status = "cancelled"

    row = LeadWaitingCallback(
        company_id=company_id,
        lead_id=lead.id,
        manager_id=manager_id,
        created_by_user_id=current_user.id,
        client_name=name,
        client_phone=(body.client_phone or lead.phone or "").strip(),
        pain_text=pain,
        scheduled_at=scheduled,
        status="scheduled",
    )
    db.add(row)
    await db.flush()
    await write_audit_event(
        db,
        entity_type="waiting_callback",
        entity_id=row.id,
        action="waiting_callback_created",
        current_user=current_user,
        details=f"lead_id={lead.id}, scheduled_at={scheduled.isoformat()}, pain_len={len(row.pain_text)}",
    )
    await db.commit()
    await db.refresh(row)
    return _to_read(row)


@router.get("", response_model=list[WaitingCallbackRead])
async def list_waiting_callbacks(
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentUser,
    company_id: CurrentCompanyId,
    lead_id: int | None = Query(None, ge=1),
    status_filter: str | None = Query(None, alias="status"),
) -> list[WaitingCallbackRead]:
    _ = current_user
    q = select(LeadWaitingCallback).where(LeadWaitingCallback.company_id == company_id)
    if lead_id is not None:
        q = q.where(LeadWaitingCallback.lead_id == lead_id)
    if status_filter:
        q = q.where(LeadWaitingCallback.status == status_filter.strip())
    q = q.order_by(LeadWaitingCallback.scheduled_at.desc()).limit(200)
    rows = (await db.execute(q)).scalars().all()
    return [_to_read(r) for r in rows]
