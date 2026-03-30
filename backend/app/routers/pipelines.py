from typing import Annotated

from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import CurrentUser
from app.database import get_db
from app.models import Pipeline
from app.schemas.pipeline import PipelineRead

router = APIRouter(prefix="/pipelines", tags=["pipelines"])


@router.get("", response_model=list[PipelineRead])
async def list_pipelines(
    db: Annotated[AsyncSession, Depends(get_db)],
    _: CurrentUser,
) -> list[PipelineRead]:
    result = await db.execute(select(Pipeline).order_by(Pipeline.id))
    return [PipelineRead.model_validate(p) for p in result.scalars().all()]

from typing import Annotated

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.core.deps import CurrentUser
from app.database import get_db
from app.models import Pipeline
from app.schemas.pipeline import PipelineRead

router = APIRouter(prefix="/pipelines", tags=["pipelines"])


@router.get("", response_model=list[PipelineRead])
async def list_pipelines(
    db: Annotated[AsyncSession, Depends(get_db)],
    _: CurrentUser,
) -> list[PipelineRead]:
    result = await db.execute(select(Pipeline).order_by(Pipeline.id))
    return [PipelineRead.model_validate(p) for p in result.scalars().all()]

