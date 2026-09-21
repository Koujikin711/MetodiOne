"""Схемы кабинета РОП (руководитель отдела продаж)."""

from __future__ import annotations

from datetime import date, datetime
from decimal import Decimal

from pydantic import BaseModel, Field


class RopManagerPresence(BaseModel):
    user_id: int
    full_name: str
    email: str
    is_online: bool
    last_seen_at: datetime | None = None
    accepts_new_leads: bool = True
    active_leads: int = 0
    new_leads_today: int = 0
    bookings_today: int = 0
    revenue_today: Decimal = Decimal("0")


class RopDashboard(BaseModel):
    pipeline_id: int
    pipeline_name: str
    date: date
    online_count: int
    managers: list[RopManagerPresence]


class RopStageCount(BaseModel):
    stage_id: int
    stage_name: str
    count: int


class RopDayCloseManager(BaseModel):
    user_id: int
    full_name: str
    replied_leads: int = 0
    unreplied_active: int = 0
    stages: list[RopStageCount] = Field(default_factory=list)
    bookings_today: int = 0
    revenue_today: Decimal = Decimal("0")


class RopDayClose(BaseModel):
    pipeline_id: int
    pipeline_name: str
    date: date
    managers: list[RopDayCloseManager]


class RopStatsStage(BaseModel):
    stage_id: int
    stage_name: str
    count: int
    percent: float


class RopStatsManager(BaseModel):
    user_id: int
    full_name: str
    leads_in: int
    processed: int
    conversion_percent: float
    stages: list[RopStatsStage] = Field(default_factory=list)


class RopStatsReport(BaseModel):
    pipeline_id: int
    pipeline_name: str
    date_from: date
    date_to: date
    managers: list[RopStatsManager]


class RopManagerRow(BaseModel):
    user_id: int
    full_name: str
    email: str
    accepts_new_leads: bool
    lead_count: int = 0
    is_online: bool = False
    last_seen_at: datetime | None = None


class RopManagersList(BaseModel):
    pipeline_id: int
    managers: list[RopManagerRow]


class RopAcceptsLeadsPatch(BaseModel):
    accepts_new_leads: bool


class RopLeadTransferBody(BaseModel):
    lead_id: int = Field(..., ge=1)
    to_manager_id: int = Field(..., ge=1)


class RopLeadTransferResult(BaseModel):
    lead_id: int
    from_manager_id: int | None
    to_manager_id: int


class RopBulkTransferBody(BaseModel):
    from_manager_id: int = Field(..., ge=1)
    to_manager_ids: list[int] = Field(..., min_length=1)


class RopBulkTransferResult(BaseModel):
    total: int
    reassigned: int
    per_manager: dict[int, int] = Field(default_factory=dict)


class RopAnalyticsManagerSla(BaseModel):
    user_id: int
    full_name: str
    avg_first_response_minutes: float | None = None
    leads_count: int = 0


class RopRevenueShare(BaseModel):
    manager_id: int
    manager_name: str
    service_name: str
    amount: Decimal
    percent_of_total: float
    sold_amount: Decimal = Decimal("0")
    paid_amount: Decimal = Decimal("0")
    full_paid_amount: Decimal = Decimal("0")
    sold_count: int = 0
    full_paid_count: int = 0


class RopAnalyticsReport(BaseModel):
    pipeline_id: int
    pipeline_name: str
    date_from: date
    date_to: date
    avg_first_response_minutes: float | None = None
    managers_sla: list[RopAnalyticsManagerSla] = Field(default_factory=list)
    revenue_shares: list[RopRevenueShare] = Field(default_factory=list)
    revenue_total: Decimal = Decimal("0")


class RopReportCell(BaseModel):
    manager_id: int
    manager_name: str
    service_name: str
    amount: Decimal
    sold_amount: Decimal = Decimal("0")
    paid_amount: Decimal = Decimal("0")
    full_paid_amount: Decimal = Decimal("0")
    sold_count: int = 0
    full_paid_count: int = 0


class RopRevenueReport(BaseModel):
    pipeline_id: int
    pipeline_name: str
    date_from: date
    date_to: date
    rows: list[RopReportCell] = Field(default_factory=list)
    total: Decimal = Decimal("0")
    sold_total: Decimal = Decimal("0")
    full_paid_total: Decimal = Decimal("0")


class RopLeadMatch(BaseModel):
    lead_id: int
    name: str
    phone: str | None = None
    manager_id: int | None = None
    manager_name: str | None = None


class RopSearchVisit(BaseModel):
    appointment_id: int
    start_at: datetime
    specialist_name: str | None = None
    status: str
    service_title: str | None = None
    service_amount: float = 0
    paid_amount: float = 0
    responsible_manager_id: int | None = None
    responsible_manager_name: str | None = None


class RopSearchPatient(BaseModel):
    patient_name: str
    patient_phone: str
    total_visits: int = 0
    first_visit_at: datetime | None = None
    last_visit_at: datetime | None = None
    visits: list[RopSearchVisit] = Field(default_factory=list)
