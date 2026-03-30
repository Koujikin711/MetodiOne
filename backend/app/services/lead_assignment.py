"""Назначение ответственного менеджера для новых лидов по настройкам воронки."""

from __future__ import annotations

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Lead, Pipeline, PipelineStage, UserPipelineAssignment


async def assign_manager_for_new_lead(db: AsyncSession, *, pipeline_id: int) -> int | None:
    pipe = await db.get(Pipeline, pipeline_id)
    if pipe is None:
        return None
    mode = (pipe.lead_assignment_mode or "none").strip().lower()
    if mode not in ("round_robin", "least_loaded"):
        return None

    res = await db.execute(
        select(UserPipelineAssignment.user_id).where(UserPipelineAssignment.pipeline_id == pipeline_id),
    )
    user_ids = sorted({r[0] for r in res.all()})
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
                Lead.manager_id == uid,
            ),
        )
        c = int(cnt or 0)
        if c < best_cnt:
            best_cnt = c
            best_uid = uid
    return best_uid
