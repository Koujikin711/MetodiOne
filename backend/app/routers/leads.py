from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.deps import CurrentUser
from app.database import get_db
from app.models import Lead, PipelineStage
from app.schemas.lead import LeadCreate, LeadRead, LeadStatusPatchResponse, LeadStatusUpdate
from app.services.automation import process_lead_automation

router = APIRouter(prefix="/leads", tags=["leads"])


def _lead_to_read(lead: Lead) -> LeadRead:
    return LeadRead(
        id=lead.id,
        name=lead.name,
        phone=lead.phone,
        email=lead.email,
        source=lead.source,
        status_id=lead.status_id,
        stage_name=lead.stage.name if lead.stage else None,
        manager_id=lead.manager_id,
    )


@router.post("", response_model=LeadRead, status_code=status.HTTP_201_CREATED)
async def create_lead(
    body: LeadCreate,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentUser,
) -> LeadRead:
    stage = await db.get(PipelineStage, body.status_id)
    if stage is None:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Unknown status_id")
    lead = Lead(
        name=body.name,
        phone=body.phone,
        email=body.email,
        source=body.source,
        status_id=body.status_id,
        manager_id=current_user.id,
    )
    db.add(lead)
    await db.flush()
    await db.refresh(lead)
    await db.refresh(lead, ["stage"])
    return _lead_to_read(lead)


@router.get("", response_model=list[LeadRead])
async def list_leads(
    db: Annotated[AsyncSession, Depends(get_db)],
    _: CurrentUser,
) -> list[LeadRead]:
    result = await db.execute(select(Lead).options(selectinload(Lead.stage)).order_by(Lead.id.desc()))
    leads = result.scalars().unique().all()
    return [_lead_to_read(lead) for lead in leads]


@router.get("/{lead_id}", response_model=LeadRead)
async def get_lead(
    lead_id: int,
    db: Annotated[AsyncSession, Depends(get_db)],
    _: CurrentUser,
) -> LeadRead:
    lead = await db.get(Lead, lead_id)
    if lead is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Lead not found")
    await db.refresh(lead, ["stage"])
    return _lead_to_read(lead)


@router.patch("/{lead_id}/status", response_model=LeadStatusPatchResponse)
async def update_lead_status(
    lead_id: int,
    body: LeadStatusUpdate,
    db: Annotated[AsyncSession, Depends(get_db)],
    _: CurrentUser,
) -> LeadStatusPatchResponse:
    stage = await db.get(PipelineStage, body.status_id)
    if stage is None:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Unknown status_id")
    lead = await db.get(Lead, lead_id)
    if lead is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Lead not found")
    lead.status_id = body.status_id
    await db.flush()
    await db.refresh(lead, ["stage"])
    read = _lead_to_read(lead)
    automation_task_created = await process_lead_automation(db, lead_id, body.status_id)
    return LeadStatusPatchResponse(
        **read.model_dump(),
        automation_task_created=automation_task_created,
    )
