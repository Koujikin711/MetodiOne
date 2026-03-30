"""API «пользователей сетки» = специалисты онлайн-записи (BookingSpecialist), не учётные записи CRM."""

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import CurrentUser
from app.database import get_db
from app.models import BookingDirection, BookingSpecialist
from app.schemas.booking import BookingSpecialistRead
from app.schemas.specialist_users import SpecialistUserCreate, SpecialistUserUpdate

router = APIRouter(prefix="/users", tags=["users"])


def _read_row(s: BookingSpecialist, direction_name: str | None) -> BookingSpecialistRead:
    return BookingSpecialistRead(
        id=s.id,
        full_name=s.full_name,
        direction_id=s.direction_id,
        direction_name=direction_name,
        phone=s.phone,
        specialization=s.specialization,
        is_active=s.is_active,
    )


@router.post("", response_model=BookingSpecialistRead, status_code=status.HTTP_201_CREATED)
async def create_specialist_user(
    body: SpecialistUserCreate,
    db: Annotated[AsyncSession, Depends(get_db)],
    _: CurrentUser,
) -> BookingSpecialistRead:
    d = await db.get(BookingDirection, body.direction_id)
    if d is None:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Неизвестное направление")
    spec = (body.specialization or "").strip() or None
    s = BookingSpecialist(
        full_name=body.full_name.strip(),
        direction_id=body.direction_id,
        phone=(body.phone or "").strip() or None,
        specialization=spec,
        is_active=True,
    )
    db.add(s)
    await db.flush()
    await db.refresh(s)
    return _read_row(s, d.name)


@router.patch("/{user_id}", response_model=BookingSpecialistRead)
async def patch_specialist_user(
    user_id: int,
    body: SpecialistUserUpdate,
    db: Annotated[AsyncSession, Depends(get_db)],
    _: CurrentUser,
) -> BookingSpecialistRead:
    s = await db.get(BookingSpecialist, user_id)
    if s is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Специалист не найден")

    patch = body.model_dump(exclude_unset=True)
    if not patch:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Нет полей для обновления")

    if "full_name" in patch and body.full_name is not None:
        s.full_name = body.full_name.strip()
    if "phone" in patch:
        s.phone = (body.phone or "").strip() or None
    if "specialization" in patch:
        s.specialization = (body.specialization or "").strip() or None
    if "direction_id" in patch and body.direction_id is not None:
        d = await db.get(BookingDirection, body.direction_id)
        if d is None:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Неизвестное направление")
        s.direction_id = body.direction_id

    await db.flush()
    await db.refresh(s)
    d = await db.get(BookingDirection, s.direction_id)
    return _read_row(s, d.name if d else None)


@router.delete("/{user_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_specialist_user(
    user_id: int,
    db: Annotated[AsyncSession, Depends(get_db)],
    _: CurrentUser,
) -> Response:
    s = await db.get(BookingSpecialist, user_id)
    if s is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Специалист не найден")
    s.is_active = False
    await db.flush()
    return Response(status_code=status.HTTP_204_NO_CONTENT)
