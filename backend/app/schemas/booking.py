from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field


class BookingDirectionRead(BaseModel):
    id: int
    name: str
    duration_min: int
    is_active: bool

    model_config = {"from_attributes": True}


class BookingDirectionCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=255)
    duration_min: int = Field(30, ge=10, le=480)


class BookingSpecialistRead(BaseModel):
    id: int
    full_name: str
    direction_id: int
    direction_name: str | None = None
    phone: str | None
    specialization: str | None = None
    is_active: bool

    model_config = {"from_attributes": True}


class BookingSpecialistCreate(BaseModel):
    full_name: str = Field(..., min_length=1, max_length=255)
    direction_id: int = Field(..., ge=1)
    phone: str | None = Field(None, max_length=64)
    specialization: str | None = Field(None, max_length=255)


class BookingSpecialistUpdate(BaseModel):
    full_name: str | None = Field(None, min_length=1, max_length=255)
    direction_id: int | None = Field(None, ge=1)
    phone: str | None = Field(None, max_length=64)
    specialization: str | None = Field(None, max_length=255)


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
    responsible_manager_id: int | None
    direction_name: str | None = None
    specialist_name: str | None = None
    comment: str | None

    model_config = {"from_attributes": True}


class BookingAppointmentCreate(BaseModel):
    patient_name: str = Field(..., min_length=1, max_length=255)
    patient_phone: str = Field(..., min_length=3, max_length=64)
    lead_id: int | None = Field(None, ge=1)
    direction_id: int = Field(..., ge=1)
    specialist_id: int = Field(..., ge=1)
    start_at: datetime
    responsible_manager_id: int | None = None
    comment: str | None = Field(None, max_length=2000)


class BookingAppointmentStatusUpdate(BaseModel):
    status: Literal["booked", "completed", "no_show", "cancelled"]
