from typing import Annotated

from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import CurrentUser
from app.database import get_db
from app.models import PipelineStage
from app.schemas.stage import PipelineStageRead

router = APIRouter(prefix="/stages", tags=["stages"])


@router.get("", response_model=list[PipelineStageRead])
async def list_stages(
    db: Annotated[AsyncSession, Depends(get_db)],
    _: CurrentUser,
) -> list[PipelineStageRead]:
    result = await db.execute(select(PipelineStage).order_by(PipelineStage.order, PipelineStage.id))
    stages = result.scalars().all()
    return [PipelineStageRead.model_validate(s) for s in stages]
