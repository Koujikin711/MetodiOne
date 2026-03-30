from typing import Literal

from pydantic import Field

from app.schemas.booking import BookingSpecialistCreate, BookingSpecialistUpdate


class SpecialistUserCreate(BookingSpecialistCreate):
    """POST /api/users — специалист записи (поля графика как у BookingSpecialistCreate)."""

    role: Literal["specialist"] = Field(
        default="specialist",
        description="Только specialist — карточка в сетке записи",
    )


class SpecialistUserUpdate(BookingSpecialistUpdate):
    """PATCH /api/users/{id}"""

    pass
