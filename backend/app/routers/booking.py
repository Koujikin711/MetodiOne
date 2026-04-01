from datetime import UTC, datetime, time, timedelta
import re
from typing import Annotated
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, HTTPException, Response, status
from pydantic import BaseModel, Field
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
    UserRole,
)
from app.schemas.booking import (
    BookingAppointmentCreate,
    BookingAppointmentMove,
    BookingAppointmentPaymentUpdate,
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
from app.services.audit import write_audit_event
from app.services.lead_assignment import assign_manager_for_new_lead

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
        slot_duration_min=s.slot_duration_min,
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
    # Не привязываемся к “зашитому” pipeline — берём первую найденную стадию по имени.
    q_sid = await _stage_id_by_name(db, settings.booking_queue_stage_name)
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


class BookingQueueLeadCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=255)
    phone: str | None = Field(None, max_length=64)
    email: str | None = Field(None, max_length=320)
    source: str | None = Field(None, max_length=120)


@router.post("/queue", response_model=LeadRead, status_code=status.HTTP_201_CREATED)
async def booking_queue_add(
    body: BookingQueueLeadCreate,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentUser,
) -> LeadRead:
    q_sid = await _stage_id_by_name(db, settings.booking_queue_stage_name)
    if q_sid is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Stage '{settings.booking_queue_stage_name}' not found",
        )

    stage_row = await db.get(PipelineStage, q_sid)
    pipeline_id = stage_row.pipeline_id if stage_row else None
    manager_id = current_user.id
    if pipeline_id is not None:
        assigned = await assign_manager_for_new_lead(db, pipeline_id=pipeline_id)
        if assigned is not None:
            manager_id = assigned

    lead = Lead(
        name=body.name.strip(),
        phone=(body.phone or "").strip() or None,
        email=(body.email or "").strip() or None,
        source=(body.source or "").strip() or None,
        status_id=q_sid,
        manager_id=manager_id,
    )
    db.add(lead)
    await db.flush()
    await db.refresh(lead, ["stage"])
    return LeadRead(
        id=lead.id,
        name=lead.name,
        phone=lead.phone,
        email=lead.email,
        source=lead.source,
        status_id=lead.status_id,
        stage_name=lead.stage.name if lead.stage else None,
        manager_id=lead.manager_id,
    )


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
    current_user: CurrentUser,
) -> BookingDirection:
    row = BookingDirection(name=body.name.strip(), duration_min=body.duration_min, is_active=True)
    db.add(row)
    try:
        await db.flush()
        await db.refresh(row)
        await write_audit_event(
            db,
            entity_type="booking_direction",
            entity_id=row.id,
            action="booking_direction_created",
            current_user=current_user,
            details=f"name={row.name}, duration_min={row.duration_min}",
        )
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
    current_user: CurrentUser,
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
    await write_audit_event(
        db,
        entity_type="specialist",
        entity_id=s.id,
        action="specialist_created",
        current_user=current_user,
        details=f"full_name={s.full_name}, direction_id={s.direction_id}",
    )
    await db.refresh(s)
    return _specialist_read(s, d.name)


@router.patch("/specialists/{specialist_id}", response_model=BookingSpecialistRead)
async def patch_specialist(
    specialist_id: int,
    body: BookingSpecialistUpdate,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentUser,
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


@router.delete("/specialists/{specialist_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_specialist(
    specialist_id: int,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentUser,
) -> Response:
    s = await db.get(BookingSpecialist, specialist_id)
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


@router.post("/specialists/reorder", status_code=status.HTTP_204_NO_CONTENT)
async def reorder_specialists(
    body: SpecialistReorderBody,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentUser,
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
    await write_audit_event(
        db,
        entity_type="specialist",
        action="specialists_reordered",
        current_user=current_user,
        details=f"ordered_ids={body.ordered_ids}",
    )
    return Response(status_code=status.HTTP_204_NO_CONTENT)


def _ensure_utc(dt: datetime) -> datetime:
    if dt.tzinfo is None:
        return dt.replace(tzinfo=UTC)
    return dt.astimezone(UTC)


def _day_bounds_utc_for_booking_tz(date_ymd: str) -> tuple[datetime, datetime]:
    day = datetime.strptime(date_ymd, "%Y-%m-%d").date()
    tz = ZoneInfo(settings.booking_timezone)
    local_start = datetime.combine(day, time.min, tzinfo=tz)
    local_end = local_start + timedelta(days=1)
    return local_start.astimezone(UTC), local_end.astimezone(UTC)


def _from_payload_to_utc(dt: datetime) -> datetime:
    # Для совместимости: если клиент прислал naive datetime,
    # трактуем его как локальное время онлайн-записи.
    if dt.tzinfo is None:
        tz = ZoneInfo(settings.booking_timezone)
        return dt.replace(tzinfo=tz).astimezone(UTC)
    return dt.astimezone(UTC)


def _norm_phone(raw: str | None) -> str | None:
    if not raw:
        return None
    digits = re.sub(r"\D+", "", raw)
    return digits or None


async def _upsert_lead_for_appointment(
    db: AsyncSession,
    *,
    patient_name: str,
    patient_phone: str,
    responsible_manager_id: int | None,
    lead_pipeline_id: int | None,
    lead_stage_id: int | None,
) -> int | None:
    phone = _norm_phone(patient_phone)
    if not phone:
        return None
    existing = await db.execute(
        select(Lead).where(Lead.phone == phone).order_by(Lead.id.desc()).limit(1),
    )
    found = existing.scalars().first()
    if found is not None:
        return found.id

    stage_id = lead_stage_id
    if stage_id is not None and lead_pipeline_id is not None:
        stage = await db.get(PipelineStage, stage_id)
        if stage is None or stage.pipeline_id != lead_pipeline_id:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Стадия не относится к выбранной воронке")
    if stage_id is None and lead_pipeline_id is not None:
        stage_id = await db.scalar(
            select(PipelineStage.id)
            .where(PipelineStage.pipeline_id == lead_pipeline_id)
            .order_by(PipelineStage.order.asc(), PipelineStage.id.asc())
            .limit(1),
        )
    if stage_id is None:
        stage_id = await _stage_id_by_name(db, settings.booking_stage_after_book)
    if stage_id is None:
        return None

    stage = await db.get(PipelineStage, stage_id)
    pipeline_id = stage.pipeline_id if stage else None
    manager_id = responsible_manager_id
    if manager_id is None and pipeline_id is not None:
        manager_id = await assign_manager_for_new_lead(db, pipeline_id=pipeline_id)

    lead = Lead(
        name=patient_name.strip() or "Клиент",
        phone=phone,
        source="Онлайн-запись",
        status_id=stage_id,
        manager_id=manager_id,
    )
    db.add(lead)
    await db.flush()
    return lead.id


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
            day_start, day_end = _day_bounds_utc_for_booking_tz(date)
        except ValueError:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Неверная дата")
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
                start_at=_ensure_utc(a.start_at),
                end_at=_ensure_utc(a.end_at),
                status=a.status,
                service_amount=float(a.service_amount or 0),
                paid_amount=float(a.paid_amount or 0),
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

    start_at = _from_payload_to_utc(body.start_at)
    _assert_slot_in_specialist_schedule(specialist, start_at)
    duration_min = int(specialist.slot_duration_min or direction.duration_min or 30)
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
    else:
        lead_id = await _upsert_lead_for_appointment(
            db,
            patient_name=body.patient_name,
            patient_phone=body.patient_phone,
            responsible_manager_id=body.responsible_manager_id,
            lead_pipeline_id=body.lead_pipeline_id,
            lead_stage_id=body.lead_stage_id,
        )

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
        service_amount=body.service_amount,
        paid_amount=body.paid_amount,
        responsible_manager_id=body.responsible_manager_id,
        created_by_user_id=current_user.id,
        comment=(body.comment or "").strip() or None,
        created_at=now,
        updated_at=now,
    )
    db.add(appt)
    await db.flush()
    await write_audit_event(
        db,
        entity_type="booking_appointment",
        entity_id=appt.id,
        action="appointment_created",
        current_user=current_user,
        details=f"lead_id={appt.lead_id}, specialist_id={appt.specialist_id}, start_at={appt.start_at.isoformat()}",
    )

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
        start_at=_ensure_utc(appt.start_at),
        end_at=_ensure_utc(appt.end_at),
        status=appt.status,
        service_amount=float(appt.service_amount or 0),
        paid_amount=float(appt.paid_amount or 0),
        responsible_manager_id=appt.responsible_manager_id,
        direction_name=dname,
        specialist_name=sname,
        comment=appt.comment,
    )


@router.patch("/appointments/{appointment_id}/move", response_model=BookingAppointmentRead)
async def move_appointment(
    appointment_id: int,
    body: BookingAppointmentMove,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentUser,
) -> BookingAppointmentRead:
    appt = await db.get(BookingAppointment, appointment_id)
    if appt is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Запись не найдена")
    if appt.status != "booked":
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Перенос доступен только для активных записей")

    specialist = await db.get(BookingSpecialist, body.specialist_id)
    if specialist is None or not specialist.is_active:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Специалист не найден")

    direction = await db.get(BookingDirection, appt.direction_id)
    if direction is None or not direction.is_active:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Направление не найдено")
    if specialist.direction_id != appt.direction_id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Специалист не относится к направлению записи")

    start_at = _from_payload_to_utc(body.start_at)
    _assert_slot_in_specialist_schedule(specialist, start_at)
    end_at = start_at + timedelta(minutes=int(direction.duration_min or 30))

    overlap = await db.execute(
        select(BookingAppointment.id)
        .where(
            BookingAppointment.id != appt.id,
            BookingAppointment.specialist_id == specialist.id,
            BookingAppointment.status == "booked",
            BookingAppointment.end_at > start_at,
            BookingAppointment.start_at < end_at,
        )
        .limit(1),
    )
    if overlap.scalar_one_or_none() is not None:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Слот уже занят")

    appt.specialist_id = specialist.id
    appt.start_at = start_at
    appt.end_at = end_at
    appt.updated_at = datetime.now(UTC)
    await db.flush()
    await write_audit_event(
        db,
        entity_type="booking_appointment",
        entity_id=appt.id,
        action="appointment_moved",
        current_user=current_user,
        details=f"specialist_id={appt.specialist_id}, start_at={appt.start_at.isoformat()}",
    )

    return BookingAppointmentRead(
        id=appt.id,
        lead_id=appt.lead_id,
        specialist_id=appt.specialist_id,
        direction_id=appt.direction_id,
        patient_name=appt.patient_name,
        patient_phone=appt.patient_phone,
        start_at=_ensure_utc(appt.start_at),
        end_at=_ensure_utc(appt.end_at),
        status=appt.status,
        service_amount=float(appt.service_amount or 0),
        paid_amount=float(appt.paid_amount or 0),
        responsible_manager_id=appt.responsible_manager_id,
        direction_name=direction.name,
        specialist_name=specialist.full_name,
        comment=appt.comment,
    )


@router.patch("/appointments/{appointment_id}/status", response_model=BookingAppointmentRead)
async def patch_appointment_status(
    appointment_id: int,
    body: BookingAppointmentStatusUpdate,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentUser,
) -> BookingAppointmentRead:
    a = await db.get(BookingAppointment, appointment_id)
    if a is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Запись не найдена")

    a.status = body.status
    a.updated_at = datetime.now(UTC)
    await write_audit_event(
        db,
        entity_type="booking_appointment",
        entity_id=a.id,
        action="appointment_status_updated",
        current_user=current_user,
        details=f"status={a.status}",
    )

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
        start_at=_ensure_utc(a.start_at),
        end_at=_ensure_utc(a.end_at),
        status=a.status,
        service_amount=float(a.service_amount or 0),
        paid_amount=float(a.paid_amount or 0),
        responsible_manager_id=a.responsible_manager_id,
        direction_name=direction.name if direction else None,
        specialist_name=specialist.full_name if specialist else None,
        comment=a.comment,
    )


@router.patch("/appointments/{appointment_id}/payment", response_model=BookingAppointmentRead)
async def patch_appointment_payment(
    appointment_id: int,
    body: BookingAppointmentPaymentUpdate,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentUser,
) -> BookingAppointmentRead:
    if current_user.role != UserRole.admin:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Только администратор может менять оплату")
    appt = await db.get(BookingAppointment, appointment_id)
    if appt is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Запись не найдена")
    if body.paid_amount > float(appt.service_amount or 0):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Оплата не может быть больше стоимости услуги")

    tz = ZoneInfo(settings.booking_timezone)
    appt_day = _ensure_utc(appt.start_at).astimezone(tz).date()
    now_day = datetime.now(UTC).astimezone(tz).date()
    if appt_day != now_day:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Менять оплату можно только в день прихода клиента",
        )

    appt.paid_amount = body.paid_amount
    appt.updated_at = datetime.now(UTC)
    await db.flush()
    await write_audit_event(
        db,
        entity_type="booking_appointment",
        entity_id=appt.id,
        action="appointment_payment_updated",
        current_user=current_user,
        details=f"paid_amount={body.paid_amount}",
    )

    direction = await db.get(BookingDirection, appt.direction_id)
    specialist = await db.get(BookingSpecialist, appt.specialist_id)
    return BookingAppointmentRead(
        id=appt.id,
        lead_id=appt.lead_id,
        specialist_id=appt.specialist_id,
        direction_id=appt.direction_id,
        patient_name=appt.patient_name,
        patient_phone=appt.patient_phone,
        start_at=_ensure_utc(appt.start_at),
        end_at=_ensure_utc(appt.end_at),
        status=appt.status,
        service_amount=float(appt.service_amount or 0),
        paid_amount=float(appt.paid_amount or 0),
        responsible_manager_id=appt.responsible_manager_id,
        direction_name=direction.name if direction else None,
        specialist_name=specialist.full_name if specialist else None,
        comment=appt.comment,
    )
