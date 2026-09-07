"""Схемы дневного журнала куратора."""

from __future__ import annotations

from datetime import date, datetime

from pydantic import BaseModel, Field


class CuratorDailyEntryCreate(BaseModel):
    entry_date: date
    full_name: str = Field(..., min_length=1, max_length=255)
    food_diary: str | None = Field(default=None, max_length=8000)
    complaint: str | None = Field(default=None, max_length=8000)


class CuratorDailyEntryUpdate(BaseModel):
    entry_date: date | None = None
    full_name: str | None = Field(default=None, min_length=1, max_length=255)
    food_diary: str | None = Field(default=None, max_length=8000)
    complaint: str | None = Field(default=None, max_length=8000)


class CuratorDailyEntryOut(BaseModel):
    id: int
    company_id: int
    entry_date: date
    full_name: str
    food_diary: str | None = None
    has_photo: bool = False
    photo_url: str | None = None
    complaint: str | None = None
    created_by_user_id: int | None = None
    created_by_name: str | None = None
    created_at: datetime | None = None
    updated_at: datetime | None = None
