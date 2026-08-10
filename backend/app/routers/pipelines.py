from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Response, status
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import CurrentCompanyId, CurrentUser
from app.database import get_db
from app.models import Lead, Pipeline, PipelineStage, User, UserPipelineAssignment, UserRole
from app.schemas.pipeline import PipelineCreate, PipelinePatch, PipelineRead
from app.services.audit import write_audit_event
from app.services.close_pipeline import (
    attachment_content_disposition,
    build_pipeline_leads_csv,
    close_pipeline,
    preview_close_pipeline,
    safe_filename_part,
)
from app.services.default_pipeline_stages import default_pipeline_stage_creates
from app.services.lead_assignment import assign_manager_for_new_lead
from app.services.phone_match import parse_allowed_phones_json, serialize_allowed_phones
from app.services.stage_delete_checks import pipeline_delete_block_reason
from app.services.chief_expert_access import is_chief_expert, is_pipeline_admin_role

router = APIRouter(prefix="/pipelines", tags=["pipelines"])


def _pipeline_to_read(pipe: Pipeline) -> PipelineRead:
    return PipelineRead(
        id=pipe.id,
        name=pipe.name,
        type=pipe.type,
        lead_assignment_mode=pipe.lead_assignment_mode or "none",
        expert_user_id=pipe.expert_user_id,
        intake_manager_user_id=pipe.intake_manager_user_id,
        manager_allowed_outbound_phones=parse_allowed_phones_json(pipe.manager_allowed_outbound_phones),
    )

_MAX_DISTRIBUTE_BATCH = 2000


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


async def _is_pipeline_admin_user(db: AsyncSession, user: User) -> bool:
    if is_pipeline_admin_role(user.role):
        return True
    return await is_chief_expert(db, user)


class DistributeLeadsBody(BaseModel):
    stage_id: int = Field(..., ge=1)
    force_reassign: bool = False


class ClosePipelineBody(BaseModel):
    """Подтверждение: точное имя воронки (как в списке)."""

    confirm_name: str = Field(..., min_length=1, max_length=255)


class ClosePipelinePreviewRead(BaseModel):
    pipeline_id: int
    pipeline_name: str
    leads_count: int
    stages_count: int
    integrations_count: int
    employees_to_terminate: list[dict]
    employees_to_unassign: list[dict]


@router.get("", response_model=list[PipelineRead])
async def list_pipelines(
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentUser,
    company_id: CurrentCompanyId,
) -> list[PipelineRead]:
    q = select(Pipeline).where(Pipeline.company_id == company_id)
    if current_user.role == UserRole.manager:
        allowed = await _manager_pipeline_ids(db, current_user.id)
        if not allowed:
            return []
        q = q.where(Pipeline.id.in_(allowed))
    elif current_user.role == UserRole.expert:
        allowed = await _manager_pipeline_ids(db, current_user.id)
        expert_pipes = (
            await db.execute(
                select(Pipeline.id).where(
                    Pipeline.company_id == company_id,
                    Pipeline.expert_user_id == current_user.id,
                ),
            )
        ).scalars().all()
        allowed |= {int(x) for x in expert_pipes}
        if not allowed:
            return []
        q = q.where(Pipeline.id.in_(allowed))
    result = await db.execute(q.order_by(Pipeline.id))
    return [_pipeline_to_read(p) for p in result.scalars().all()]


@router.post("", response_model=PipelineRead, status_code=status.HTTP_201_CREATED)
async def create_pipeline(
    body: PipelineCreate,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentUser,
    company_id: CurrentCompanyId,
) -> PipelineRead:
    if not await _is_pipeline_admin_user(db, current_user):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Admin only")

    exists = await db.scalar(select(Pipeline.id).where(Pipeline.company_id == company_id, Pipeline.name == body.name))
    if exists is not None:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Pipeline name already exists")

    expert_user_id = body.expert_user_id
    if expert_user_id is not None:
        u = await db.get(User, expert_user_id)
        if u is None or not u.is_active or u.role != UserRole.expert or u.company_id != company_id:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="expert_user_id: unknown expert")

    intake_manager_user_id = body.intake_manager_user_id
    if intake_manager_user_id is not None:
        u = await db.get(User, intake_manager_user_id)
        if u is None or not u.is_active or u.role != UserRole.manager or u.company_id != company_id:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="intake_manager_user_id: unknown manager")
        assigned = await db.scalar(
            select(func.count(UserPipelineAssignment.id)).where(
                UserPipelineAssignment.user_id == intake_manager_user_id,
                UserPipelineAssignment.company_id == company_id,
            )
        )
        if int(assigned or 0) <= 0:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="intake_manager_user_id: manager must be assigned to at least one pipeline",
            )

    pipe = Pipeline(
        name=body.name,
        type=body.type or "sales",
        expert_user_id=expert_user_id,
        intake_manager_user_id=intake_manager_user_id,
        company_id=company_id,
    )
    db.add(pipe)
    await db.flush()

    stages_to_add = list(body.stages) if body.stages else default_pipeline_stage_creates()
    for idx, st in enumerate(stages_to_add):
        db.add(
            PipelineStage(
                name=st.name,
                order=st.order if st.order is not None else idx,
                color=st.color,
                pipeline_id=pipe.id,
                company_id=company_id,
            )
        )

    await db.flush()
    if intake_manager_user_id is not None:
        exists_link = await db.scalar(
            select(func.count(UserPipelineAssignment.id)).where(
                UserPipelineAssignment.user_id == intake_manager_user_id,
                UserPipelineAssignment.pipeline_id == pipe.id,
                UserPipelineAssignment.company_id == company_id,
            )
        )
        if int(exists_link or 0) <= 0:
            db.add(
                UserPipelineAssignment(
                    user_id=intake_manager_user_id,
                    pipeline_id=pipe.id,
                    company_id=company_id,
                )
            )
            await db.flush()
    await write_audit_event(
        db,
        entity_type="pipeline",
        entity_id=pipe.id,
        action="pipeline_created",
        current_user=current_user,
        details=f"name={pipe.name}, stages={len(stages_to_add)}, auto_default={not bool(body.stages)}",
    )
    await db.refresh(pipe)
    return _pipeline_to_read(pipe)


@router.patch("/{pipeline_id}", response_model=PipelineRead)
async def patch_pipeline(
    pipeline_id: int,
    body: PipelinePatch,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentUser,
    company_id: CurrentCompanyId,
) -> PipelineRead:
    if not await _is_pipeline_admin_user(db, current_user):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Admin only")
    pipe = await db.get(Pipeline, pipeline_id)
    if pipe is None or pipe.company_id != company_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Pipeline not found")
    if body.expert_user_id is not None:
        u = await db.get(User, body.expert_user_id)
        if u is None or not u.is_active or u.role != UserRole.expert or u.company_id != company_id:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="expert_user_id: unknown expert")
        pipe.expert_user_id = body.expert_user_id
    elif body.expert_user_id is None and "expert_user_id" in body.model_fields_set:
        pipe.expert_user_id = None
    if body.intake_manager_user_id is not None:
        u = await db.get(User, body.intake_manager_user_id)
        if u is None or not u.is_active or u.role != UserRole.manager or u.company_id != company_id:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="intake_manager_user_id: unknown manager")
        assigned = await db.scalar(
            select(func.count(UserPipelineAssignment.id)).where(
                UserPipelineAssignment.user_id == body.intake_manager_user_id,
                UserPipelineAssignment.company_id == company_id,
            )
        )
        if int(assigned or 0) <= 0:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="intake_manager_user_id: manager must be assigned to at least one pipeline",
            )
        pipe.intake_manager_user_id = body.intake_manager_user_id
        exists_link = await db.scalar(
            select(func.count(UserPipelineAssignment.id)).where(
                UserPipelineAssignment.user_id == body.intake_manager_user_id,
                UserPipelineAssignment.pipeline_id == pipeline_id,
                UserPipelineAssignment.company_id == company_id,
            )
        )
        if int(exists_link or 0) <= 0:
            db.add(
                UserPipelineAssignment(
                    user_id=body.intake_manager_user_id,
                    pipeline_id=pipeline_id,
                    company_id=company_id,
                )
            )
    elif body.intake_manager_user_id is None and "intake_manager_user_id" in body.model_fields_set:
        pipe.intake_manager_user_id = None
    if body.lead_assignment_mode is not None:
        mode = body.lead_assignment_mode.strip().lower()
        if mode not in ("none", "round_robin", "least_loaded"):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="lead_assignment_mode must be none, round_robin or least_loaded",
            )
        pipe.lead_assignment_mode = mode
    if body.manager_allowed_outbound_phones is not None:
        pipe.manager_allowed_outbound_phones = serialize_allowed_phones(body.manager_allowed_outbound_phones)
    await db.flush()
    await write_audit_event(
        db,
        entity_type="pipeline",
        entity_id=pipe.id,
        action="pipeline_updated",
        current_user=current_user,
        details=(
            f"lead_assignment_mode={pipe.lead_assignment_mode}, expert_user_id={pipe.expert_user_id}, "
            f"intake_manager_user_id={pipe.intake_manager_user_id}, "
            f"manager_allowed_outbound_phones={pipe.manager_allowed_outbound_phones}"
        ),
    )
    await db.refresh(pipe)
    return _pipeline_to_read(pipe)


@router.delete("/{pipeline_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_pipeline(
    pipeline_id: int,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentUser,
    company_id: CurrentCompanyId,
) -> None:
    if not await _is_pipeline_admin_user(db, current_user):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Только администратор")
    pipe = await db.get(Pipeline, pipeline_id)
    if pipe is None or pipe.company_id != company_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Воронка не найдена")
    total_pipes = await db.scalar(select(func.count()).select_from(Pipeline).where(Pipeline.company_id == company_id))
    if total_pipes is not None and int(total_pipes) <= 1:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Нельзя удалить последнюю воронку. Создайте другую, затем удалите эту.",
        )
    reason = await pipeline_delete_block_reason(db, pipeline_id)
    if reason:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=(
                f"{reason} "
                "Чтобы закрыть воронку вместе с лидами и скачать контакты — используйте «Закрыть воронку»."
            ),
        )
    pname = pipe.name
    rows = await db.execute(select(PipelineStage).where(PipelineStage.pipeline_id == pipeline_id, PipelineStage.company_id == company_id))
    stages = rows.scalars().all()
    for st in stages:
        await db.delete(st)
    await db.delete(pipe)
    await db.flush()
    await write_audit_event(
        db,
        entity_type="pipeline",
        entity_id=pipeline_id,
        action="pipeline_deleted",
        current_user=current_user,
        details=f"name={pname}, stages_removed={len(stages)}",
    )


@router.get("/{pipeline_id}/export-leads")
async def export_pipeline_leads(
    pipeline_id: int,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentUser,
    company_id: CurrentCompanyId,
) -> Response:
    """Скачать CSV всех лидов воронки без удаления."""
    if not await _is_pipeline_admin_user(db, current_user):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Только администратор")
    pipe = await db.get(Pipeline, pipeline_id)
    if pipe is None or pipe.company_id != company_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Воронка не найдена")
    csv_text, count = await build_pipeline_leads_csv(
        db, company_id=company_id, pipeline_id=pipeline_id,
    )
    filename = f"voronka_{pipeline_id}_{safe_filename_part(pipe.name)}_leads.csv"
    await write_audit_event(
        db,
        entity_type="pipeline",
        entity_id=pipeline_id,
        action="pipeline_leads_exported",
        current_user=current_user,
        details=f"name={pipe.name}, leads={count}",
    )
    return Response(
        content=csv_text.encode("utf-8"),
        media_type="text/csv; charset=utf-8",
        headers={
            "Content-Disposition": attachment_content_disposition(filename),
        },
    )


@router.get("/{pipeline_id}/close-preview", response_model=ClosePipelinePreviewRead)
async def close_pipeline_preview(
    pipeline_id: int,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentUser,
    company_id: CurrentCompanyId,
) -> ClosePipelinePreviewRead:
    if not await _is_pipeline_admin_user(db, current_user):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Только администратор")
    try:
        preview = await preview_close_pipeline(db, company_id=company_id, pipeline_id=pipeline_id)
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(e)) from e
    return ClosePipelinePreviewRead(
        pipeline_id=preview.pipeline_id,
        pipeline_name=preview.pipeline_name,
        leads_count=preview.leads_count,
        stages_count=preview.stages_count,
        integrations_count=preview.integrations_count,
        employees_to_terminate=preview.employees_to_terminate,
        employees_to_unassign=preview.employees_to_unassign,
    )


@router.post("/{pipeline_id}/close")
async def close_pipeline_endpoint(
    pipeline_id: int,
    body: ClosePipelineBody,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentUser,
    company_id: CurrentCompanyId,
) -> Response:
    """Закрыть воронку: отдать CSV контактов, удалить связанные данные, уволить сотрудников только этой воронки."""
    if not await _is_pipeline_admin_user(db, current_user):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Только администратор")
    pipe = await db.get(Pipeline, pipeline_id)
    if pipe is None or pipe.company_id != company_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Воронка не найдена")
    if body.confirm_name.strip() != (pipe.name or "").strip():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Для подтверждения введите точное название воронки",
        )
    try:
        csv_text, filename, preview = await close_pipeline(
            db, company_id=company_id, pipeline_id=pipeline_id,
        )
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e)) from e

    await write_audit_event(
        db,
        entity_type="pipeline",
        entity_id=pipeline_id,
        action="pipeline_closed",
        current_user=current_user,
        details=(
            f"name={preview.pipeline_name}, leads={preview.leads_count}, "
            f"terminated={len(preview.employees_to_terminate)}, "
            f"unassigned={len(preview.employees_to_unassign)}"
        ),
    )
    return Response(
        content=csv_text.encode("utf-8"),
        media_type="text/csv; charset=utf-8",
        headers={
            "Content-Disposition": attachment_content_disposition(filename),
            "X-Pipeline-Closed": "1",
            "X-Leads-Exported": str(preview.leads_count),
            "X-Employees-Terminated": str(len(preview.employees_to_terminate)),
        },
    )


@router.post("/{pipeline_id}/distribute-leads")
async def distribute_leads_from_stage(
    pipeline_id: int,
    body: DistributeLeadsBody,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentUser,
    company_id: CurrentCompanyId,
) -> dict[str, int]:
    """
    Массово назначить менеджеров лидам на выбранной стадии.
    Работает для owner/admin; назначение идёт только на пользователей роли manager.
    """
    if not await _is_pipeline_admin_user(db, current_user):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Только администратор")

    pipe = await db.get(Pipeline, pipeline_id)
    if pipe is None or pipe.company_id != company_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Pipeline not found")

    st = await db.get(PipelineStage, body.stage_id)
    if st is None or st.pipeline_id != pipeline_id or st.company_id != company_id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="stage_id is not in this pipeline")

    # Если в воронке не настроено автораспределение — это всё равно “распределить” не сможет.
    any_manager = await db.scalar(
        select(func.count(UserPipelineAssignment.id))
        .join(User, User.id == UserPipelineAssignment.user_id)
        .where(
            UserPipelineAssignment.pipeline_id == pipeline_id,
            UserPipelineAssignment.company_id == company_id,
            User.role == UserRole.manager,
            User.is_active.is_(True),
            User.company_id == company_id,
        )
    )
    if int(any_manager or 0) <= 0:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="В этой воронке нет активных менеджеров для распределения (назначьте менеджеров в Сотрудниках).",
        )

    total = int(
        await db.scalar(
            select(func.count(Lead.id)).where(Lead.status_id == body.stage_id, Lead.company_id == company_id),
        )
        or 0
    )
    if total <= 0:
        return {"total": 0, "assigned": 0, "skipped": 0}

    assigned = 0
    skipped = 0
    offset = 0
    # Идём батчами, чтобы не держать очень большой список в памяти.
    while True:
        ids = (
            await db.execute(
                select(Lead.id)
                .where(Lead.status_id == body.stage_id)
                .where(Lead.company_id == company_id)
                .order_by(Lead.id.asc())
                .offset(offset)
                .limit(_MAX_DISTRIBUTE_BATCH),
            )
        ).scalars().all()
        if not ids:
            break
        offset += len(ids)

        for lead_id in ids:
            lead = await db.get(Lead, int(lead_id))
            if lead is None:
                skipped += 1
                continue
            # уже назначен менеджеру — не трогаем, если не принудительный режим.
            # Лиды на owner/admin всегда переназначаем (даже без force).
            if not body.force_reassign and lead.manager_id is not None:
                cur = await db.get(User, int(lead.manager_id))
                if cur is not None and cur.role == UserRole.manager:
                    skipped += 1
                    continue
            mid = await assign_manager_for_new_lead(
                db,
                pipeline_id=pipeline_id,
                exclude_user_id=pipe.intake_manager_user_id,
                force=True,
            )
            if mid is None:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="В этой воронке нет активных менеджеров для распределения.",
                )
            lead.manager_id = mid
            assigned += 1

        await db.flush()

    await write_audit_event(
        db,
        entity_type="pipeline",
        entity_id=pipeline_id,
        action="pipeline_leads_distributed",
        current_user=current_user,
        details=f"stage_id={body.stage_id}, total={total}, assigned={assigned}, skipped={skipped}",
    )
    return {"total": total, "assigned": assigned, "skipped": skipped}

