"""Назначение ответственного менеджера для новых лидов по настройкам воронки."""

from __future__ import annotations

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Lead, Pipeline, PipelineStage, User, UserPipelineAssignment, UserRole


async def assign_manager_for_new_lead(
    db: AsyncSession,
    *,
    pipeline_id: int,
    exclude_user_id: int | None = None,
) -> int | None:
    pipe = await db.get(Pipeline, pipeline_id)
    if pipe is None:
        return None
    if pipe.company_id is None:
        return None
    company_id = int(pipe.company_id)
    mode = (pipe.lead_assignment_mode or "none").strip().lower()
    if mode not in ("round_robin", "least_loaded"):
        return None

    intake_id = int(pipe.intake_manager_user_id) if pipe.intake_manager_user_id is not None else None
    exclude_ids = {uid for uid in (exclude_user_id, intake_id) if uid is not None}

    res = await db.execute(
        select(UserPipelineAssignment.user_id)
        .join(User, User.id == UserPipelineAssignment.user_id)
        .where(
            UserPipelineAssignment.pipeline_id == pipeline_id,
            UserPipelineAssignment.company_id == company_id,
            User.role == UserRole.manager,
            User.is_active.is_(True),
            User.company_id == company_id,
        ),
    )
    user_ids = sorted({r[0] for r in res.all() if r[0] not in exclude_ids})
    if not user_ids:
        return None

    if mode == "round_robin":
        n = len(user_ids)
        idx = int(pipe.assignment_rr_counter or 0) % n
        mid = user_ids[idx]
        pipe.assignment_rr_counter = idx + 1
        await db.flush()
        return mid

    # least_loaded
    best_uid: int | None = None
    best_cnt = 10**9
    for uid in user_ids:
        cnt = await db.scalar(
            select(func.count(Lead.id))
            .join(PipelineStage, PipelineStage.id == Lead.status_id)
            .where(
                PipelineStage.pipeline_id == pipeline_id,
                PipelineStage.company_id == company_id,
                Lead.company_id == company_id,
                Lead.manager_id == uid,
            ),
        )
        c = int(cnt or 0)
        if c < best_cnt:
            best_cnt = c
            best_uid = uid
    return best_uid
