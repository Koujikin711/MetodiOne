from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import CurrentUser
from app.database import get_db
from app.models import Pipeline, PipelineStage, UserRole
from app.schemas.stage import PipelineStageCreate, PipelineStageRead

router = APIRouter(prefix="/stages", tags=["stages"])


@router.get("", response_model=list[PipelineStageRead])
async def list_stages(
    db: Annotated[AsyncSession, Depends(get_db)],
    _: CurrentUser,
    pipeline_id: int | None = Query(default=None),
) -> list[PipelineStageRead]:
    q = select(PipelineStage)
    if pipeline_id is not None:
        q = q.where(PipelineStage.pipeline_id == pipeline_id)
    result = await db.execute(q.order_by(PipelineStage.order, PipelineStage.id))
    stages = result.scalars().all()
    return [PipelineStageRead.model_validate(s) for s in stages]


@router.post("", response_model=PipelineStageRead, status_code=status.HTTP_201_CREATED)
async def create_stage(
    body: PipelineStageCreate,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentUser,
) -> PipelineStageRead:
    if current_user.role != UserRole.admin:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Admin only")
    pipeline = await db.get(Pipeline, body.pipeline_id)
    if pipeline is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Pipeline not found")
    if body.order is None:
        mx = await db.scalar(
            select(PipelineStage.order)
            .where(PipelineStage.pipeline_id == body.pipeline_id)
            .order_by(PipelineStage.order.desc())
            .limit(1),
        )
        next_order = int(mx or -1) + 1
    else:
        next_order = body.order
    st = PipelineStage(
        name=body.name.strip(),
        order=next_order,
        color=body.color,
        pipeline_id=body.pipeline_id,
    )
    db.add(st)
    await db.flush()
    await db.refresh(st)
    return PipelineStageRead.model_validate(st)
