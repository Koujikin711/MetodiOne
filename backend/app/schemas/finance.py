from datetime import datetime
from decimal import Decimal

from pydantic import BaseModel, Field


class FinanceSettingsRead(BaseModel):
    inventory_enabled: bool
    costing_method: str
    revenue_goods_policy: str
    revenue_services_policy: str

    model_config = {"from_attributes": True}


class FinanceSettingsPatch(BaseModel):
    inventory_enabled: bool | None = None
    costing_method: str | None = Field(default=None, max_length=16)
    revenue_goods_policy: str | None = Field(default=None, max_length=24)
    revenue_services_policy: str | None = Field(default=None, max_length=24)


class WarehouseRead(BaseModel):
    id: int
    name: str
    code: str | None
    is_active: bool
    sort_order: int
    is_default: bool

    model_config = {"from_attributes": True}


class WarehouseCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=255)
    code: str | None = Field(default=None, max_length=64)
    is_default: bool = False
    sort_order: int = 0


class WarehousePatch(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=255)
    code: str | None = None
    is_active: bool | None = None
    sort_order: int | None = None
    is_default: bool | None = None


class AccountRead(BaseModel):
    id: int
    code: str
    name: str
    account_type: str
    is_system: bool
    is_active: bool

    model_config = {"from_attributes": True}


class JournalLineIn(BaseModel):
    account_id: int = Field(..., ge=1)
    debit: Decimal = Field(default=Decimal("0"), ge=0)
    credit: Decimal = Field(default=Decimal("0"), ge=0)


class JournalCreate(BaseModel):
    entry_date: datetime
    memo: str | None = None
    lines: list[JournalLineIn] = Field(..., min_length=2)


class JournalEntryRead(BaseModel):
    id: int
    entry_date: datetime
    memo: str | None
    source_type: str

    model_config = {"from_attributes": True}


class JournalLineDetailRead(BaseModel):
    account_code: str
    account_name: str
    debit: Decimal
    credit: Decimal


class JournalEntryDetailRead(BaseModel):
    id: int
    entry_date: datetime
    memo: str | None
    source_type: str
    created_at: datetime
    lines: list[JournalLineDetailRead]


class StockMovementRead(BaseModel):
    id: int
    created_at: datetime
    movement_type: str
    qty_delta: Decimal
    unit_cost: Decimal | None
    memo: str | None
    warehouse_id: int
    warehouse_name: str
    product_id: int
    product_name: str


class ProductRead(BaseModel):
    id: int
    name: str
    sku: str | None
    product_type: str
    unit: str
    is_active: bool

    model_config = {"from_attributes": True}


class ProductCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=255)
    sku: str | None = Field(default=None, max_length=120)
    product_type: str = Field(default="good", max_length=16)
    unit: str = Field(default="pcs", max_length=32)


class StockBalanceRead(BaseModel):
    product_id: int
    product_name: str
    warehouse_id: int
    warehouse_name: str
    quantity: Decimal
    avg_unit_cost: Decimal
    value: Decimal


class StockReceiptCreate(BaseModel):
    warehouse_id: int = Field(..., ge=1)
    product_id: int = Field(..., ge=1)
    quantity: Decimal = Field(..., gt=0)
    unit_cost: Decimal = Field(..., ge=0)
    memo: str | None = None


class StockIssueCreate(BaseModel):
    warehouse_id: int = Field(..., ge=1)
    product_id: int = Field(..., ge=1)
    quantity: Decimal = Field(..., gt=0)
    memo: str | None = None


class FinanceDashboardRead(BaseModel):
    warehouse_count: int
    multi_warehouse: bool
    warehouses: list[dict]
    inventory_enabled: bool
    costing_method: str


class DeferredContractRead(BaseModel):
    id: int
    title: str
    total_amount: Decimal
    period_count: int
    start_date: datetime
    end_date: datetime
    memo: str | None

    model_config = {"from_attributes": True}


class DeferredContractCreate(BaseModel):
    title: str = Field(..., min_length=1, max_length=255)
    total_amount: Decimal = Field(..., gt=0)
    period_count: int = Field(..., ge=1, le=120)
    start_date: datetime
    end_date: datetime
    memo: str | None = None


class DeferredPeriodRead(BaseModel):
    id: int
    period_no: int
    amount: Decimal
    due_date: datetime
    posted_at: datetime | None
    journal_entry_id: int | None

    model_config = {"from_attributes": True}


# --- Отчёты, дашборды, бюджет ---


class FinancePeriodSummaryRead(BaseModel):
    date_from: datetime
    date_to: datetime
    revenue_total: Decimal
    expense_total: Decimal
    net_income: Decimal
    inventory_value: Decimal
    deferred_unrecognized: Decimal
    journal_entries_count: int


class TrialBalanceLineRead(BaseModel):
    account_code: str
    account_name: str
    account_type: str
    debit_total: Decimal
    credit_total: Decimal
    net_balance: Decimal


class PLLineRead(BaseModel):
    account_code: str
    account_name: str
    account_type: str
    amount: Decimal


class YearOverviewMonthRead(BaseModel):
    year: int
    month: int
    revenue_actual: Decimal
    expense_actual: Decimal
    net_actual: Decimal
    revenue_plan: Decimal
    expense_plan: Decimal


class BudgetMonthPut(BaseModel):
    year: int = Field(..., ge=2000, le=2100)
    month: int = Field(..., ge=1, le=12)
    revenue_plan: Decimal = Field(default=Decimal("0"), ge=0)
    expense_plan: Decimal = Field(default=Decimal("0"), ge=0)


class BudgetMonthRead(BaseModel):
    year: int
    month: int
    revenue_plan: Decimal
    expense_plan: Decimal
    updated_at: datetime

    model_config = {"from_attributes": True}


class ForecastPointRead(BaseModel):
    year: int
    month: int
    projected_revenue: Decimal


class FinanceForecastRead(BaseModel):
    baseline_months_used: int
    average_monthly_revenue: Decimal
    points: list[ForecastPointRead]
