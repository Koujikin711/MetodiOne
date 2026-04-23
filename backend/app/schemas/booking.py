from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field, field_validator, model_validator


# Сетка календаря 07:00–20:00 (совпадает с фронтом)
BOOKING_GRID_START_HOUR = 7
BOOKING_GRID_END_HOUR = 20


class BookingDirectionRead(BaseModel):
    id: int
    name: str
    duration_min: int
    is_active: bool
    pipeline_id: int | None = None
    pipeline_name: str | None = None

    model_config = {"from_attributes": True}


class BookingDirectionCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=255)
    duration_min: int = Field(30, ge=10, le=480)
    pipeline_id: int = Field(..., ge=1)


class BookingDirectionUpdate(BaseModel):
    name: str | None = Field(None, min_length=1, max_length=255)
    duration_min: int | None = Field(None, ge=10, le=480)
    pipeline_id: int | None = Field(None, ge=1)
    is_active: bool | None = None


class BookingSpecialistRead(BaseModel):
    id: int
    full_name: str
    direction_id: int
    direction_name: str | None = None
    phone: str | None
    specialization: str | None = None
    is_active: bool
    sort_order: int = 0
    slot_duration_min: int = 30
    work_start_hour: int = 9
    work_end_hour: int = 18
    work_weekdays: list[int] = Field(default_factory=lambda: [0, 1, 2, 3, 4])

    model_config = {"from_attributes": True}


class BookingSpecialistCreate(BaseModel):
    full_name: str = Field(..., min_length=1, max_length=255)
    direction_id: int = Field(..., ge=1)
    phone: str | None = Field(None, max_length=64)
    specialization: str | None = Field(None, max_length=255)
    slot_duration_min: int = Field(30, ge=15, le=240)
    work_start_hour: int = Field(9, ge=BOOKING_GRID_START_HOUR, le=BOOKING_GRID_END_HOUR - 1)
    work_end_hour: int = Field(18, ge=BOOKING_GRID_START_HOUR + 1, le=BOOKING_GRID_END_HOUR)
    work_weekdays: list[int] = Field(
        default_factory=lambda: [0, 1, 2, 3, 4],
        description="0=Пн … 6=Вс (как datetime.weekday() в Python)",
    )

    @field_validator("work_weekdays")
    @classmethod
    def validate_weekdays(cls, v: list[int]) -> list[int]:
        if not v:
            raise ValueError("Укажите хотя бы один рабочий день")
        for x in v:
            if x < 0 or x > 6:
                raise ValueError("День недели: целое от 0 (пн) до 6 (вс)")
        return sorted(set(v))

    @model_validator(mode="after")
    def validate_hours(self) -> "BookingSpecialistCreate":
        if self.work_start_hour >= self.work_end_hour:
            raise ValueError("Конец приёма должен быть позже начала")
        return self


class BookingSpecialistUpdate(BaseModel):
    full_name: str | None = Field(None, min_length=1, max_length=255)
    direction_id: int | None = Field(None, ge=1)
    phone: str | None = Field(None, max_length=64)
    specialization: str | None = Field(None, max_length=255)
    slot_duration_min: int | None = Field(None, ge=15, le=240)
    work_start_hour: int | None = Field(None, ge=BOOKING_GRID_START_HOUR, le=BOOKING_GRID_END_HOUR - 1)
    work_end_hour: int | None = Field(None, ge=BOOKING_GRID_START_HOUR + 1, le=BOOKING_GRID_END_HOUR)
    work_weekdays: list[int] | None = None

    @field_validator("work_weekdays")
    @classmethod
    def validate_weekdays(cls, v: list[int] | None) -> list[int] | None:
        if v is None:
            return v
        if not v:
            raise ValueError("Укажите хотя бы один рабочий день")
        for x in v:
            if x < 0 or x > 6:
                raise ValueError("День недели: целое от 0 (пн) до 6 (вс)")
        return sorted(set(v))


class SpecialistReorderBody(BaseModel):
    ordered_ids: list[int] = Field(..., min_length=1)


class BookingAppointmentRead(BaseModel):
    id: int
    lead_id: int | None
    specialist_id: int
    direction_id: int
    patient_name: str
    patient_phone: str
    start_at: datetime
    end_at: datetime
    status: str
    service_amount: float = 0
    paid_amount: float = 0
    responsible_manager_id: int | None
    direction_name: str | None = None
    specialist_name: str | None = None
    comment: str | None
    can_manage_journal: bool = Field(
        default=False,
        description="Владелец или админ воронки лида — оплата/удаление в журнале записей",
    )

    model_config = {"from_attributes": True}


class BookingAppointmentCreate(BaseModel):
    patient_name: str = Field(..., min_length=1, max_length=255)
    patient_phone: str = Field(..., min_length=3, max_length=64)
    lead_id: int | None = Field(None, ge=1)
    lead_pipeline_id: int | None = Field(None, ge=1)
    lead_stage_id: int | None = Field(None, ge=1)
    direction_id: int = Field(..., ge=1)
    specialist_id: int = Field(..., ge=1)
    start_at: datetime
    service_amount: float = Field(..., ge=0)
    paid_amount: float = Field(..., ge=0)
    responsible_manager_id: int | None = None
    comment: str | None = Field(None, max_length=2000)

    @model_validator(mode="after")
    def validate_money(self) -> "BookingAppointmentCreate":
        if self.paid_amount > self.service_amount:
            raise ValueError("Оплаченная сумма не может быть больше стоимости услуги")
        return self


class BookingAppointmentStatusUpdate(BaseModel):
    status: Literal["booked", "completed", "no_show", "cancelled"]


class BookingAppointmentMove(BaseModel):
    specialist_id: int = Field(..., ge=1)
    start_at: datetime


class BookingAppointmentPaymentUpdate(BaseModel):
    paid_amount: float = Field(..., ge=0)
