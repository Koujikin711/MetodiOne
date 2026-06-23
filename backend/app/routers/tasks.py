from datetime import UTC, datetime
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import delete, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import aliased

from app.core.deps import CurrentCompanyId, CurrentUser
from app.database import get_db
from app.models import Lead, Pipeline, Task, TaskStatus, User, UserRole
from app.schemas.task import TaskAssigneeRead, TaskCreate, TaskListResponse, TaskRead, TaskReviewUpdate, TaskUpdate
from app.services.chief_expert_access import is_chief_expert

router = APIRouter(prefix="/tasks", tags=["tasks"])


def _parse_deadline_param(value: str | None, *, name: str) -> datetime | None:
    if not value:
        return None
    raw = value.strip()
    if not raw:
        return None
    try:
        return datetime.fromisoformat(raw.replace("Z", "+00:00"))
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"Invalid {name}") from exc


async def _get_company_user(db: AsyncSession, user_id: int | None, company_id: int) -> User | None:
    if user_id is None:
        return None
    user = await db.get(User, user_id)
    if user is None or user.company_id != company_id or not user.is_active:
        return None
    return user


async def _can_expert_assign(current_user: User, db: AsyncSession, company_id: int) -> bool:
    if current_user.role != UserRole.expert:
        return False
    rid = await db.scalar(
        select(Pipeline.id).where(Pipeline.company_id == company_id, Pipeline.expert_user_id == current_user.id).limit(1)
    )
    return rid is not None


async def _ensure_related_lead_exists(db: AsyncSession, related_lead_id: int | None, company_id: int) -> None:
    if related_lead_id is None:
        return
    lead = await db.get(Lead, related_lead_id)
    if lead is None or lead.company_id != company_id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="related_lead_id not found")


def _ensure_assign_permission(
    *,
    current_user: User,
    assignee: User,
    expert_can_assign: bool,
) -> None:
    creator_role = current_user.role
    target_role = assignee.role

    if creator_role == UserRole.owner:
        return
    if creator_role == UserRole.admin:
        if target_role not in (UserRole.admin, UserRole.manager, UserRole.expert):
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Администратор может ставить задачи менеджерам/экспертам/админам")
        return
    if creator_role == UserRole.manager:
        if target_role != UserRole.admin:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Менеджер может ставить задачи только администратору")
        return
    if creator_role == UserRole.expert:
        if not expert_can_assign:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Эксперт не назначен в воронку и не может ставить задачи")
        if target_role not in (UserRole.owner, UserRole.admin, UserRole.manager):
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Эксперт может ставить задачи владельцу, администратору или менеджеру")
        return
    raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Недостаточно прав")


def _to_task_read(task: Task, assignee: User | None, creator: User | None) -> TaskRead:
    assignee_name = None
    if assignee is not None:
        assignee_name = (assignee.full_name or "").strip() or assignee.email
    creator_name = None
    if creator is not None:
        creator_name = (creator.full_name or "").strip() or creator.email
    return TaskRead(
        id=task.id,
        title=task.title,
        deadline=task.deadline,
        status=task.status,
        assigned_to=task.assigned_to,
        assigned_to_name=assignee_name,
        assigned_to_role=(assignee.role if assignee else None),
        created_by_user_id=task.created_by_user_id,
        created_by_name=creator_name,
        created_by_role=(creator.role if creator else None),
        description=task.description,
        related_lead_id=task.related_lead_id,
        review_score=getattr(task, "review_score", None),
        review_comment=getattr(task, "review_comment", None),
        review_by_user_id=getattr(task, "review_by_user_id", None),
        review_at=getattr(task, "review_at", None),
        is_locked=task.status in (TaskStatus.done, TaskStatus.cancelled),
    )


def _is_task_closed(task: Task) -> bool:
    return task.status in (TaskStatus.done, TaskStatus.cancelled)


@router.get("/assignees", response_model=list[TaskAssigneeRead])
async def list_task_assignees(
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentUser,
    company_id: CurrentCompanyId,
) -> list[TaskAssigneeRead]:
    expert_can_assign = await _can_expert_assign(current_user, db, company_id)
    q = select(User).where(User.company_id == company_id, User.is_active.is_(True)).order_by(User.id.asc())
    users = (await db.execute(q)).scalars().all()

    allowed: list[TaskAssigneeRead] = []
    for u in users:
        try:
            _ensure_assign_permission(current_user=current_user, assignee=u, expert_can_assign=expert_can_assign)
        except HTTPException:
            continue
        allowed.append(
            TaskAssigneeRead(
                id=u.id,
                full_name=(u.full_name or "").strip() or None,
                email=u.email,
                role=u.role,
            )
        )
    return allowed


@router.post("", response_model=TaskRead, status_code=status.HTTP_201_CREATED)
async def create_task(
    body: TaskCreate,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentUser,
    company_id: CurrentCompanyId,
) -> TaskRead:
    if body.assigned_to is None:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="assigned_to is required")
    assignee = await _get_company_user(db, body.assigned_to, company_id)
    if assignee is None:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="assigned_to user not found")
    expert_can_assign = await _can_expert_assign(current_user, db, company_id)
    _ensure_assign_permission(current_user=current_user, assignee=assignee, expert_can_assign=expert_can_assign)
    await _ensure_related_lead_exists(db, body.related_lead_id, company_id)
    task = Task(
        title=body.title,
        deadline=body.deadline,
        status=body.status,
        assigned_to=body.assigned_to,
        created_by_user_id=current_user.id,
        description=body.description,
        related_lead_id=body.related_lead_id,
        company_id=company_id,
    )
    db.add(task)
    await db.flush()
    await db.refresh(task)
    return _to_task_read(task, assignee=assignee, creator=current_user)


@router.get("", response_model=TaskListResponse)
async def list_tasks(
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentUser,
    company_id: CurrentCompanyId,
    scope: str = Query(default="my", pattern="^(my|team)$"),
    journal: bool = Query(default=False),
    status_filter: str | None = Query(default=None, alias="status"),
    deadline_from: str | None = Query(default=None),
    deadline_to: str | None = Query(default=None),
    q: str | None = Query(default=None, max_length=120),
    limit: int | None = Query(default=None, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
    include_total: bool = Query(default=True),
) -> TaskListResponse:
    assignee_u = aliased(User)
    creator_u = aliased(User)
    query = (
        select(Task, assignee_u, creator_u)
        .outerjoin(assignee_u, assignee_u.id == Task.assigned_to)
        .outerjoin(creator_u, creator_u.id == Task.created_by_user_id)
        .where(Task.company_id == company_id)
    )
    if current_user.role == UserRole.manager:
        query = query.where(or_(Task.assigned_to == current_user.id, Task.created_by_user_id == current_user.id))
    elif scope == "my":
        query = query.where(Task.assigned_to == current_user.id)
    elif current_user.role == UserRole.admin:
        query = query.where(
            or_(
                Task.assigned_to == current_user.id,
                Task.created_by_user_id == current_user.id,
                assignee_u.role.in_([UserRole.manager, UserRole.expert, UserRole.admin]),
            )
        )
    elif current_user.role == UserRole.expert:
        if await is_chief_expert(db, current_user):
            query = query.where(
                or_(
                    Task.assigned_to == current_user.id,
                    Task.created_by_user_id == current_user.id,
                    assignee_u.role.in_([UserRole.manager, UserRole.expert, UserRole.admin]),
                )
            )
        else:
            query = query.where(or_(Task.assigned_to == current_user.id, Task.created_by_user_id == current_user.id))
    elif current_user.role != UserRole.owner:
        query = query.where(Task.assigned_to == current_user.id)

    if current_user.role == UserRole.expert and not await is_chief_expert(db, current_user):
        query = query.where(
            or_(
                Task.assigned_to != current_user.id,
                creator_u.role.in_([UserRole.owner, UserRole.admin]),
                Task.created_by_user_id == current_user.id,
            )
        )

    if journal:
        query = query.where(Task.status.in_([TaskStatus.done, TaskStatus.cancelled]))
    else:
        query = query.where(~Task.status.in_([TaskStatus.done, TaskStatus.cancelled]))

    if status_filter:
        valid_statuses = {s.value for s in TaskStatus}
        if status_filter not in valid_statuses:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid status")
        query = query.where(Task.status == status_filter)
    deadline_from_dt = _parse_deadline_param(deadline_from, name="deadline_from")
    deadline_to_dt = _parse_deadline_param(deadline_to, name="deadline_to")
    if deadline_from_dt is not None:
        query = query.where(Task.deadline.is_not(None), Task.deadline >= deadline_from_dt)
    if deadline_to_dt is not None:
        query = query.where(Task.deadline.is_not(None), Task.deadline <= deadline_to_dt)
    term = (q or "").strip()
    if term:
        like = f"%{term}%"
        query = query.where(or_(Task.title.ilike(like), Task.description.ilike(like)))

    total = 0
    if include_total:
        total_q = select(func.count()).select_from(query.subquery())
        total = int((await db.scalar(total_q)) or 0)
    query = query.order_by(Task.id.desc())
    if offset > 0:
        query = query.offset(offset)
    if limit is not None:
        query = query.limit(limit)
    rows = (await db.execute(query)).all()
    items = [_to_task_read(task=t, assignee=assignee, creator=creator) for t, assignee, creator in rows]
    if not include_total:
        total = len(items)
    return TaskListResponse(items=items, total=total)


@router.get("/{task_id}", response_model=TaskRead)
async def get_task(
    task_id: int,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentUser,
    company_id: CurrentCompanyId,
) -> TaskRead:
    task = await db.get(Task, task_id)
    if task is None or task.company_id != company_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Task not found")
    if _is_task_closed(task):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Задача уже в журнале и не может быть удалена",
        )
    if current_user.role == UserRole.manager and task.assigned_to != current_user.id and task.created_by_user_id != current_user.id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Менеджер видит только свои задачи")
    if current_user.role == UserRole.expert and task.assigned_to == current_user.id:
        creator = await _get_company_user(db, task.created_by_user_id, company_id)
        if creator and creator.role not in (UserRole.owner, UserRole.admin):
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Эксперт получает задачи только от администратора или владельца")
    assignee = await _get_company_user(db, task.assigned_to, company_id)
    creator = await _get_company_user(db, task.created_by_user_id, company_id)
    return _to_task_read(task, assignee=assignee, creator=creator)


@router.patch("/{task_id}", response_model=TaskRead)
async def update_task(
    task_id: int,
    body: TaskUpdate,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentUser,
    company_id: CurrentCompanyId,
) -> TaskRead:
    task = await db.get(Task, task_id)
    if task is None or task.company_id != company_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Task not found")
    if _is_task_closed(task):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Задача уже в журнале (решена/закрыта) и больше не редактируется",
        )
    data = body.model_dump(exclude_unset=True)
    if current_user.role in (UserRole.manager, UserRole.expert):
        if task.assigned_to != current_user.id:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Можно изменять только свои задачи")
        forbidden = {"title", "deadline", "assigned_to", "description", "related_lead_id"}
        if any(k in data for k in forbidden):
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Доступно только изменение статуса своей задачи")
        if current_user.role == UserRole.manager and "status" in data and data["status"] not in (
            TaskStatus.done,
            TaskStatus.cancelled,
        ):
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Менеджер может только закрывать свою задачу")
    elif current_user.role == UserRole.admin:
        if task.created_by_user_id != current_user.id and task.assigned_to != current_user.id:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Администратор может менять только свои созданные задачи или полученные")

    if body.assigned_to is not None:
        assignee = await _get_company_user(db, body.assigned_to, company_id)
        if assignee is None:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="assigned_to user not found")
        expert_can_assign = await _can_expert_assign(current_user, db, company_id)
        _ensure_assign_permission(current_user=current_user, assignee=assignee, expert_can_assign=expert_can_assign)
    if "related_lead_id" in data:
        await _ensure_related_lead_exists(db, body.related_lead_id, company_id)
    for key, value in data.items():
        setattr(task, key, value)
    await db.flush()
    assignee = await _get_company_user(db, task.assigned_to, company_id)
    creator = await _get_company_user(db, task.created_by_user_id, company_id)
    return _to_task_read(task, assignee=assignee, creator=creator)


@router.patch("/{task_id}/review", response_model=TaskRead)
async def review_task(
    task_id: int,
    body: TaskReviewUpdate,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentUser,
    company_id: CurrentCompanyId,
) -> TaskRead:
    task = await db.get(Task, task_id)
    if task is None or task.company_id != company_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Task not found")
    if not _is_task_closed(task):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Оценка доступна только для задач в журнале")
    if task.created_by_user_id != current_user.id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Оценку может выставить только постановщик задачи",
        )
    task.review_score = body.score
    task.review_comment = (body.comment or "").strip() or None
    task.review_by_user_id = current_user.id
    task.review_at = datetime.now(UTC)
    await db.flush()
    assignee = await _get_company_user(db, task.assigned_to, company_id)
    creator = await _get_company_user(db, task.created_by_user_id, company_id)
    return _to_task_read(task, assignee=assignee, creator=creator)


@router.delete("/{task_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_task(
    task_id: int,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentUser,
    company_id: CurrentCompanyId,
) -> None:
    task = await db.get(Task, task_id)
    if task is None or task.company_id != company_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Task not found")
    if current_user.role == UserRole.owner:
        await db.execute(delete(Task).where(Task.id == task_id, Task.company_id == company_id))
        return
    if current_user.role == UserRole.admin and task.created_by_user_id == current_user.id:
        await db.execute(delete(Task).where(Task.id == task_id, Task.company_id == company_id))
        return
    raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Недостаточно прав для удаления задачи")
