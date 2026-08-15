from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import CurrentCompanyId, CurrentUser
from app.database import get_db
from app.models import Pipeline, PipelineStage, User, UserPipelineAssignment, UserRole
from app.schemas.stage import (
    PipelineStageCreate,
    PipelineStageRead,
    PipelineStagesReorder,
    PipelineStageUpdate,
)
from app.services.audit import write_audit_event
from app.services.chief_expert_access import assert_owner_admin_or_chief_expert
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
                raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Воронка недоступна")
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
    await assert_owner_admin_or_chief_expert(db, current_user, detail="Недостаточно прав для создания стадий")
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
        on_enter_create_task=body.on_enter_create_task,
        on_enter_task_title=(body.on_enter_task_title or "").strip() or None,
        on_enter_task_description=(body.on_enter_task_description or "").strip() or None,
        on_enter_task_deadline_hours=body.on_enter_task_deadline_hours,
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


@router.patch("/{stage_id}", response_model=PipelineStageRead)
async def update_stage(
    stage_id: int,
    body: PipelineStageUpdate,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentUser,
    company_id: CurrentCompanyId,
) -> PipelineStageRead:
    await assert_owner_admin_or_chief_expert(db, current_user, detail="Недостаточно прав для изменения стадий")
    st = await db.get(PipelineStage, stage_id)
    if st is None or st.company_id != company_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Стадия не найдена")

    data = body.model_dump(exclude_unset=True)
    if "name" in data and data["name"] is not None:
        st.name = str(data["name"]).strip()
    if "order" in data and data["order"] is not None:
        st.order = int(data["order"])
    if "color" in data and data["color"] is not None:
        st.color = str(data["color"]).strip() or st.color
    if "on_enter_create_task" in data:
        st.on_enter_create_task = data["on_enter_create_task"]
    if "on_enter_task_title" in data:
        title = data["on_enter_task_title"]
        st.on_enter_task_title = (str(title).strip() if title is not None else None) or None
    if "on_enter_task_description" in data:
        desc = data["on_enter_task_description"]
        st.on_enter_task_description = (str(desc).strip() if desc is not None else None) or None
    if "on_enter_task_deadline_hours" in data:
        st.on_enter_task_deadline_hours = data["on_enter_task_deadline_hours"]

    await db.flush()
    await write_audit_event(
        db,
        entity_type="stage",
        entity_id=st.id,
        action="stage_updated",
        current_user=current_user,
        details=f"name={st.name}, order={st.order}, on_enter_create_task={st.on_enter_create_task}",
    )
    await db.refresh(st)
    return PipelineStageRead.model_validate(st)


@router.post("/reorder", response_model=list[PipelineStageRead])
async def reorder_stages(
    body: PipelineStagesReorder,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentUser,
    company_id: CurrentCompanyId,
) -> list[PipelineStageRead]:
    await assert_owner_admin_or_chief_expert(db, current_user, detail="Недостаточно прав для изменения стадий")
    pipeline = await db.get(Pipeline, body.pipeline_id)
    if pipeline is None or pipeline.company_id != company_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Pipeline not found")

    result = await db.execute(
        select(PipelineStage).where(
            PipelineStage.company_id == company_id,
            PipelineStage.pipeline_id == body.pipeline_id,
        ),
    )
    stages = list(result.scalars().all())
    by_id = {s.id: s for s in stages}
    if set(body.stage_ids) != set(by_id.keys()):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Список стадий должен совпадать со всеми стадиями воронки",
        )
    for idx, sid in enumerate(body.stage_ids):
        by_id[sid].order = idx
    await db.flush()
    await write_audit_event(
        db,
        entity_type="pipeline",
        entity_id=body.pipeline_id,
        action="stages_reordered",
        current_user=current_user,
        details=f"stage_ids={body.stage_ids}",
    )
    ordered = sorted(stages, key=lambda s: (s.order, s.id))
    return [PipelineStageRead.model_validate(s) for s in ordered]


@router.delete("/{stage_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_stage(
    stage_id: int,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentUser,
    company_id: CurrentCompanyId,
) -> None:
    await assert_owner_admin_or_chief_expert(db, current_user, detail="Недостаточно прав для удаления стадий")
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
