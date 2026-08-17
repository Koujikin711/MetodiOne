from datetime import datetime

from pydantic import BaseModel, Field


class WaitingCallbackCreate(BaseModel):
    lead_id: int = Field(..., ge=1)
    client_name: str = Field(..., min_length=1, max_length=255)
    client_phone: str = Field("", max_length=64)
    pain_text: str = Field("", max_length=4000)
    scheduled_at: datetime
    set_waiting_stage: bool = True


class WaitingCallbackRead(BaseModel):
    id: int
    lead_id: int
    manager_id: int | None = None
    client_name: str
    client_phone: str
    pain_text: str
    scheduled_at: datetime
    status: str
    client_reminder_sent_at: datetime | None = None
    manager_notified_at: datetime | None = None
    created_at: datetime | None = None

    model_config = {"from_attributes": True}
