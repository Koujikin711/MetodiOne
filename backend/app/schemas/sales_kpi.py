from decimal import Decimal

from pydantic import BaseModel, Field


class SalesKpiPlanRowWrite(BaseModel):
    manager_user_id: int = Field(..., ge=1)
    plan_amount: Decimal = Field(default=Decimal("0"), ge=0)


class SalesKpiPlansPut(BaseModel):
    pipeline_id: int = Field(..., ge=1)
    year_month: str = Field(..., description="YYYY-MM")
    plans: list[SalesKpiPlanRowWrite] = Field(default_factory=list)


class SalesKpiPipelineMeta(BaseModel):
    id: int
    name: str
    expert_user_id: int | None = None
    expert_name: str | None = None


class SalesKpiServiceSlice(BaseModel):
    direction_id: int
    direction_name: str
    paid_amount: Decimal
    percent_of_plan: float | None = Field(None, description="Доля плана менеджера, закрытая этой услугой, %")


class SalesKpiManagerOwnerRow(BaseModel):
    manager_id: int
    manager_name: str
    plan_amount: Decimal
    actual_paid: Decimal
    month_progress_percent: float | None = Field(None, description="Факт / план за месяц, %")
    linear_target_to_date: Decimal
    pace_percent: float | None = Field(None, description="Факт / линейный план на сегодня, %")
    by_service: list[SalesKpiServiceSlice]


class SalesKpiOwnerDashboard(BaseModel):
    pipeline_id: int
    pipeline_name: str
    expert_user_id: int | None = None
    expert_name: str | None = None
    year_month: str
    days_in_month: int
    elapsed_days_for_pacing: int
    managers: list[SalesKpiManagerOwnerRow]


class SalesKpiManagerSnapshot(BaseModel):
    pipeline_id: int
    pipeline_name: str
    expert_user_id: int | None = None
    expert_name: str | None = None
    year_month: str
    days_in_month: int
    elapsed_days_for_pacing: int
    daily_plan: Decimal
    plan_amount: Decimal | None = None
    actual_paid: Decimal
    month_progress_percent: float | None = None
    linear_target_to_date: Decimal
    pace_percent: float | None = None
