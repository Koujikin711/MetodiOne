from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import CurrentCompanyId, CurrentUser
from app.database import get_db
from app.models import Pipeline, PipelineStage, User, UserPipelineAssignment, UserRole
from app.schemas.stage import PipelineStageCreate, PipelineStageRead
from app.services.audit import write_audit_event
from app.services.stage_delete_checks import stage_delete_block_reason

router = APIRouter(prefix="/stages", tags=["stages"])


async def _manager_pipeline_ids(db: AsyncSession, user_id: int) -> set[int]:
    u = await db.get(User, user_id)
    if u is None or u.company_id is None:
        return set()
    rows = await db.execute(
        select(UserPipelineAssignment.pipeline_id).where(
            UserPipelineAssignment.user_id == user_id,
            UserPipelineAssignment.company_id == u.company_id,
        ),
    )
    return {int(r[0]) for r in rows.all()}


@router.get("", response_model=list[PipelineStageRead])
async def list_stages(
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentUser,
    company_id: CurrentCompanyId,
    pipeline_id: int | None = Query(default=None),
) -> list[PipelineStageRead]:
    q = select(PipelineStage).where(PipelineStage.company_id == company_id)
    if current_user.role == UserRole.manager:
        allowed = await _manager_pipeline_ids(db, current_user.id)
        if not allowed:
            return []
        if pipeline_id is not None:
            if pipeline_id not in allowed:
                raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Направление недоступна")
            q = q.where(PipelineStage.pipeline_id == pipeline_id)
        else:
            q = q.where(PipelineStage.pipeline_id.in_(allowed))
    else:
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
    company_id: CurrentCompanyId,
) -> PipelineStageRead:
    if current_user.role != UserRole.owner:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Admin only")
    pipeline = await db.get(Pipeline, body.pipeline_id)
    if pipeline is None or pipeline.company_id != company_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Pipeline not found")
    if body.order is None:
        mx = await db.scalar(
            select(PipelineStage.order)
            .where(PipelineStage.pipeline_id == body.pipeline_id, PipelineStage.company_id == company_id)
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
        company_id=company_id,
    )
    db.add(st)
    await db.flush()
    await write_audit_event(
        db,
        entity_type="stage",
        entity_id=st.id,
        action="stage_created",
        current_user=current_user,
        details=f"name={st.name}, pipeline_id={st.pipeline_id}",
    )
    await db.refresh(st)
    return PipelineStageRead.model_validate(st)


@router.delete("/{stage_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_stage(
    stage_id: int,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentUser,
    company_id: CurrentCompanyId,
) -> None:
    if current_user.role != UserRole.owner:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Только администратор")
    st = await db.get(PipelineStage, stage_id)
    if st is None or st.company_id != company_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Стадия не найдена")
    reason = await stage_delete_block_reason(db, stage_id)
    if reason:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=reason)
    pname = st.name
    pid = st.pipeline_id
    await db.delete(st)
    await db.flush()
    await write_audit_event(
        db,
        entity_type="stage",
        entity_id=stage_id,
        action="stage_deleted",
        current_user=current_user,
        details=f"name={pname}, pipeline_id={pid}",
    )
