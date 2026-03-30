from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import CurrentUser
from app.database import get_db
from app.models import Pipeline, PipelineStage, UserRole
from app.schemas.pipeline import PipelineCreate, PipelineRead

router = APIRouter(prefix="/pipelines", tags=["pipelines"])


@router.get("", response_model=list[PipelineRead])
async def list_pipelines(
    db: Annotated[AsyncSession, Depends(get_db)],
    _: CurrentUser,
) -> list[PipelineRead]:
    result = await db.execute(select(Pipeline).order_by(Pipeline.id))
    return [PipelineRead.model_validate(p) for p in result.scalars().all()]


@router.post("", response_model=PipelineRead, status_code=status.HTTP_201_CREATED)
async def create_pipeline(
    body: PipelineCreate,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentUser,
) -> PipelineRead:
    if current_user.role != UserRole.admin:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Admin only")

    exists = await db.scalar(select(Pipeline.id).where(Pipeline.name == body.name))
    if exists is not None:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Pipeline name already exists")

    pipe = Pipeline(name=body.name, type=body.type or "sales")
    db.add(pipe)
    await db.flush()

    for idx, st in enumerate(body.stages):
        db.add(
            PipelineStage(
                name=st.name,
                order=st.order if st.order is not None else idx,
                color=st.color,
                pipeline_id=pipe.id,
            )
        )

    await db.flush()
    await db.refresh(pipe)
    return PipelineRead.model_validate(pipe)

