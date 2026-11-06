"""Схемы ЭМК: только клиника, без сумм и оплат."""

from __future__ import annotations

from datetime import date, datetime

from pydantic import BaseModel, ConfigDict, Field


class EmrSearchItem(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    lead_id: int
    name: str
    phone: str | None = None
    birth_date: date | None = None
    manager_name: str | None = None


class EmrServiceChip(BaseModel):
    key: str
    label: str
    count: int


class EmrVisit(BaseModel):
    appointment_id: int
    start_at: datetime
    status: str
    status_code: str
    service_title: str
    direction_name: str | None = None
    specialist_name: str | None = None
    comment: str | None = None
    kind: str = "visit"  # visit | diag | proc | course


class EmrComplaintPoint(BaseModel):
    at: date
    category: str
    label: str
    value: str | None = None


class EmrTodo(BaseModel):
    text: str
    at: date | None = None


class EmrJourney(BaseModel):
    course_15_status: str = "none"
    course_15_started_at: datetime | None = None
    course_15_completed_at: datetime | None = None
    branch: str = "none"
    membership_flow: str | None = None
    membership_joined_on: date | None = None


class EmrDocument(BaseModel):
    title: str
    source: str
    at: datetime | None = None
    href: str | None = None


class EmrDiagnosisUpdate(BaseModel):
    diagnosis: str | None = None


class EmrBirthUpdate(BaseModel):
    birth_date: date | None = None


class EmrChart(BaseModel):
    lead_id: int
    name: str
    phone: str | None = None
    birth_date: date | None = None
    age_label: str | None = None
    birth_from_booking: bool = False
    stage_name: str | None = None
    manager_name: str | None = None
    first_visit_at: datetime | None = None
    attending_doctor: str | None = None
    diagnosis: str | None = None
    warning: str | None = None
    service_chips: list[EmrServiceChip] = Field(default_factory=list)
    visits: list[EmrVisit] = Field(default_factory=list)
    journey: EmrJourney = Field(default_factory=EmrJourney)
    dynamics: list[EmrComplaintPoint] = Field(default_factory=list)
    todos: list[EmrTodo] = Field(default_factory=list)
    stages: list[str] = Field(default_factory=list)
    current_stage: str | None = None
    documents: list[EmrDocument] = Field(default_factory=list)
