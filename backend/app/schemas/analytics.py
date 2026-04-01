from decimal import Decimal

from pydantic import BaseModel, Field


class PipelineFullAnalyticsItem(BaseModel):
    pipeline_id: int | None = None
    pipeline_name: str = "Без воронки"
    leads_count: int = 0
    processed_by_manager_count: int = 0
    received_amount: Decimal = Field(default=Decimal("0"))
    debt_amount: Decimal = Field(default=Decimal("0"))


class FullAnalyticsRead(BaseModel):
    total_leads: int = 0
    total_received_amount: Decimal = Field(default=Decimal("0"))
    total_debt_amount: Decimal = Field(default=Decimal("0"))
    by_pipeline: list[PipelineFullAnalyticsItem] = Field(default_factory=list)


class ManagerDetailedAnalyticsItem(BaseModel):
    manager_id: int | None = None
    manager_name: str = "Без менеджера"
    leads_count: int = 0
    sold_amount: Decimal = Field(default=Decimal("0"))
    unpaid_amount: Decimal = Field(default=Decimal("0"))


class DetailedAnalyticsRead(BaseModel):
    total_leads: int = 0
    total_sold_amount: Decimal = Field(default=Decimal("0"))
    total_unpaid_amount: Decimal = Field(default=Decimal("0"))
    by_manager: list[ManagerDetailedAnalyticsItem] = Field(default_factory=list)


class CustomerValueRead(BaseModel):
    customer_id: int
    value: Decimal = Field(default=Decimal("0"), description="Lifetime Value = сумма покупок по клиенту")
