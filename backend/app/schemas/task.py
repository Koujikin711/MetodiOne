from datetime import datetime

from pydantic import BaseModel, Field

from app.models import TaskStatus


class TaskCreate(BaseModel):
    title: str = Field(..., min_length=1, max_length=255)
    deadline: datetime | None = None
    status: TaskStatus = TaskStatus.pending
    assigned_to: int | None = None
    description: str | None = None


class TaskUpdate(BaseModel):
    title: str | None = Field(None, min_length=1, max_length=255)
    deadline: datetime | None = None
    status: TaskStatus | None = None
    assigned_to: int | None = None
    description: str | None = None


class TaskRead(BaseModel):
    id: int
    title: str
    deadline: datetime | None
    status: TaskStatus
    assigned_to: int | None
    description: str | None
    related_lead_id: int | None = None

    model_config = {"from_attributes": True}
