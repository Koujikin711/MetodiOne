from datetime import date, datetime
from decimal import Decimal

from pydantic import BaseModel, Field


class FinanceOsvRowRead(BaseModel):
    id: int
    txn_date: date
    partner_amount: Decimal | None = None
    service_period: str | None = None
    revenue: Decimal = Decimal("0")
    expense: Decimal = Decimal("0")
    bank: str | None = None
    basis: str | None = None
    counterparty: str | None = None
    phone: str | None = None
    via_person: str | None = None
    product_service: str | None = None
    article: str | None = None
    detail_category: str | None = None
    brief_category: str | None = None
    source: str
    created_at: datetime

    model_config = {"from_attributes": True}


class FinanceOsvSummaryRead(BaseModel):
    revenue_total: Decimal = Decimal("0")
    expense_total: Decimal = Decimal("0")
    balance: Decimal = Decimal("0")
    rows: list[FinanceOsvRowRead] = Field(default_factory=list)


class FinanceReportCellRow(BaseModel):
    key: str
    label: str
    kind: str = "line"
    values: list[Decimal] = Field(default_factory=list)
    total: Decimal = Decimal("0")
    bold: bool = False
    indent: int = 0


class FinanceReportGroup(BaseModel):
    key: str
    label: str
    kind: str = "group"
    rows: list[FinanceReportCellRow] = Field(default_factory=list)


class FinanceReportSection(BaseModel):
    key: str
    label: str
    kind: str = "section"
    groups: list[FinanceReportGroup] = Field(default_factory=list)


class FinanceDdsReportRead(BaseModel):
    year: int
    month_labels: list[str]
    opening_balance: list[Decimal]
    closing_balance: list[Decimal]
    sections: list[FinanceReportSection]


class FinanceOpiuReportRead(BaseModel):
    year: int
    month_labels: list[str]
    rows: list[FinanceReportCellRow]


class FinanceSettingsRead(BaseModel):
    osv_sheet_url: str | None = None
    osv_sheet_name: str | None = None
    last_osv_import_from: date | None = None
    last_osv_import_to: date | None = None
    google_sheets_ready: bool = False
    service_account_email: str | None = None


class FinanceSettingsPatch(BaseModel):
    osv_sheet_url: str | None = None
    osv_sheet_name: str | None = None


class FinanceIntegrationStatusRead(BaseModel):
    gmail_connected: bool = False
    gmail_email: str | None = None
    sheets_connected: bool = False
    osv_sheet_url: str | None = None
    osv_sheet_name: str | None = None
    last_sync_at: datetime | None = None
    last_osv_import_from: date | None = None
    last_osv_import_to: date | None = None
    osv_rows_count: int = 0


class FinanceIntegrateResultRead(BaseModel):
    gmail_connected: bool
    sheets_connected: bool = False
    osv_sheet_url: str | None = None
    osv_sheet_name: str | None = None
    imported_from_sheets: int = 0
    imported_from_gmail: int = 0
    imported_from_crm: int = 0
    skipped_duplicates: int = 0
    osv_rows_count: int = 0
    message: str


class FinanceExpenseCatalogRead(BaseModel):
    banks: list[str] = Field(default_factory=list)
    articles: list[str] = Field(default_factory=list)
    brief_categories: list[str] = Field(default_factory=list)
    detail_categories: list[str] = Field(default_factory=list)
    products: list[str] = Field(default_factory=list)


class FinanceExpenseCreate(BaseModel):
    txn_date: date
    expense: Decimal = Field(..., gt=0)
    bank: str | None = Field(default=None, max_length=64)
    basis: str | None = Field(default=None, max_length=255)
    counterparty: str | None = Field(default=None, max_length=255)
    phone: str | None = Field(default=None, max_length=64)
    via_person: str | None = Field(default=None, max_length=128)
    product_service: str | None = Field(default=None, max_length=255)
    article: str | None = Field(default=None, max_length=128)
    detail_category: str | None = Field(default=None, max_length=128)
    brief_category: str | None = Field(default="Расход", max_length=64)
