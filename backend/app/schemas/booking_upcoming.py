"""Схемы отчёта «будущая загрузка по услугам» (Online Booking)."""

from __future__ import annotations

from datetime import datetime
from decimal import Decimal
from typing import Literal

from pydantic import BaseModel, Field

PeriodKey = Literal["today", "tomorrow", "next_7_days", "next_30_days"]


class UpcomingServicesTodayBreakdown(BaseModel):
    total_load: int = 0
    booked: int = 0
    completed: int = 0
    no_show: int = 0
    cancelled: int = 0


class UpcomingServicesSummary(BaseModel):
    today: int = 0
    tomorrow: int = 0
    next_7_days: int = 0
    next_30_days: int = 0
    today_unique_patients: int = 0
    tomorrow_unique_patients: int = 0
    next_7_days_unique_patients: int = 0
    next_30_days_unique_patients: int = 0
    today_breakdown: UpcomingServicesTodayBreakdown = Field(
        default_factory=UpcomingServicesTodayBreakdown,
    )


class UpcomingServicesServiceRow(BaseModel):
    direction_id: int
    direction_name: str
    today_appointments: int = 0
    today_unique_patients: int = 0
    tomorrow_appointments: int = 0
    tomorrow_unique_patients: int = 0
    next_7_days_appointments: int = 0
    next_7_days_unique_patients: int = 0
    next_30_days_appointments: int = 0
    next_30_days_unique_patients: int = 0


class UpcomingServicesReport(BaseModel):
    timezone: str
    today_ymd: str
    tomorrow_ymd: str
    next_7_days_from: str
    next_7_days_to: str
    next_30_days_from: str
    next_30_days_to: str
    summary: UpcomingServicesSummary
    services: list[UpcomingServicesServiceRow] = Field(default_factory=list)


class UpcomingServicesDailyBucket(BaseModel):
    date_ymd: str
    appointments: int = 0


class UpcomingServicesDrillRow(BaseModel):
    id: int
    start_at: datetime
    date_ymd: str
    time_label: str
    patient_name: str
    patient_phone: str
    lead_id: int | None = None
    direction_id: int
    direction_name: str
    specialist_id: int
    specialist_name: str | None = None
    responsible_manager_id: int | None = None
    manager_name: str | None = None
    status: str
    service_amount: Decimal = Decimal("0")
    paid_amount: Decimal = Decimal("0")
    remainder_amount: Decimal = Decimal("0")


class UpcomingServicesDrillDown(BaseModel):
    period: PeriodKey
    direction_id: int | None = None
    direction_name: str | None = None
    from_ymd: str
    to_ymd: str
    appointments_total: int
    unique_patients: int
    page: int
    page_size: int
    daily: list[UpcomingServicesDailyBucket] = Field(default_factory=list)
    rows: list[UpcomingServicesDrillRow] = Field(default_factory=list)
