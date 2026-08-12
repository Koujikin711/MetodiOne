from decimal import Decimal

from pydantic import BaseModel, Field


class QuoteComputeBody(BaseModel):
    sales_item_ids: list[str] = Field(default_factory=list)
    accounting_enabled: bool = False
    accounting_extra_ids: list[str] = Field(default_factory=list)
    production_enabled: bool = False
    reports_enabled: bool = False
    service_ids: list[str] = Field(default_factory=list)


class QuoteLineOut(BaseModel):
    module: str
    title: str
    items: list[str]
    amount: float


class QuoteComputeOut(BaseModel):
    ok: bool
    errors: list[str] = Field(default_factory=list)
    currency: str = "TJS"
    total: float = 0
    lines: list[QuoteLineOut] = Field(default_factory=list)
    summary_text: str = ""


class QuoteCommitBody(QuoteComputeBody):
    client_name: str = Field(..., min_length=1, max_length=255)
    client_phone: str = Field(..., min_length=5, max_length=64)
    activity_sphere: str = Field(default="CRM модули", max_length=255)
    paid_amount: Decimal = Field(default=Decimal("0"), ge=0)
    pipeline_id: int | None = Field(default=None, ge=1)
