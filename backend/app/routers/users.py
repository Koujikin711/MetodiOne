"""API «пользователей сетки» = специалисты онлайн-записи (BookingSpecialist), не учётные записи CRM."""

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import CurrentCompanyId, CurrentUser
from app.database import get_db
from app.models import BookingDirection, BookingSpecialist
from app.routers.booking import _apply_course_stream_fields, _specialist_read
from app.schemas.booking import BookingSpecialistRead
from app.schemas.specialist_users import SpecialistUserCreate, SpecialistUserUpdate
from app.services.audit import write_audit_event

router = APIRouter(prefix="/users", tags=["users"])


@router.post("", response_model=BookingSpecialistRead, status_code=status.HTTP_201_CREATED)
async def create_specialist_user(
    body: SpecialistUserCreate,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentUser,
    company_id: CurrentCompanyId,
) -> BookingSpecialistRead:
    raise HTTPException(
        status_code=status.HTTP_403_FORBIDDEN,
        detail=(
            "Специалистов онлайн-записи нельзя создавать здесь. "
            "Пригласите эксперта в разделе «Сотрудники» — колонка в сетке появится автоматически."
        ),
    )


@router.patch("/{user_id}", response_model=BookingSpecialistRead)
async def patch_specialist_user(
    user_id: int,
    body: SpecialistUserUpdate,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentUser,
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
        if d is None or (s.company_id is not None and d.company_id != s.company_id):
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Неизвестное направление")
        if not d.is_active:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Нельзя назначить архивное направление. Восстановите его или выберите активное.",
            )
        s.direction_id = body.direction_id
    if "work_start_hour" in patch and body.work_start_hour is not None:
        s.work_start_hour = body.work_start_hour
    if "slot_duration_min" in patch and body.slot_duration_min is not None:
        s.slot_duration_min = body.slot_duration_min
    if "work_end_hour" in patch and body.work_end_hour is not None:
        s.work_end_hour = body.work_end_hour
    if "work_weekdays" in patch and body.work_weekdays is not None:
        s.work_weekdays = list(body.work_weekdays)
    _apply_course_stream_fields(s, patch)

    await db.flush()
    await write_audit_event(
        db,
        entity_type="specialist",
        entity_id=s.id,
        action="specialist_updated",
        current_user=current_user,
        details=f"full_name={s.full_name}, direction_id={s.direction_id}",
    )
    await db.refresh(s)
    if s.work_start_hour >= s.work_end_hour:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Конец приёма должен быть позже начала",
        )
    d = await db.get(BookingDirection, s.direction_id)
    return _specialist_read(s, d.name if d else None)


@router.delete("/{user_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_specialist_user(
    user_id: int,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentUser,
) -> Response:
    s = await db.get(BookingSpecialist, user_id)
    if s is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Специалист не найден")
    s.is_active = False
    await db.flush()
    await write_audit_event(
        db,
        entity_type="specialist",
        entity_id=s.id,
        action="specialist_deactivated",
        current_user=current_user,
        details=f"full_name={s.full_name}",
    )
    return Response(status_code=status.HTTP_204_NO_CONTENT)
