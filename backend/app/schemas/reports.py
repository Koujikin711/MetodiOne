from decimal import Decimal

from pydantic import BaseModel, Field


class ExpertSalesItem(BaseModel):
    specialist_id: int
    specialist_name: str
    specialization: str | None = None
    appointments_completed: int = 0
    patients_count: int = 0
    paid_amount_sum: Decimal = Field(default=Decimal("0"))


class PipelineExpertReport(BaseModel):
    pipeline_id: int
    pipeline_name: str
    leads_created: int = 0
    leads_opened_by_managers: int = 0
    sales_by_expert: list[ExpertSalesItem] = Field(default_factory=list)


class ExpertReportsResponse(BaseModel):
    period_start: str
    period_end: str
    items: list[PipelineExpertReport] = Field(default_factory=list)

