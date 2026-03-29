from datetime import datetime

from pydantic import BaseModel, Field

from app.schemas.email_types import RelaxedEmailStr


class LeadCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=255)
    phone: str | None = Field(None, max_length=64)
    email: RelaxedEmailStr | None = None
    source: str | None = Field(None, max_length=120)
    status_id: int


class LeadStatusUpdate(BaseModel):
    status_id: int = Field(..., ge=1)


class LeadRead(BaseModel):
    id: int
    name: str
    phone: str | None
    email: str | None
    source: str | None
    status_id: int
    stage_name: str | None = None
    manager_id: int | None

    model_config = {"from_attributes": True}


class LeadStatusPatchResponse(LeadRead):
    automation_task_created: bool = False
