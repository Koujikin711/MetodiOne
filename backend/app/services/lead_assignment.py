"""Назначение ответственного менеджера для новых лидов по настройкам воронки."""

from __future__ import annotations

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.rbac import is_lead_assignee_role
from app.models import Lead, Pipeline, PipelineStage, User, UserPipelineAssignment, UserRole


async def list_pipeline_manager_ids(
    db: AsyncSession,
    *,
    pipeline_id: int,
    company_id: int,
    exclude_user_id: int | None = None,
) -> list[int]:
    """Активные менеджеры воронки (только role=manager)."""
    exclude_ids = {int(exclude_user_id)} if exclude_user_id is not None else set()
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
    return sorted({int(r[0]) for r in res.all() if int(r[0]) not in exclude_ids})


async def list_company_manager_ids(
    db: AsyncSession,
    *,
    company_id: int,
    exclude_user_id: int | None = None,
) -> list[int]:
    """Все активные менеджеры компании (fallback, если у воронки никого нет)."""
    exclude_ids = {int(exclude_user_id)} if exclude_user_id is not None else set()
    res = await db.execute(
        select(User.id).where(
            User.company_id == company_id,
            User.role == UserRole.manager,
            User.is_active.is_(True),
        ),
    )
    return sorted({int(r[0]) for r in res.all() if int(r[0]) not in exclude_ids})


async def assign_manager_for_new_lead(
    db: AsyncSession,
    *,
    pipeline_id: int,
    exclude_user_id: int | None = None,
    force: bool = False,
) -> int | None:
    """
    Назначить менеджера на новый лид.
    По умолчанию только если lead_assignment_mode = round_robin | least_loaded.
    force=True — раздать менеджерам воронки (или компании) даже при mode=none
    (для разового снятия лидов с owner/admin).
    """
    pipe = await db.get(Pipeline, pipeline_id)
    if pipe is None:
        return None
    if pipe.company_id is None:
        return None
    company_id = int(pipe.company_id)
    mode = (pipe.lead_assignment_mode or "none").strip().lower()
    if not force and mode not in ("round_robin", "least_loaded"):
        return None

    intake_id = int(pipe.intake_manager_user_id) if pipe.intake_manager_user_id is not None else None
    exclude_id = exclude_user_id if exclude_user_id is not None else intake_id
    # При force не исключаем intake — нужно раздать всех «чужих» лидов.
    if force:
        exclude_id = exclude_user_id

    user_ids = await list_pipeline_manager_ids(
        db,
        pipeline_id=pipeline_id,
        company_id=company_id,
        exclude_user_id=exclude_id,
    )
    if not user_ids and force:
        user_ids = await list_company_manager_ids(
            db,
            company_id=company_id,
            exclude_user_id=exclude_id,
        )
    if not user_ids:
        return None

    effective_mode = mode if mode in ("round_robin", "least_loaded") else "round_robin"

    if effective_mode == "round_robin":
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


def assert_user_can_be_lead_assignee(user: User) -> None:
    """Бросает ValueError, если пользователя нельзя ставить ответственным."""
    if not is_lead_assignee_role(user.role):
        raise ValueError("Ответственным за лид может быть только менеджер (не владелец и не админ воронки)")
