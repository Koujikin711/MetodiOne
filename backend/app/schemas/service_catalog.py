from datetime import datetime
from decimal import Decimal

from pydantic import BaseModel, Field


class PaymentRuleCreate(BaseModel):
    sort_order: int = Field(1, ge=1)
    label: str | None = Field(None, max_length=120)
    kind: str = Field("percent", pattern="^(percent|fixed)$")
    value: Decimal = Field(..., ge=0)
    trigger_type: str = Field("on_enrollment", max_length=32)
    trigger_day: int | None = Field(None, ge=1, le=365)
    trigger_days_offset: int | None = Field(None, ge=0, le=365)


class ServiceTemplateCreate(BaseModel):
    pipeline_id: int = Field(..., ge=1)
    direction_id: int | None = Field(None, ge=1)
    name: str = Field(..., min_length=1, max_length=255)
    service_type: str = Field("single", pattern="^(single|protocol|course)$")
    duration_days: int | None = Field(None, ge=1, le=365)
    visit_count: int | None = Field(None, ge=1, le=500)
    price_base: Decimal = Field(Decimal("0"), ge=0)
    specialist_ids: list[int] = Field(default_factory=list)
    course_streams_enabled: bool = False
    course_stream_max_days: int = Field(15, ge=5, le=90)
    course_stream_min_day_for_next: int = Field(10, ge=1, le=60)
    course_stream_gap_days: int = Field(10, ge=1, le=60)
    payment_rules: list[PaymentRuleCreate] = Field(..., min_length=1)


class ServiceTemplateUpdate(BaseModel):
    name: str | None = Field(None, min_length=1, max_length=255)
    is_active: bool | None = None
    price_base: Decimal | None = Field(None, ge=0)
    specialist_ids: list[int] | None = None
    payment_rules: list[PaymentRuleCreate] | None = None


class PaymentRuleRead(BaseModel):
    id: int
    sort_order: int
    label: str | None
    kind: str
    value: Decimal
    trigger_type: str
    trigger_day: int | None
    trigger_days_offset: int | None

    model_config = {"from_attributes": True}


class ServiceTemplateRead(BaseModel):
    id: int
    pipeline_id: int
    direction_id: int | None
    name: str
    service_type: str
    duration_days: int | None
    visit_count: int | None
    price_base: Decimal
    specialist_ids: list[int]
    course_streams_enabled: bool
    course_stream_max_days: int
    course_stream_min_day_for_next: int
    course_stream_gap_days: int
    is_active: bool
    is_legacy: bool
    payment_rules: list[PaymentRuleRead] = Field(default_factory=list)
    created_at: datetime | None = None

    model_config = {"from_attributes": True}


class EnrollmentCreate(BaseModel):
    template_id: int = Field(..., ge=1)


class InstallmentRead(BaseModel):
    id: int
    sort_order: int
    label: str | None
    amount: Decimal
    due_date: datetime
    status: str
    paid_at: datetime | None = None

    model_config = {"from_attributes": True}


class EnrollmentRead(BaseModel):
    id: int
    lead_id: int
    template_id: int
    pipeline_id: int
    direction_id: int | None
    template_name: str | None = None
    status: str
    total_price: Decimal
    started_at: datetime
    installments: list[InstallmentRead] = Field(default_factory=list)

    model_config = {"from_attributes": True}


class ReceivableItemRead(BaseModel):
    installment_id: int
    enrollment_id: int
    lead_id: int
    lead_name: str
    pipeline_id: int
    template_name: str
    label: str | None
    amount: Decimal
    due_date: datetime
    status: str
    days_overdue: int = 0


class ReceivablesSummaryRead(BaseModel):
    pending_count: int = 0
    overdue_count: int = 0
    paid_month_amount: Decimal = Decimal("0")
    overdue_amount: Decimal = Decimal("0")
    items: list[ReceivableItemRead] = Field(default_factory=list)


class AccountantExpenseCreate(BaseModel):
    entry_date: datetime | None = None
    amount: Decimal = Field(..., gt=0)
    expense_account_code: str = Field(..., min_length=2, max_length=16)
    dds_article: str = Field(..., min_length=1, max_length=255)
    memo: str | None = Field(None, max_length=500)


class MigrateLegacyResultRead(BaseModel):
    created: int = 0
    skipped: int = 0


class GmailSyncResultRead(BaseModel):
    imported: int = 0


class GmailInboxItemRead(BaseModel):
    id: int
    gmail_message_id: str
    subject: str | None
    sender: str | None
    attachment_name: str | None
    status: str
    parsed_summary: str | None
    created_at: datetime | None

    model_config = {"from_attributes": True}
