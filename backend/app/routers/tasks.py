from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import CurrentUser
from app.database import get_db
from app.models import Task, User
from app.schemas.task import TaskCreate, TaskRead, TaskUpdate

router = APIRouter(prefix="/tasks", tags=["tasks"])


async def _ensure_user_exists(db: AsyncSession, user_id: int | None) -> None:
    if user_id is None:
        return
    u = await db.get(User, user_id)
    if u is None:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="assigned_to user not found")


@router.post("", response_model=TaskRead, status_code=status.HTTP_201_CREATED)
async def create_task(
    body: TaskCreate,
    db: Annotated[AsyncSession, Depends(get_db)],
    _: CurrentUser,
) -> Task:
    await _ensure_user_exists(db, body.assigned_to)
    task = Task(
        title=body.title,
        deadline=body.deadline,
        status=body.status,
        assigned_to=body.assigned_to,
        description=body.description,
    )
    db.add(task)
    await db.flush()
    await db.refresh(task)
    return task


@router.get("", response_model=list[TaskRead])
async def list_tasks(
    db: Annotated[AsyncSession, Depends(get_db)],
    _: CurrentUser,
) -> list[Task]:
    result = await db.execute(select(Task).order_by(Task.id.desc()))
    return list(result.scalars().all())


@router.get("/{task_id}", response_model=TaskRead)
async def get_task(
    task_id: int,
    db: Annotated[AsyncSession, Depends(get_db)],
    _: CurrentUser,
) -> Task:
    task = await db.get(Task, task_id)
    if task is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Task not found")
    return task


@router.patch("/{task_id}", response_model=TaskRead)
async def update_task(
    task_id: int,
    body: TaskUpdate,
    db: Annotated[AsyncSession, Depends(get_db)],
    _: CurrentUser,
) -> Task:
    task = await db.get(Task, task_id)
    if task is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Task not found")
    if body.assigned_to is not None:
        await _ensure_user_exists(db, body.assigned_to)
    data = body.model_dump(exclude_unset=True)
    for key, value in data.items():
        setattr(task, key, value)
    await db.flush()
    await db.refresh(task)
    return task


@router.delete("/{task_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_task(
    task_id: int,
    db: Annotated[AsyncSession, Depends(get_db)],
    _: CurrentUser,
) -> None:
    task = await db.get(Task, task_id)
    if task is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Task not found")
    await db.execute(delete(Task).where(Task.id == task_id))
