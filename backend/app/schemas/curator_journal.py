"""Schemas: журнал куратора / табель потока."""

from __future__ import annotations

from datetime import date, datetime
from decimal import Decimal
from typing import Literal

from pydantic import BaseModel, Field, field_validator

DiaryStatus = Literal["pending", "done", "missed"]
PhotoStatus = Literal["pending", "done", "missed"]
ComplaintStatus = Literal["pending", "no_complaint", "complaint"]

ComplaintCategory = Literal[
    "temperature",
    "vomiting",
    "stool",
    "sleep",
    "nutrition",
    "medication",
    "recommendations",
    "weight",
    "pain",
    "rash_or_allergy",
    "other",
]

COMPLAINT_CATEGORIES: tuple[str, ...] = (
    "temperature",
    "vomiting",
    "stool",
    "sleep",
    "nutrition",
    "medication",
    "recommendations",
    "weight",
    "pain",
    "rash_or_allergy",
    "other",
)


class CuratorFlowCreate(BaseModel):
    course_name: str = Field(min_length=1, max_length=255, default="Основной курс")
    flow_number: int = Field(ge=1, le=999, default=1)
    title: str | None = Field(default=None, max_length=255)
    starts_on: date
    ends_on: date
    curator_user_id: int | None = None
    kpi_group_no: int | None = Field(default=None, ge=1, le=20)
    pipeline_id: int | None = None

    @field_validator("ends_on")
    @classmethod
    def ends_after_starts(cls, v: date, info: object) -> date:
        data = getattr(info, "data", {}) or {}
        starts = data.get("starts_on") if isinstance(data, dict) else None
        if starts is not None and v < starts:
            raise ValueError("ends_on должен быть >= starts_on")
        return v


class CuratorFlowUpdate(BaseModel):
    course_name: str | None = Field(default=None, min_length=1, max_length=255)
    flow_number: int | None = Field(default=None, ge=1, le=999)
    title: str | None = Field(default=None, max_length=255)
    starts_on: date | None = None
    ends_on: date | None = None
    curator_user_id: int | None = None
    kpi_group_no: int | None = Field(default=None, ge=1, le=20)
    status: Literal["active", "archived"] | None = None
    pipeline_id: int | None = None


class CuratorFlowOut(BaseModel):
    id: int
    company_id: int
    pipeline_id: int | None
    course_name: str
    flow_number: int
    title: str | None
    starts_on: date
    ends_on: date
    curator_user_id: int | None
    curator_name: str | None = None
    kpi_group_no: int | None
    status: str
    participants_count: int = 0
    created_at: datetime | None = None
    updated_at: datetime | None = None


class MembershipCreate(BaseModel):
    display_name: str = Field(min_length=1, max_length=255)
    phone: str | None = Field(default=None, max_length=64)
    lead_id: int | None = None
    joined_on: date | None = None


class MembershipTransfer(BaseModel):
    target_flow_id: int
    left_on: date | None = None
    joined_on: date | None = None


class MembershipOut(BaseModel):
    id: int
    flow_id: int
    lead_id: int | None
    display_name: str
    phone: str | None
    joined_on: date
    left_on: date | None
    source: str
    kpi_sale_id: int | None = None
    is_active: bool = True
    # Phase 8E — Course 90-day program period (derived; no Booking-as-end)
    program_started_on: date | None = None
    program_expected_end_on: date | None = None
    program_days_remaining: int | None = None
    program_day_index: int | None = None
    program_duration_days: int | None = None
    program_status: str | None = None
    program_start_source: str | None = None
    program_purchase_id: int | None = None


class ComplaintIn(BaseModel):
    category: ComplaintCategory
    comment: str | None = Field(default=None, max_length=2000)
    numeric_value: Decimal | None = None
    unit: str | None = Field(default=None, max_length=16)
    count_value: int | None = Field(default=None, ge=0, le=100)


class ComplaintOut(BaseModel):
    id: int
    category: str
    comment: str | None
    numeric_value: Decimal | None
    unit: str | None
    count_value: int | None


class EntryUpsert(BaseModel):
    membership_id: int
    entry_date: date
    diary_status: DiaryStatus | None = None
    photo_status: PhotoStatus | None = None
    complaint_status: ComplaintStatus | None = None
    complaint_general_comment: str | None = Field(default=None, max_length=4000)
    complaints: list[ComplaintIn] | None = None


class JournalEntryOut(BaseModel):
    id: int
    membership_id: int
    entry_date: date
    diary_status: str
    photo_status: str
    complaint_status: str
    complaint_general_comment: str | None
    complaints: list[ComplaintOut] = Field(default_factory=list)


class MonthJournalOut(BaseModel):
    flow: CuratorFlowOut
    year: int
    month: int
    days: list[date]
    participants: list[MembershipOut]
    entries: list[JournalEntryOut]
    program_duration_days: int = 90
    program_ending_soon_days: int = 14
    program_counts: dict[str, int] = Field(default_factory=dict)


class DaySummaryOut(BaseModel):
    date: date
    participants_total: int
    diary_done: int
    diary_missed: int
    diary_pending: int
    photo_done: int
    photo_missed: int
    photo_pending: int
    with_complaints: int
    not_filled: int
    diary_percent: float
    photo_percent: float
    complaint_counts: dict[str, int]


class ComplaintsReportItem(BaseModel):
    membership_id: int
    display_name: str
    entry_date: date
    complaints: list[ComplaintOut]
    general_comment: str | None = None


class ComplaintsReportOut(BaseModel):
    date_from: date
    date_to: date
    patients_with_complaints: int
    category_totals: dict[str, int]
    items: list[ComplaintsReportItem]


class RecurringComplaintOut(BaseModel):
    category: str
    days_count: int


class MemberHistoryOut(BaseModel):
    membership: MembershipOut
    flow_number: int
    course_name: str
    year: int | None
    month: int | None
    diary_done: int
    diary_total_days: int
    photo_done: int
    photo_total_days: int
    complaint_days: int
    entries: list[JournalEntryOut]
    recurring: list[RecurringComplaintOut]


class ImportKpiBody(BaseModel):
    group_no: int = Field(ge=1, le=20)
    plan_item_id: int | None = None
    only_active: bool = True


class ImportLeadsBody(BaseModel):
    lead_ids: list[int] = Field(min_length=1)
    joined_on: date | None = None


class ImportResultOut(BaseModel):
    added: int
    skipped: int
    memberships: list[MembershipOut]


class CuratorUserOut(BaseModel):
    id: int
    full_name: str
    role: str


class KpiImportPreviewRow(BaseModel):
    sale_id: int
    client_name: str
    client_phone: str
    group_no: int | None
    plan_item_name: str | None
    status: str


class KpiImportPreviewOut(BaseModel):
    group_no: int
    rows: list[KpiImportPreviewRow]


class Course15QueueRowOut(BaseModel):
    lead_id: int
    patient_name: str
    patient_phone: str | None = None
    product_label: str
    state: str
    state_label: str
    started_at: datetime | None = None
    ended_at: datetime | None = None
    manager_name: str | None = None
    responsible_name: str | None = None
    last_contact_at: datetime | None = None
    next_contact_at: datetime | None = None
    next_step: str
    requires_attention: bool
    attention_reason: str | None = None
    anchor_purchase_id: int | None = None
    next_program_kind: str | None = None


class Course15QueueOut(BaseModel):
    predicate: str
    include_converted: bool
    note: str
    counts: dict[str, int]
    rows: list[Course15QueueRowOut]


class ProtocolQueuePreviousOut(BaseModel):
    sequence_no: int
    purchase_id: int
    started_at: datetime | None = None
    expected_end_at: datetime | None = None
    product_name: str | None = None


class ProtocolQueueRowOut(BaseModel):
    lead_id: int
    patient_name: str
    patient_phone: str | None = None
    product_label: str
    sequence_no: int
    protocols_count: int
    state: str
    state_label: str
    started_at: datetime | None = None
    expected_end_at: datetime | None = None
    days_remaining: int
    previous_protocols_label: str
    previous_protocols: list[ProtocolQueuePreviousOut] = Field(default_factory=list)
    manager_name: str | None = None
    responsible_name: str | None = None
    last_contact_at: datetime | None = None
    next_contact_at: datetime | None = None
    next_sale_status: str
    requires_attention: bool
    attention_reason: str | None = None
    purchase_id: int | None = None


class ProtocolQueueOut(BaseModel):
    predicate: str
    duration_days: int
    ending_soon_days: int
    include_converted: bool
    note: str
    counts: dict[str, int]
    rows: list[ProtocolQueueRowOut]
