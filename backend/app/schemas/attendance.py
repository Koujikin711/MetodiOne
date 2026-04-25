from datetime import date, datetime

from pydantic import BaseModel, Field


class AttendanceGeofenceCreate(BaseModel):
    name: str = Field(..., min_length=2, max_length=255)
    address: str | None = Field(default=None, max_length=500)
    latitude: float = Field(..., ge=-90, le=90)
    longitude: float = Field(..., ge=-180, le=180)
    radius_m: int = Field(default=120, ge=30, le=5000)
    is_active: bool = True


class AttendanceGeofenceUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=2, max_length=255)
    address: str | None = Field(default=None, max_length=500)
    latitude: float | None = Field(default=None, ge=-90, le=90)
    longitude: float | None = Field(default=None, ge=-180, le=180)
    radius_m: int | None = Field(default=None, ge=30, le=5000)
    is_active: bool | None = None


class AttendanceGeofenceRead(BaseModel):
    id: int
    name: str
    address: str | None = None
    latitude: float
    longitude: float
    radius_m: int
    is_active: bool
    created_at: datetime
    updated_at: datetime


class AttendancePoint(BaseModel):
    latitude: float = Field(..., ge=-90, le=90)
    longitude: float = Field(..., ge=-180, le=180)
    accuracy_m: int | None = Field(default=None, ge=1, le=5000)


class AttendanceShiftStartBody(AttendancePoint):
    geofence_id: int | None = Field(default=None, ge=1)


class AttendanceShiftEndBody(AttendancePoint):
    shift_id: int = Field(..., ge=1)


class AttendancePingBody(AttendancePoint):
    shift_id: int | None = Field(default=None, ge=1)
    geofence_id: int | None = Field(default=None, ge=1)


class AttendanceShiftRead(BaseModel):
    id: int
    user_id: int
    geofence_id: int | None = None
    start_at: datetime
    end_at: datetime | None = None
    started_in_geofence: bool
    ended_in_geofence: bool | None = None
    suspicious: bool
    suspicious_reason: str | None = None
    duration_sec: int | None = None


class AttendancePingRead(BaseModel):
    id: int
    user_id: int
    shift_id: int | None = None
    geofence_id: int | None = None
    inside_geofence: bool
    distance_to_geofence_m: int | None = None
    suspicious: bool
    suspicious_reason: str | None = None
    created_at: datetime


class AttendanceMyStatusRead(BaseModel):
    active_shift: AttendanceShiftRead | None = None
    today_total_sec: int


class AttendanceEmployeeSummary(BaseModel):
    user_id: int
    full_name: str | None = None
    email: str
    total_sec: int
    shifts_count: int
    suspicious_events: int


class AttendanceReportRead(BaseModel):
    date_from: date
    date_to: date
    employees: list[AttendanceEmployeeSummary]
