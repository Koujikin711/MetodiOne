from datetime import datetime

from pydantic import BaseModel, Field

from app.models import TaskStatus, UserRole


class TaskCreate(BaseModel):
    title: str = Field(..., min_length=1, max_length=255)
    deadline: datetime | None = None
    status: TaskStatus = TaskStatus.pending
    assigned_to: int | None = None
    description: str | None = None
    related_lead_id: int | None = None


class TaskUpdate(BaseModel):
    title: str | None = Field(None, min_length=1, max_length=255)
    deadline: datetime | None = None
    status: TaskStatus | None = None
    assigned_to: int | None = None
    description: str | None = None
    related_lead_id: int | None = None


class TaskRead(BaseModel):
    id: int
    title: str
    deadline: datetime | None
    status: TaskStatus
    assigned_to: int | None
    assigned_to_name: str | None = None
    assigned_to_role: UserRole | None = None
    created_by_user_id: int | None = None
    created_by_name: str | None = None
    created_by_role: UserRole | None = None
    description: str | None
    related_lead_id: int | None = None
    review_score: int | None = None
    review_comment: str | None = None
    review_by_user_id: int | None = None
    review_at: datetime | None = None
    is_locked: bool = False

    model_config = {"from_attributes": True}


class TaskReviewUpdate(BaseModel):
    score: int = Field(..., ge=1, le=10)
    comment: str | None = Field(None, max_length=1000)


class TaskAssigneeRead(BaseModel):
    id: int
    full_name: str | None = None
    email: str
    role: UserRole


class TaskListResponse(BaseModel):
    items: list[TaskRead]
    total: int
