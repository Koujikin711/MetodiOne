from datetime import datetime
from decimal import Decimal

from pydantic import BaseModel, Field


class SalesKpiPipelineMeta(BaseModel):
    id: int
    name: str
    expert_user_id: int | None = None
    expert_name: str | None = None


class SalesKpiPriceWrite(BaseModel):
    direction_id: int = Field(..., ge=1)
    unit_price: Decimal = Field(default=Decimal("0"), ge=0)


class SalesKpiPlanCellWrite(BaseModel):
    direction_id: int = Field(..., ge=1)
    plan_qty: int = Field(default=0, ge=0)


class SalesKpiManagerPlanWrite(BaseModel):
    manager_user_id: int = Field(..., ge=1)
    cells: list[SalesKpiPlanCellWrite] = Field(default_factory=list)


class SalesKpiMatrixPut(BaseModel):
    pipeline_id: int = Field(..., ge=1)
    year_month: str = Field(..., description="YYYY-MM")
    prices: list[SalesKpiPriceWrite] = Field(default_factory=list)
    managers: list[SalesKpiManagerPlanWrite] = Field(default_factory=list)


class SalesKpiDirectionMeta(BaseModel):
    direction_id: int
    direction_name: str
    unit_price: Decimal


class SalesKpiManagerCell(BaseModel):
    direction_id: int
    plan_qty: int
    plan_amount: Decimal
    actual_paid: Decimal
    actual_count: int
    progress_percent: float | None = None


class SalesKpiManagerRow(BaseModel):
    manager_id: int
    manager_name: str
    total_plan_amount: Decimal
    total_actual_paid: Decimal
    total_progress_percent: float | None = None
    cells: list[SalesKpiManagerCell]


class SalesKpiOwnerMatrix(BaseModel):
    pipeline_id: int
    pipeline_name: str
    year_month: str
    directions: list[SalesKpiDirectionMeta]
    managers: list[SalesKpiManagerRow]


class SalesKpiManagerMatrix(BaseModel):
    pipeline_id: int
    pipeline_name: str
    year_month: str
    directions: list[SalesKpiDirectionMeta]
    manager: SalesKpiManagerRow


class SalesKpiPriceHint(BaseModel):
    fixed_price: Decimal | None = None
    year_month: str
    direction_id: int
    direction_name: str | None = None
    start_at: datetime


class SalesKpiLeadPriceHint(BaseModel):
    fixed_price: Decimal | None = None
    year_month: str
    direction_id: int | None = None
    direction_name: str | None = None
