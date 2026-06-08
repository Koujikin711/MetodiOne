from datetime import date, datetime
from decimal import Decimal

from pydantic import BaseModel, Field


class FinanceSettingsRead(BaseModel):
    inventory_enabled: bool
    costing_method: str
    revenue_goods_policy: str
    revenue_services_policy: str
    last_osv_import_from: date | None = None
    last_osv_import_to: date | None = None
    posting_locked_until: date | None = None

    model_config = {"from_attributes": True}


class FinanceSettingsPatch(BaseModel):
    inventory_enabled: bool | None = None
    costing_method: str | None = Field(default=None, max_length=16)
    revenue_goods_policy: str | None = Field(default=None, max_length=24)
    revenue_services_policy: str | None = Field(default=None, max_length=24)
    posting_locked_until: date | None = Field(
        default=None,
        description="Последняя дата закрытого периода (включительно): проводки с датой ≤ этой дате запрещены. null — снять блокировку.",
    )


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
    dimensions: dict | None = Field(
        default=None,
        description="Аналитика строки (JSON), напр. dds_bucket, dds_article, проект, подразделение",
    )


class JournalCreate(BaseModel):
    entry_date: datetime
    memo: str | None = None
    lines: list[JournalLineIn] = Field(..., min_length=2)
    related_lead_id: int | None = Field(default=None, ge=1)
    related_deal_id: int | None = Field(default=None, ge=1)


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
    dimensions: dict | None = None


class JournalEntryDetailRead(BaseModel):
    id: int
    entry_date: datetime
    memo: str | None
    source_type: str
    created_at: datetime
    related_lead_id: int | None = None
    related_deal_id: int | None = None
    lines: list[JournalLineDetailRead]


class JournalEntryCrmPatch(BaseModel):
    related_lead_id: int | None = Field(default=None, ge=1, description="null — снять привязку")
    related_deal_id: int | None = Field(default=None, ge=1, description="null — снять привязку")


class FinanceClosedMonthRead(BaseModel):
    year: int
    month: int
    closed_at: datetime
    closed_by_user_id: int | None = None


class FinanceClosedMonthCreate(BaseModel):
    year: int = Field(..., ge=2000, le=2100)
    month: int = Field(..., ge=1, le=12)


class FinanceBankStatementLineRead(BaseModel):
    id: int
    txn_date: date
    amount: Decimal
    description: str | None = None
    journal_entry_id: int | None = None
    matched_at: datetime | None = None
    created_at: datetime

    model_config = {"from_attributes": True}


class FinanceBankStatementMatchBody(BaseModel):
    journal_entry_id: int = Field(..., ge=1)


class FinanceReminderMessageRead(BaseModel):
    kind: str
    text: str


class FinanceRemindersRead(BaseModel):
    messages: list[FinanceReminderMessageRead]


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
    net_margin_pct: Decimal | None = Field(
        default=None,
        description="Чистая маржа % к выручке; null если выручка 0",
    )
    budget_revenue_plan: Decimal | None = Field(default=None, description="План выручки за месяц, если период = полный календарный месяц")
    budget_expense_plan: Decimal | None = Field(default=None, description="План расходов за месяц")
    budget_revenue_variance_pct: Decimal | None = Field(default=None, description="Отклонение факта выручки от плана, %")
    budget_expense_variance_pct: Decimal | None = Field(default=None, description="Отклонение факта расходов от плана, %")
    budget_alert: bool = Field(
        default=False,
        description="True если отклонение по выручке или расходам от плана по модулю > 10%",
    )
    cash_balance: Decimal = Field(default=Decimal("0"), description="Остаток денег (1010+1020) на конец периода")
    ar_crm_total: Decimal = Field(default=Decimal("0"), description="Дебиторка по CRM: неоплаченные записи и доп. услуги")
    ar_appointments: Decimal = Field(default=Decimal("0"))
    ar_deals: Decimal = Field(default=Decimal("0"))
    crm_collected_total: Decimal = Field(default=Decimal("0"), description="Поступления в CRM за период (оплаты записей и сделок)")
    crm_service_volume: Decimal = Field(default=Decimal("0"), description="Объём услуг по записям за период (service_amount)")


class AccountantDashboardRead(BaseModel):
    date_from: datetime
    date_to: datetime
    revenue_total: Decimal
    expense_total: Decimal
    net_income: Decimal
    cash_opening: Decimal
    cash_closing: Decimal
    cash_net_change: Decimal
    dds_operating_net: Decimal = Field(default=Decimal("0"), description="Операционный поток ДДС за период")
    trial_balance_lines: int = 0
    gmail_pending_count: int = 0


class FinanceReceivableLineRead(BaseModel):
    kind: str
    source_id: int
    lead_id: int | None = None
    counterparty: str
    amount_total: Decimal
    amount_paid: Decimal
    amount_due: Decimal
    occurred_at: datetime | None = None


class FinanceManagerCollectionRead(BaseModel):
    manager_id: int
    manager_name: str
    collected_amount: Decimal


class FinanceClinicSummaryRead(BaseModel):
    date_from: datetime
    date_to: datetime
    revenue_total: Decimal
    expense_total: Decimal
    net_income: Decimal
    cash_balance: Decimal
    ar_crm_total: Decimal
    ar_appointments: Decimal
    ar_deals: Decimal
    ar_gl_balance: Decimal
    crm_collected_total: Decimal
    crm_collected_appointments: Decimal
    crm_collected_deals: Decimal
    crm_service_volume: Decimal
    deferred_unrecognized: Decimal
    inventory_value: Decimal
    receivable_lines: list[FinanceReceivableLineRead] = Field(default_factory=list)
    manager_collections: list[FinanceManagerCollectionRead] = Field(default_factory=list)


class TrialBalanceLineRead(BaseModel):
    account_code: str
    account_name: str
    account_type: str
    debit_total: Decimal
    credit_total: Decimal
    net_balance: Decimal


class AccountTypeRollupRead(BaseModel):
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


class OsvImportResultRead(BaseModel):
    applied: bool
    date_from: str
    date_to: str
    rows_parsed: int
    journal_entry_id: int | None = None
    warnings: list[str] = Field(default_factory=list)
    accounts_missing: list[str] = Field(default_factory=list)


class JournalTemplateLineIn(BaseModel):
    account_code: str = Field(..., min_length=1, max_length=32)
    debit: Decimal = Field(default=Decimal("0"), ge=0)
    credit: Decimal = Field(default=Decimal("0"), ge=0)


class JournalTemplateCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=255)
    lines: list[JournalTemplateLineIn] = Field(..., min_length=2)


class JournalTemplateRead(BaseModel):
    id: int
    name: str
    lines: list[dict]
    created_at: datetime

    model_config = {"from_attributes": True}


class JournalFromTemplateBody(BaseModel):
    entry_date: datetime


class FinanceConsistencyRead(BaseModel):
    debit_total: Decimal
    credit_total: Decimal
    balanced: bool
    difference: Decimal
    inventory_account_code: str
    inventory_gl_net: Decimal
    inventory_stock_value: Decimal


class BalanceSheetRowRead(BaseModel):
    """Строка упрощённого баланса: раздел + подпись + сумма (в рублях, как в журнале)."""

    section: str = Field(..., description="asset | liability | equity | retained")
    line_kind: str = Field(..., description="header | detail | total")
    account_code: str | None = None
    label: str
    amount: Decimal


class BalanceSheetReportRead(BaseModel):
    as_of_date: datetime
    rows: list[BalanceSheetRowRead]
    total_assets: Decimal
    total_liabilities: Decimal
    total_equity_accounts: Decimal
    retained_earnings: Decimal
    total_passive: Decimal
    balanced: bool


class CashFlowBucketRead(BaseModel):
    bucket_key: str
    label: str
    amount: Decimal = Field(..., description="Знак: + приток денег, − отток (по оценке корр. счетов)")


class CashFlowReportRead(BaseModel):
    date_from: datetime
    date_to: datetime
    opening_cash: Decimal
    closing_cash: Decimal
    net_change: Decimal
    buckets: list[CashFlowBucketRead]
