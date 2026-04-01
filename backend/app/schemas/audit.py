from datetime import datetime

from pydantic import BaseModel


class SystemAuditEventRead(BaseModel):
    id: int
    entity_type: str
    entity_id: int | None = None
    action: str
    details: str | None = None
    user_id: int | None = None
    user_name: str | None = None
    created_at: datetime
