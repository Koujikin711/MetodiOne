from datetime import datetime
from decimal import Decimal

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
    refusal_reason: str | None = None
    pipeline_id: int | None = None

    # Для Kanban и workflow (иконки и управление протоколом)
    protocol_deal_id: int | None = None
    protocol_requested: bool = False
    protocol_confirmed: bool = False
    protocol_file_attached: bool = False
    paid_extras_amount: Decimal = Decimal("0")

    model_config = {"from_attributes": True}


class LeadStatusPatchResponse(LeadRead):
    automation_task_created: bool = False


class LeadImportErrorItem(BaseModel):
    row: int
    message: str


class LeadImportResponse(BaseModel):
    created: int
    errors: list[LeadImportErrorItem]
