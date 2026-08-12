from datetime import datetime
from decimal import Decimal

from pydantic import BaseModel, Field


class ManagerDeskSaleCreate(BaseModel):
    client_name: str = Field(..., min_length=1, max_length=255)
    client_phone: str = Field(..., min_length=5, max_length=64)
    activity_sphere: str = Field(..., min_length=1, max_length=255)
    service_amount: Decimal = Field(..., ge=0)
    paid_amount: Decimal = Field(..., ge=0)
    pipeline_id: int | None = Field(default=None, ge=1)
    note: str | None = Field(default=None, max_length=2000)
    sold_at: datetime | None = None


class ManagerDeskSalePaymentPatch(BaseModel):
    paid_amount: Decimal = Field(..., ge=0)
    service_amount: Decimal | None = Field(default=None, ge=0)
    activity_sphere: str | None = Field(default=None, min_length=1, max_length=255)
    note: str | None = Field(default=None, max_length=2000)


class ManagerDeskSaleOut(BaseModel):
    id: int
    company_id: int
    pipeline_id: int | None
    manager_user_id: int
    manager_name: str | None = None
    client_name: str
    client_phone: str
    activity_sphere: str
    service_amount: Decimal
    paid_amount: Decimal
    sold_at: datetime
    status: str
    note: str | None = None
    created_by_user_id: int | None = None
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}
