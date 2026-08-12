from datetime import datetime
from decimal import Decimal

from pydantic import BaseModel, Field


class SalesClientSuggestItem(BaseModel):
    lead_id: int | None = None
    client_name: str
    client_phone: str
    enterprise_type: str | None = None
    source: str = "crm"


class SalesFieldVisitCreate(BaseModel):
    manager_name: str = Field(..., min_length=1, max_length=255)
    lead_id: int | None = Field(default=None, ge=1)
    client_name: str = Field(..., min_length=1, max_length=255)
    client_phone: str = Field(..., min_length=5, max_length=64)
    enterprise_type: str = Field(..., min_length=1, max_length=255)
    lat: Decimal = Field(..., ge=-90, le=90)
    lon: Decimal = Field(..., ge=-180, le=180)
    accuracy_m: Decimal | None = Field(default=None, ge=0, le=5000)
    address: str | None = Field(default=None, max_length=512)
    note: str | None = Field(default=None, max_length=2000)
    visited_at: datetime | None = None


class SalesFieldVisitOut(BaseModel):
    id: int
    company_id: int
    manager_user_id: int
    manager_name: str
    lead_id: int | None = None
    client_name: str
    client_phone: str
    enterprise_type: str
    lat: Decimal
    lon: Decimal
    accuracy_m: Decimal | None = None
    address: str | None = None
    note: str | None = None
    visited_at: datetime
    created_at: datetime

    model_config = {"from_attributes": True}
