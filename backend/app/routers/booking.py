from datetime import UTC, datetime, time, timedelta
from typing import Annotated
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.config import settings
from app.core.deps import CurrentUser
from app.database import get_db
from app.models import (
    BookingAppointment,
    BookingDirection,
    BookingSpecialist,
    Lead,
    Pipeline,
    PipelineStage,
)
from app.schemas.booking import (
    BookingAppointmentCreate,
    BookingAppointmentRead,
    BookingAppointmentStatusUpdate,
    BookingDirectionCreate,
    BookingDirectionRead,
    BookingSpecialistCreate,
    BookingSpecialistRead,
    BookingSpecialistUpdate,
    SpecialistReorderBody,
)
from app.schemas.lead import LeadRead
from app.services.automation import process_lead_automation

router = APIRouter(prefix="/booking", tags=["booking"])


def _norm_work_weekdays(raw: list | None) -> list[int]:
    if raw is None or len(raw) == 0:
        return [0, 1, 2, 3, 4]
    return sorted({int(x) for x in raw if 0 <= int(x) <= 6})


def _specialist_read(s: BookingSpecialist, direction_name: str | None) -> BookingSpecialistRead:
    return BookingSpecialistRead(
        id=s.id,
        full_name=s.full_name,
        direction_id=s.direction_id,
        direction_name=direction_name,
        phone=s.phone,
        specialization=s.specialization,
        is_active=s.is_active,
        sort_order=s.sort_order,
        work_start_hour=s.work_start_hour,
        work_end_hour=s.work_end_hour,
        work_weekdays=_norm_work_weekdays(s.work_weekdays),
    )


def _assert_slot_in_specialist_schedule(s: BookingSpecialist, start_at: datetime) -> None:
    tz = ZoneInfo(settings.booking_timezone)
    local = start_at.astimezone(tz)
    wd = local.weekday()
    days = _norm_work_weekdays(s.work_weekdays)
    if wd not in days:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="В выбранный день специалист не ведёт приём",
        )
    h = local.hour
    if h < s.work_start_hour or h >= s.work_end_hour:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=(
                f"Вне графика специалиста: приём с {s.work_start_hour}:00 до {s.work_end_hour}:00 "
                f"({settings.booking_timezone})"
            ),
        )


async def _stage_id_by_name(db: AsyncSession, name: str, pipeline_id: int | None = None) -> int | None:
    q = select(PipelineStage.id).where(PipelineStage.name == name)
    if pipeline_id is not None:
        q = q.where(PipelineStage.pipeline_id == pipeline_id)
    r = await db.execute(q)
    return r.scalar_one_or_none()


async def _sync_lead_to_stage_name(db: AsyncSession, lead_id: int, stage_name: str) -> None:
    lead = await db.get(Lead, lead_id)
    if lead is None:
        return
    # Чтобы не путаться при multi-pipeline, ищем стадию внутри pipeline лида
    await db.refresh(lead, ["stage"])
    pipeline_id = lead.stage.pipeline_id if lead.stage else None
    sid = await _stage_id_by_name(db, stage_name, pipeline_id=pipeline_id)
    if sid is None:
        return
    lead.status_id = sid
    await db.flush()
    await process_lead_automation(db, lead_id, sid)


@router.get("/queue", response_model=list[LeadRead])
async def booking_queue(
    db: Annotated[AsyncSession, Depends(get_db)],
    _: CurrentUser,
) -> list[LeadRead]:
    sales_pipe = (await db.execute(select(Pipeline.id).where(Pipeline.name == "Продажи"))).scalar_one_or_none()
    q_sid = await _stage_id_by_name(db, settings.booking_queue_stage_name, pipeline_id=sales_pipe)
    if q_sid is None:
        return []

    booked_subq = select(BookingAppointment.lead_id).where(
        BookingAppointment.lead_id.is_not(None),
        BookingAppointment.status == "booked",
    )
    result = await db.execute(
        select(Lead)
        .options(selectinload(Lead.stage))
        .where(Lead.status_id == q_sid)
        .where(Lead.id.not_in(booked_subq))
        .order_by(Lead.id.desc())
        .limit(200),
    )
    leads = result.scalars().unique().all()
    return [
        LeadRead(
            id=lead.id,
            name=lead.name,
            phone=lead.phone,
            email=lead.email,
            source=lead.source,
            status_id=lead.status_id,
            stage_name=lead.stage.name if lead.stage else None,
            manager_id=lead.manager_id,
        )
        for lead in leads
    ]


@router.get("/directions", response_model=list[BookingDirectionRead])
async def list_directions(
    db: Annotated[AsyncSession, Depends(get_db)],
    _: CurrentUser,
) -> list[BookingDirection]:
    result = await db.execute(select(BookingDirection).order_by(BookingDirection.id.desc()))
    return list(result.scalars().all())


@router.post("/directions", response_model=BookingDirectionRead, status_code=status.HTTP_201_CREATED)
async def create_direction(
    body: BookingDirectionCreate,
    db: Annotated[AsyncSession, Depends(get_db)],
    _: CurrentUser,
) -> BookingDirection:
    row = BookingDirection(name=body.name.strip(), duration_min=body.duration_min, is_active=True)
    db.add(row)
    try:
        await db.flush()
        await db.refresh(row)
    except IntegrityError:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Направление с таким именем уже есть")
    return row


@router.get("/specialists", response_model=list[BookingSpecialistRead])
async def list_specialists(
    db: Annotated[AsyncSession, Depends(get_db)],
    _: CurrentUser,
) -> list[BookingSpecialistRead]:
    result = await db.execute(
        select(BookingSpecialist, BookingDirection.name)
        .join(BookingDirection, BookingSpecialist.direction_id == BookingDirection.id)
        .order_by(BookingSpecialist.sort_order.asc(), BookingSpecialist.id.asc()),
    )
    rows = result.all()
    return [_specialist_read(s, dname) for s, dname in rows]


@router.post("/specialists", response_model=BookingSpecialistRead, status_code=status.HTTP_201_CREATED)
async def create_specialist(
    body: BookingSpecialistCreate,
    db: Annotated[AsyncSession, Depends(get_db)],
    _: CurrentUser,
) -> BookingSpecialistRead:
    d = await db.get(BookingDirection, body.direction_id)
    if d is None:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Неизвестное направление")
    spec = (body.specialization or "").strip() or None
    mx = await db.execute(select(func.coalesce(func.max(BookingSpecialist.sort_order), -1)))
    next_sort = int(mx.scalar_one()) + 1
    s = BookingSpecialist(
        full_name=body.full_name.strip(),
        direction_id=body.direction_id,
        phone=(body.phone or "").strip() or None,
        specialization=spec,
        is_active=True,
        sort_order=next_sort,
        work_start_hour=body.work_start_hour,
        work_end_hour=body.work_end_hour,
        work_weekdays=list(body.work_weekdays),
    )
    db.add(s)
    await db.flush()
    await db.refresh(s)
    return _specialist_read(s, d.name)


@router.patch("/specialists/{specialist_id}", response_model=BookingSpecialistRead)
async def patch_specialist(
    specialist_id: int,
    body: BookingSpecialistUpdate,
    db: Annotated[AsyncSession, Depends(get_db)],
    _: CurrentUser,
) -> BookingSpecialistRead:
    s = await db.get(BookingSpecialist, specialist_id)
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
    if "work_start_hour" in patch and body.work_start_hour is not None:
        s.work_start_hour = body.work_start_hour
    if "work_end_hour" in patch and body.work_end_hour is not None:
        s.work_end_hour = body.work_end_hour
    if "work_weekdays" in patch and body.work_weekdays is not None:
        s.work_weekdays = list(body.work_weekdays)
    await db.flush()
    await db.refresh(s)
    if s.work_start_hour >= s.work_end_hour:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Конец приёма должен быть позже начала",
        )
    d = await db.get(BookingDirection, s.direction_id)
    return _specialist_read(s, d.name if d else None)


@router.delete("/specialists/{specialist_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_specialist(
    specialist_id: int,
    db: Annotated[AsyncSession, Depends(get_db)],
    _: CurrentUser,
) -> Response:
    s = await db.get(BookingSpecialist, specialist_id)
    if s is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Специалист не найден")
    s.is_active = False
    await db.flush()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/specialists/reorder", status_code=status.HTTP_204_NO_CONTENT)
async def reorder_specialists(
    body: SpecialistReorderBody,
    db: Annotated[AsyncSession, Depends(get_db)],
    _: CurrentUser,
) -> Response:
    active_result = await db.execute(
        select(BookingSpecialist.id).where(BookingSpecialist.is_active.is_(True)),
    )
    active_ids = {row[0] for row in active_result.all()}
    if set(body.ordered_ids) != active_ids:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Передайте всех активных специалистов в новом порядке, без пропусков и дубликатов",
        )
    for idx, sid in enumerate(body.ordered_ids):
        s = await db.get(BookingSpecialist, sid)
        if s is None or not s.is_active:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Некорректный id специалиста")
        s.sort_order = idx
    await db.flush()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


def _ensure_utc(dt: datetime) -> datetime:
    if dt.tzinfo is None:
        return dt.replace(tzinfo=UTC)
    return dt.astimezone(UTC)


@router.get("/appointments", response_model=list[BookingAppointmentRead])
async def list_appointments(
    db: Annotated[AsyncSession, Depends(get_db)],
    _: CurrentUser,
    date: str | None = None,
    specialist_id: int | None = None,
) -> list[BookingAppointmentRead]:
    q = (
        select(BookingAppointment, BookingDirection.name, BookingSpecialist.full_name)
        .join(BookingDirection, BookingAppointment.direction_id == BookingDirection.id)
        .join(BookingSpecialist, BookingAppointment.specialist_id == BookingSpecialist.id)
    )
    if date:
        try:
            day = datetime.strptime(date, "%Y-%m-%d").date()
        except ValueError:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Неверная дата")
        day_start = datetime.combine(day, time.min, tzinfo=UTC)
        day_end = day_start + timedelta(days=1)
        q = q.where(BookingAppointment.start_at >= day_start, BookingAppointment.start_at < day_end)
    if specialist_id is not None:
        q = q.where(BookingAppointment.specialist_id == specialist_id)
    q = q.order_by(BookingAppointment.start_at.asc())
    result = await db.execute(q)
    out: list[BookingAppointmentRead] = []
    for a, dname, sname in result.all():
        out.append(
            BookingAppointmentRead(
                id=a.id,
                lead_id=a.lead_id,
                specialist_id=a.specialist_id,
                direction_id=a.direction_id,
                patient_name=a.patient_name,
                patient_phone=a.patient_phone,
                start_at=a.start_at,
                end_at=a.end_at,
                status=a.status,
                responsible_manager_id=a.responsible_manager_id,
                direction_name=dname,
                specialist_name=sname,
                comment=a.comment,
            )
        )
    return out


@router.post("/appointments", response_model=BookingAppointmentRead, status_code=status.HTTP_201_CREATED)
async def create_appointment(
    body: BookingAppointmentCreate,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentUser,
) -> BookingAppointmentRead:
    direction = await db.get(BookingDirection, body.direction_id)
    if direction is None or not direction.is_active:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Направление не найдено")
    specialist = await db.get(BookingSpecialist, body.specialist_id)
    if specialist is None or not specialist.is_active:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Специалист не найден")
    if specialist.direction_id != body.direction_id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Специалист не относится к выбранному направлению")

    start_at = _ensure_utc(body.start_at)
    _assert_slot_in_specialist_schedule(specialist, start_at)
    duration_min = int(direction.duration_min or 30)
    end_at = start_at + timedelta(minutes=duration_min)

    overlap = await db.execute(
        select(BookingAppointment.id)
        .where(
            BookingAppointment.specialist_id == body.specialist_id,
            BookingAppointment.status == "booked",
            BookingAppointment.end_at > start_at,
            BookingAppointment.start_at < end_at,
        )
        .limit(1),
    )
    if overlap.scalar_one_or_none() is not None:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Слот уже занят")

    lead_id = body.lead_id
    if lead_id is not None:
        lead = await db.get(Lead, lead_id)
        if lead is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Лид не найден")

    now = datetime.now(UTC)
    appt = BookingAppointment(
        lead_id=lead_id,
        patient_name=body.patient_name.strip(),
        patient_phone=body.patient_phone.strip(),
        direction_id=body.direction_id,
        specialist_id=body.specialist_id,
        start_at=start_at,
        end_at=end_at,
        status="booked",
        responsible_manager_id=body.responsible_manager_id,
        created_by_user_id=current_user.id,
        comment=(body.comment or "").strip() or None,
        created_at=now,
        updated_at=now,
    )
    db.add(appt)
    await db.flush()

    if lead_id is not None:
        await _sync_lead_to_stage_name(db, lead_id, settings.booking_stage_after_book)

    await db.refresh(appt)

    dname = direction.name
    sname = specialist.full_name
    return BookingAppointmentRead(
        id=appt.id,
        lead_id=appt.lead_id,
        specialist_id=appt.specialist_id,
        direction_id=appt.direction_id,
        patient_name=appt.patient_name,
        patient_phone=appt.patient_phone,
        start_at=appt.start_at,
        end_at=appt.end_at,
        status=appt.status,
        responsible_manager_id=appt.responsible_manager_id,
        direction_name=dname,
        specialist_name=sname,
        comment=appt.comment,
    )


@router.patch("/appointments/{appointment_id}/status", response_model=BookingAppointmentRead)
async def patch_appointment_status(
    appointment_id: int,
    body: BookingAppointmentStatusUpdate,
    db: Annotated[AsyncSession, Depends(get_db)],
    _: CurrentUser,
) -> BookingAppointmentRead:
    a = await db.get(BookingAppointment, appointment_id)
    if a is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Запись не найдена")

    a.status = body.status
    a.updated_at = datetime.now(UTC)

    if a.lead_id is not None:
        if body.status == "completed":
            await _sync_lead_to_stage_name(db, a.lead_id, settings.booking_stage_completed)
        elif body.status in ("no_show", "cancelled"):
            await _sync_lead_to_stage_name(db, a.lead_id, settings.booking_stage_lost)

    direction = await db.get(BookingDirection, a.direction_id)
    specialist = await db.get(BookingSpecialist, a.specialist_id)
    return BookingAppointmentRead(
        id=a.id,
        lead_id=a.lead_id,
        specialist_id=a.specialist_id,
        direction_id=a.direction_id,
        patient_name=a.patient_name,
        patient_phone=a.patient_phone,
        start_at=a.start_at,
        end_at=a.end_at,
        status=a.status,
        responsible_manager_id=a.responsible_manager_id,
        direction_name=direction.name if direction else None,
        specialist_name=specialist.full_name if specialist else None,
        comment=a.comment,
    )
