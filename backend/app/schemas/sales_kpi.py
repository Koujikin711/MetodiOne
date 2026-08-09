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


# --- Взвешенный KPI / ПРОДАЖИ / курсы ---


class SalesKpiPlanItemWrite(BaseModel):
    name: str = Field(..., min_length=1, max_length=255)
    plan_qty: int = Field(default=0, ge=0)
    weight_percent: Decimal = Field(default=Decimal("0"), ge=0, le=100)
    source_type: str = Field(default="manual", description="direction|manual")
    direction_id: int | None = Field(default=None, ge=1)
    sort_order: int = Field(default=0, ge=0)


class SalesKpiWeightedPlanPut(BaseModel):
    pipeline_id: int = Field(..., ge=1)
    year_month: str = Field(..., description="YYYY-MM")
    bonus_fund: Decimal = Field(default=Decimal("10000"), ge=0)
    items: list[SalesKpiPlanItemWrite] = Field(default_factory=list)
    prices: list[SalesKpiPriceWrite] = Field(default_factory=list)


class SalesKpiPlanItemOut(BaseModel):
    id: int
    name: str
    plan_qty: int
    weight_percent: Decimal
    source_type: str
    direction_id: int | None = None
    sort_order: int = 0


class SalesKpiWeightedPlanOut(BaseModel):
    pipeline_id: int
    pipeline_name: str
    year_month: str
    bonus_fund: Decimal
    items: list[SalesKpiPlanItemOut]
    directions: list[SalesKpiDirectionMeta]
    managers: list[dict]


class SalesKpiBoardLine(BaseModel):
    plan_item_id: int
    name: str
    source_type: str
    direction_id: int | None = None
    plan_qty: int
    weight_percent: Decimal
    fact_qty: int
    completion: float | None = None
    contribution: Decimal


class SalesKpiBoardManager(BaseModel):
    manager_id: int
    manager_name: str
    lines: list[SalesKpiBoardLine]
    total_contribution: Decimal
    bonus: Decimal
    bonus_fund: Decimal


class SalesKpiSalesReport(BaseModel):
    pipeline_id: int
    pipeline_name: str
    year_month: str
    bonus_fund: Decimal
    items: list[SalesKpiPlanItemOut]
    managers: list[SalesKpiBoardManager]


class SalesKpiManualSaleCreate(BaseModel):
    pipeline_id: int = Field(..., ge=1)
    plan_item_id: int = Field(..., ge=1)
    manager_user_id: int = Field(..., ge=1)
    client_name: str = Field(..., min_length=1, max_length=255)
    client_phone: str = Field(..., min_length=1, max_length=64)
    service_amount: Decimal = Field(..., gt=0)
    paid_amount: Decimal = Field(default=Decimal("0"), ge=0)
    sold_at: datetime | None = None
    note: str | None = None


class SalesKpiManualSalePaymentPatch(BaseModel):
    paid_amount: Decimal = Field(..., ge=0)
    note: str | None = None


class SalesKpiManualSaleOut(BaseModel):
    id: int
    pipeline_id: int
    plan_item_id: int
    plan_item_name: str
    manager_user_id: int
    manager_name: str
    client_name: str
    client_phone: str
    service_amount: Decimal
    paid_amount: Decimal
    debt_amount: Decimal
    sold_at: datetime
    status: str
    returned_at: datetime | None = None
    note: str | None = None
    counts_in_kpi: bool


class SalesKpiDebtorRow(BaseModel):
    source: str  # booking | manual
    source_id: int
    sold_at: datetime | None = None
    client_name: str
    client_phone: str
    indicator_name: str
    manager_id: int | None = None
    manager_name: str | None = None
    service_amount: Decimal
    paid_amount: Decimal
    debt_amount: Decimal
    status: str


class SalesKpiDebtorsReport(BaseModel):
    pipeline_id: int
    pipeline_name: str
    year_month: str
    rows: list[SalesKpiDebtorRow]
    total_debt: Decimal
