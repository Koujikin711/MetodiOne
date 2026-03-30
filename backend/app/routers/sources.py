from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import CurrentUser
from app.database import get_db
from app.models import LeadSource, UserRole
from app.schemas.sources import LeadSourceCreate, LeadSourceRead, LeadSourceUpdate

router = APIRouter(prefix="/sources", tags=["sources"])


@router.get("", response_model=list[LeadSourceRead])
async def list_sources(
    db: Annotated[AsyncSession, Depends(get_db)],
    _: CurrentUser,
) -> list[LeadSourceRead]:
    r = await db.execute(select(LeadSource).order_by(LeadSource.is_active.desc(), LeadSource.name))
    return [LeadSourceRead.model_validate(x) for x in r.scalars().all()]


@router.post("", response_model=LeadSourceRead, status_code=status.HTTP_201_CREATED)
async def create_source(
    body: LeadSourceCreate,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentUser,
) -> LeadSourceRead:
    if current_user.role != UserRole.admin:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Admin only")

    exists = await db.scalar(select(LeadSource.id).where(LeadSource.name == body.name.strip()))
    if exists is not None:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Source name already exists")

    s = LeadSource(name=body.name.strip(), is_active=body.is_active)
    db.add(s)
    await db.flush()
    await db.refresh(s)
    return LeadSourceRead.model_validate(s)


@router.patch("/{source_id}", response_model=LeadSourceRead)
async def patch_source(
    source_id: int,
    body: LeadSourceUpdate,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentUser,
) -> LeadSourceRead:
    if current_user.role != UserRole.admin:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Admin only")

    s = await db.get(LeadSource, source_id)
    if s is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Source not found")

    if body.name is not None:
        s.name = body.name.strip()
    if body.is_active is not None:
        s.is_active = body.is_active
    await db.flush()
    await db.refresh(s)
    return LeadSourceRead.model_validate(s)


@router.delete("/{source_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_source(
    source_id: int,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentUser,
):
    if current_user.role != UserRole.admin:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Admin only")

    s = await db.get(LeadSource, source_id)
    if s is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Source not found")

    # soft-delete
    s.is_active = False
    await db.flush()
    return

