from datetime import datetime
from decimal import Decimal
from typing import Literal

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
    specialist_ids: list[int] = Field(default_factory=list)
    sort_order: int = Field(default=0, ge=0)


class SalesKpiWeightedPlanPut(BaseModel):
    pipeline_id: int = Field(..., ge=1)
    year_month: str = Field(..., description="YYYY-MM")
    bonus_fund: Decimal = Field(default=Decimal("10000"), ge=0)
    items: list[SalesKpiPlanItemWrite] = Field(default_factory=list)
    prices: list[SalesKpiPriceWrite] = Field(default_factory=list)


class SalesKpiSpecialistMeta(BaseModel):
    id: int
    full_name: str
    direction_id: int
    direction_name: str | None = None
    is_active: bool = True


class SalesKpiPlanItemOut(BaseModel):
    id: int
    name: str
    plan_qty: int
    weight_percent: Decimal
    source_type: str
    direction_id: int | None = None
    specialist_ids: list[int] = Field(default_factory=list)
    sort_order: int = 0


class SalesKpiWeightedPlanOut(BaseModel):
    pipeline_id: int
    pipeline_name: str
    year_month: str
    bonus_fund: Decimal
    items: list[SalesKpiPlanItemOut]
    directions: list[SalesKpiDirectionMeta]
    specialists: list[SalesKpiSpecialistMeta] = Field(default_factory=list)
    managers: list[dict]


class SalesKpiBoardLine(BaseModel):
    plan_item_id: int
    name: str
    source_type: str
    direction_id: int | None = None
    specialist_ids: list[int] = Field(default_factory=list)
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
    stream_no: int = Field(..., ge=1, le=10, description="Номер потока (Поток 1…10)")
    group_no: int = Field(..., ge=1, le=20, description="Номер группы (Группа 1…20)")
    service_amount: Decimal = Field(..., gt=0)
    paid_amount: Decimal = Field(default=Decimal("0"), ge=0)
    sold_at: datetime | None = None
    note: str | None = None


class SalesKpiManualSalePaymentPatch(BaseModel):
    """Доплата по курсу/протоколу (не перезапись итога)."""

    add_amount: Decimal = Field(..., gt=0, description="Сумма доплаты")
    note: str | None = None


class SalesKpiManualSalePaymentOut(BaseModel):
    id: int
    amount: Decimal
    is_first: bool
    note: str | None = None
    paid_at: datetime


class SalesKpiManualSaleStatusPatch(BaseModel):
    """Закрытие курса/протокола администратором: отказ или завершён."""

    status: Literal["refused", "completed"]
    reason: str = Field(..., min_length=1, max_length=2000)


class SalesKpiManualSaleOut(BaseModel):
    id: int
    pipeline_id: int
    plan_item_id: int
    plan_item_name: str
    manager_user_id: int
    manager_name: str
    client_name: str
    client_phone: str
    stream_no: int | None = None
    group_no: int | None = None
    service_amount: Decimal
    paid_amount: Decimal
    first_paid_amount: Decimal = Decimal("0")
    debt_amount: Decimal
    sold_at: datetime
    status: str
    returned_at: datetime | None = None
    note: str | None = None
    status_reason: str | None = None
    counts_in_kpi: bool
    payments: list[SalesKpiManualSalePaymentOut] = Field(default_factory=list)

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


class SalesKpiCompanyPlanLine(BaseModel):
    plan_item_id: int
    name: str
    source_type: str
    plan_qty: int
    weight_percent: Decimal
    fact_qty: int
    completion: float | None = None
    contribution: Decimal


class SalesKpiCompanyExpertStat(BaseModel):
    specialist_id: int
    specialist_name: str
    direction_id: int | None = None
    direction_name: str | None = None
    kpi_service_name: str | None = None
    appointments_total: int
    appeared_count: int  # status=completed
    booked_future_count: int
    no_show_count: int
    cancelled_count: int
    revenue_paid: Decimal  # все оплаты по строке (частичные + полные)
    paid_full_amount: Decimal = Decimal("0")  # оплатили полностью и явились
    paid_no_show_amount: Decimal = Decimal("0")  # оплатили, но не явились
    debtor_amount: Decimal
    creditor_amount: Decimal  # оплачено, визит ещё в будущем


class SalesKpiCompanyServiceStat(BaseModel):
    """Итог по услуге (направлению) за месяц — отдельно от экспертов."""

    direction_id: int | None = None
    direction_name: str
    appointments_total: int
    appeared_count: int
    no_show_count: int
    booked_count: int = 0
    cancelled_count: int = 0
    revenue_paid: Decimal
    paid_full_amount: Decimal = Decimal("0")
    paid_no_show_amount: Decimal = Decimal("0")
    debtor_amount: Decimal = Decimal("0")
    creditor_amount: Decimal = Decimal("0")


class SalesKpiCompanyReport(BaseModel):
    pipeline_id: int
    pipeline_name: str
    year_month: str
    # Общий % выполнения плана компании (взвешенный вклад по сумме фактов всех менеджеров)
    plan_completion_percent: float
    total_contribution: Decimal
    revenue_total: Decimal = Field(
        description=(
            "Clinic: = revenue_booking (visit payments). Manual courses are not added "
            "(would double-count with visit paid_amount). Sales-mode: desk + manual."
        ),
    )
    revenue_booking: Decimal
    revenue_manual: Decimal = Field(
        description="Course/protocol KPI payments in month (reference; not in clinic revenue_total).",
    )
    debtor_total: Decimal
    debtor_booking: Decimal
    debtor_manual: Decimal
    creditor_total: Decimal  # предоплата за будущие визиты
    plan_lines: list[SalesKpiCompanyPlanLine]
    # Сводка по эксперту (все услуги эксперта вместе)
    expert_stats: list[SalesKpiCompanyExpertStat]
    # Отдельная таблица: Курс / Курс 15 / Протокол / … по всей клинике
    service_stats: list[SalesKpiCompanyServiceStat] = []
    managers_sales_bonus_total: Decimal
    # Шкала / прогноз
    days_elapsed: int = 0
    days_in_month: int = 0
    month_progress_percent: float = 0
    revenue_at_plan_10_percent: Decimal | None = None
    revenue_at_plan_25_percent: Decimal | None = None
    revenue_at_plan_50_percent: Decimal | None = None
    revenue_at_plan_100_percent: Decimal | None = None
    forecast_plan_completion_percent: float | None = None
    forecast_revenue: Decimal | None = None
    forecast_note: str = ""
