from datetime import datetime
from decimal import Decimal

from pydantic import BaseModel, Field


class ExtraServiceTypeCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=255)
    keep_percent: Decimal = Field(..., ge=0, le=100)
    payout_percent: Decimal = Field(..., ge=0, le=100)
    is_active: bool = True
    sort_order: int = 0


class ExtraServiceTypeUpdate(BaseModel):
    name: str | None = Field(None, min_length=1, max_length=255)
    keep_percent: Decimal | None = Field(None, ge=0, le=100)
    payout_percent: Decimal | None = Field(None, ge=0, le=100)
    is_active: bool | None = None
    sort_order: int | None = None


class ExtraServiceTypeOut(BaseModel):
    id: int
    company_id: int
    name: str
    keep_percent: Decimal
    payout_percent: Decimal
    is_active: bool
    sort_order: int
    created_at: datetime | None = None
    updated_at: datetime | None = None

    model_config = {"from_attributes": True}


class ExtraServiceSaleCreate(BaseModel):
    service_type_id: int = Field(..., ge=1)
    client_name: str = Field(..., min_length=1, max_length=255)
    client_phone: str = Field("", max_length=64)
    amount: Decimal = Field(..., gt=0)
    sold_at: datetime | None = None
    note: str | None = Field(None, max_length=2000)


class ExtraServiceSaleOut(BaseModel):
    id: int
    company_id: int
    service_type_id: int
    service_name: str
    client_name: str
    client_phone: str
    amount: Decimal
    keep_percent: Decimal
    payout_percent: Decimal
    keep_amount: Decimal
    payout_amount: Decimal
    sold_at: datetime
    note: str | None = None
    status: str
    created_by_user_id: int | None = None
    created_by_name: str | None = None
    created_at: datetime | None = None

    model_config = {"from_attributes": True}


class ExtraServiceReportByType(BaseModel):
    service_type_id: int
    service_name: str
    count: int
    amount_total: Decimal
    keep_total: Decimal
    payout_total: Decimal


class ExtraServiceReportByClient(BaseModel):
    client_name: str
    client_phone: str
    count: int
    amount_total: Decimal
    keep_total: Decimal
    payout_total: Decimal


class ExtraServiceReportOut(BaseModel):
    count: int
    amount_total: Decimal
    keep_total: Decimal
    payout_total: Decimal
    by_type: list[ExtraServiceReportByType]
    by_client: list[ExtraServiceReportByClient]
