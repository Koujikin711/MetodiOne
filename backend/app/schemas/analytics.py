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


class StageConversionItem(BaseModel):
    stage_id: int
    stage_name: str
    order: int = 0
    leads_count: int = 0
    conversion_to_next_pct: float | None = None
    avg_time_in_stage_hours: float | None = None


class SourceAnalyticsItem(BaseModel):
    source: str
    leads_count: int = 0
    sold_amount: Decimal = Field(default=Decimal("0"))
    paid_amount: Decimal = Field(default=Decimal("0"))
    unpaid_amount: Decimal = Field(default=Decimal("0"))
    lead_share_pct: float = 0


class LossReasonItem(BaseModel):
    reason: str
    count: int = 0
    share_pct: float = 0


class ManagerPlanFactItem(BaseModel):
    manager_id: int | None = None
    manager_name: str = "Без менеджера"
    plan_amount: Decimal = Field(default=Decimal("0"))
    fact_paid_amount: Decimal = Field(default=Decimal("0"))
    plan_completion_pct: float = 0


class AnalyticsAlertsRead(BaseModel):
    low_first_response: bool = False
    high_unpaid_share: bool = False
    low_stage_conversion: bool = False
    summary: list[str] = Field(default_factory=list)


class ExecutiveKpiRead(BaseModel):
    leads_total: int = 0
    won_leads: int = 0
    win_rate_pct: float = 0
    paid_amount: Decimal = Field(default=Decimal("0"))
    unpaid_amount: Decimal = Field(default=Decimal("0"))
    avg_first_response_minutes: float | None = None
    avg_lead_cycle_hours: float | None = None


class AnalyticsOverviewRead(BaseModel):
    period_start: str
    period_end: str
    executive: ExecutiveKpiRead
    stage_conversion: list[StageConversionItem] = Field(default_factory=list)
    by_source: list[SourceAnalyticsItem] = Field(default_factory=list)
    loss_reasons: list[LossReasonItem] = Field(default_factory=list)
    manager_plan_fact: list[ManagerPlanFactItem] = Field(default_factory=list)
    alerts: AnalyticsAlertsRead
