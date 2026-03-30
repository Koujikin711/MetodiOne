from typing import Literal

from pydantic import BaseModel, Field


class SpecialistUserCreate(BaseModel):
    """Тело POST /api/users — специалист записи (не учётная запись CRM)."""

    full_name: str = Field(..., min_length=1, max_length=255)
    direction_id: int = Field(..., ge=1, description="Услуга / направление по умолчанию")
    phone: str | None = Field(None, max_length=64)
    specialization: str | None = Field(None, max_length=255)
    role: Literal["specialist"] = Field(
        default="specialist",
        description="Только specialist — соответствует карточке в сетке записи",
    )


class SpecialistUserUpdate(BaseModel):
    full_name: str | None = Field(None, min_length=1, max_length=255)
    direction_id: int | None = Field(None, ge=1)
    phone: str | None = Field(None, max_length=64)
    specialization: str | None = Field(None, max_length=255)
