from datetime import UTC, datetime, time, timedelta
from decimal import Decimal
import re
from typing import Annotated
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from pydantic import BaseModel, Field
from sqlalchemy import func, or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.config import settings
from app.services.chief_expert_access import is_chief_expert
from app.services.booking_expert_sync import ensure_active_expert_booking_profiles
from app.core.deps import CurrentCompanyId, CurrentUser
from app.database import get_db
from app.models import (
    BookingAppointment,
    BookingDirection,
    BookingSpecialist,
    Lead,
    Pipeline,
    PipelineStage,
    User,
    UserPipelineAssignment,
    UserRole,
)
from app.schemas.booking import (
    BookingAppointmentCreate,
    BookingAppointmentMove,
    BookingAppointmentPaymentUpdate,
    BookingAppointmentRead,
    BookingAppointmentDetailsUpdate,
    BookingAppointmentStatusUpdate,
    BookingPatientHistoryItem,
    BookingPatientSuggestItem,
    BookingPatientVisitRead,
    BookingDirectionCreate,
    BookingDirectionRead,
    BookingDirectionUpdate,
    BookingSpecialistCreate,
    BookingSpecialistRead,
    BookingSpecialistUpdate,
    BookingViewerContext,
    SpecialistReorderBody,
)
from app.schemas.lead import LeadRead
from app.services.automation import process_lead_automation
from app.services.audit import write_audit_event
from app.services.lead_assignment import assign_manager_for_new_lead
from app.services.lead_sales_stages import resolve_new_lead_stage_id
from app.services.lead_extra_phones import find_lead_by_any_phone, sync_lead_extra_phones
from app.services.sales_kpi import get_kpi_service_price
from app.services.whatsapp_automation import send_booking_confirmation_if_needed

router = APIRouter(prefix="/booking", tags=["booking"])

MAX_BOOKINGS_PER_SPECIALIST_DAY = 15


async def resolve_default_booking_direction_id(db: AsyncSession, company_id: int) -> int:
    """Первая активная строка booking_directions компании (внутренняя привязка специалиста без UI-справочника)."""
    r = await db.execute(
        select(BookingDirection.id)
        .where(BookingDirection.company_id == company_id, BookingDirection.is_active.is_(True))
        .order_by(BookingDirection.id.asc())
        .limit(1),
    )
    row = r.scalar_one_or_none()
    if row is not None:
        return int(row)
    r2 = await db.execute(
        select(BookingDirection.id)
        .where(BookingDirection.company_id == company_id)
        .order_by(BookingDirection.id.asc())
        .limit(1),
    )
    row2 = r2.scalar_one_or_none()
    if row2 is None:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Не настроены направления онлайн-записи — обратитесь к администратору",
        )
    return int(row2)


async def _user_assigned_pipeline_ids(db: AsyncSession, user_id: int) -> set[int]:
    user = await db.get(User, user_id)
    if user is None or user.company_id is None:
        return set()
    r = await db.execute(
        select(UserPipelineAssignment.pipeline_id).where(
            UserPipelineAssignment.user_id == user_id,
            UserPipelineAssignment.company_id == user.company_id,
        ),
    )
    return {row[0] for row in r.all()}


async def _expert_chief_pipeline_ids(db: AsyncSession, user: User) -> set[int]:
    """Воронки, где пользователь — главный эксперт (expert_user_id в настройках воронки)."""
    if user.company_id is None:
        return set()
    r = await db.execute(
        select(Pipeline.id).where(
            Pipeline.company_id == user.company_id,
            Pipeline.expert_user_id == user.id,
        ),
    )
    return {int(row[0]) for row in r.all()}


def _appointment_in_pipelines(*, pipeline_ids: set[int]) -> object:
    """Условие: запись относится к одной из воронок (снимок или направление календаря)."""
    if not pipeline_ids:
        return BookingAppointment.id == -1
    return or_(
        BookingAppointment.pipeline_id.in_(pipeline_ids),
        BookingDirection.pipeline_id.in_(pipeline_ids),
    )


def _specialists_visible_to_chief_expert(
    *,
    pipeline_ids: set[int],
    company_id: int,
) -> object:
    """Колонки всех экспертов воронки: направление или учётная запись эксперта в назначениях воронки."""
    assigned_expert_ids = (
        select(UserPipelineAssignment.user_id)
        .where(
            UserPipelineAssignment.company_id == company_id,
            UserPipelineAssignment.pipeline_id.in_(pipeline_ids),
        )
        .scalar_subquery()
    )
    return or_(
        BookingDirection.pipeline_id.in_(pipeline_ids),
        BookingSpecialist.crm_user_id.in_(assigned_expert_ids),
    )


async def _appointment_lead_pipeline_id(db: AsyncSession, appt: BookingAppointment) -> int | None:
    if getattr(appt, "pipeline_id", None) is not None:
        return int(appt.pipeline_id)
    if appt.lead_id is None:
        return None
    lead = await db.get(Lead, appt.lead_id)
    if lead is None:
        return None
    await db.refresh(lead, ["stage"])
    return lead.stage.pipeline_id if lead.stage else None


async def compute_can_manage_journal(db: AsyncSession, appt: BookingAppointment, viewer: User) -> bool:
    if viewer.role == UserRole.owner:
        return True
    if viewer.role == UserRole.expert and await is_chief_expert(db, viewer):
        return True
    if viewer.role != UserRole.admin:
        return False
    pid = await _appointment_lead_pipeline_id(db, appt)
    if pid is None:
        return False
    allowed = await _user_assigned_pipeline_ids(db, viewer.id)
    return pid in allowed


async def _assert_can_manage_appointment_journal(
    db: AsyncSession,
    appt: BookingAppointment,
    current_user: User,
) -> None:
    if current_user.role == UserRole.owner:
        return
    if current_user.role == UserRole.expert and await is_chief_expert(db, current_user):
        return
    if current_user.role != UserRole.admin:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Только владелец или админ воронки по лиду записи",
        )
    if not await compute_can_manage_journal(db, appt, current_user):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Запись относится к воронке, к которой у вас нет прав администратора",
        )


async def _assert_expert_specialist_access(
    db: AsyncSession,
    current_user: User,
    specialist: BookingSpecialist,
) -> None:
    if current_user.role != UserRole.expert:
        return
    if await is_chief_expert(db, current_user):
        return
    if specialist.crm_user_id != current_user.id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Эксперт может работать только со своими записями",
        )


async def _assert_expert_readonly_for_booking(db: AsyncSession, current_user: User) -> None:
    if current_user.role != UserRole.expert:
        return
    if await is_chief_expert(db, current_user):
        return
    raise HTTPException(
        status_code=status.HTTP_403_FORBIDDEN,
        detail="Эксперт может только просматривать свои записи (изменения в онлайн-записи недоступны)",
    )


def _appointment_duration_minutes(specialist: BookingSpecialist, _direction: BookingDirection | None = None) -> int:
    """Длительность приёма — по настройке специалиста (слот), без справочника услуг."""
    spec_slot = int(specialist.slot_duration_min or 0)
    return spec_slot if spec_slot >= 15 else 30


def _visit_group_key(phone: str | None, specialist_id: int) -> tuple[str, int]:
    digits = _norm_phone(phone) or ""
    if len(digits) >= 9:
        digits = digits[-9:]
    elif not digits:
        digits = (phone or "").strip().lower()
    return (digits, int(specialist_id))


async def _visit_labels_for_ids(
    db: AsyncSession,
    *,
    company_id: int,
    appointment_ids: list[int],
):
    from app.services.booking_visit_labels import visit_labels_for_ids

    return await visit_labels_for_ids(
        db,
        company_id=company_id,
        appointment_ids=appointment_ids,
        norm_phone=_norm_phone,
    )


async def _visit_numbers_for_ids(
    db: AsyncSession,
    *,
    company_id: int,
    appointment_ids: list[int],
) -> dict[int, int]:
    """Порядковый номер визита или день в потоке."""
    labels = await _visit_labels_for_ids(db, company_id=company_id, appointment_ids=appointment_ids)
    return {int(aid): int(info.visit_number or 1) for aid, info in labels.items()}


def _appointment_pipeline_id(
    appt: BookingAppointment,
    direction_pipeline_id: int | None = None,
) -> int | None:
    if appt.pipeline_id is not None:
        return int(appt.pipeline_id)
    if direction_pipeline_id is not None:
        return int(direction_pipeline_id)
    return None


def _chief_expert_may_see_visit_numbers(viewer: User, pipeline_id: int | None, chief_pipeline_ids: set[int]) -> bool:
    """Номер сеанса только у эксперта, назначенного главным на воронку."""
    if viewer.role != UserRole.expert or not chief_pipeline_ids:
        return False
    if pipeline_id is None:
        return False
    return int(pipeline_id) in chief_pipeline_ids


async def _visit_numbers_for_chief_expert_view(
    db: AsyncSession,
    *,
    company_id: int,
    viewer: User,
    rows: list[tuple[BookingAppointment, str, int | None, str]],
) -> dict[int, int]:
    """Считает visit_number только для записей воронок, где viewer — главный эксперт."""
    chief_pids = await _expert_chief_pipeline_ids(db, viewer)
    if not chief_pids:
        return {}
    chief_appt_ids = [
        int(a.id)
        for a, _dname, dir_pid, _sname in rows
        if _chief_expert_may_see_visit_numbers(viewer, _appointment_pipeline_id(a, dir_pid), chief_pids)
    ]
    if not chief_appt_ids:
        return {}
    return await _visit_numbers_for_ids(db, company_id=company_id, appointment_ids=chief_appt_ids)


async def _booking_appointment_read(
    db: AsyncSession,
    a: BookingAppointment,
    *,
    direction_name: str,
    specialist_name: str,
    viewer: User | None,
    visit_number: int | None = None,
    visit_label: str | None = None,
    visit_stream: int | None = None,
    visit_stream_day: int | None = None,
    whatsapp_confirmation_sent: bool = False,
) -> BookingAppointmentRead:
    can = False
    if viewer is not None:
        can = await compute_can_manage_journal(db, a, viewer)
    st = (a.service_title or "").strip() or None
    if not whatsapp_confirmation_sent:
        from app.services.whatsapp_automation import booking_whatsapp_confirmation_sent

        whatsapp_confirmation_sent = await booking_whatsapp_confirmation_sent(db, int(a.id))
    from app.services.patient_phone_visibility import resolve_phone_fields

    pipeline_id = a.pipeline_id
    if pipeline_id is None and viewer is not None:
        pipeline_id = None
    phone_raw = a.patient_phone
    phone_val, phone_display, can_view = (
        await resolve_phone_fields(db, viewer, pipeline_id, phone_raw)
        if viewer is not None
        else (phone_raw, phone_raw, True)
    )
    return BookingAppointmentRead(
        id=a.id,
        lead_id=a.lead_id,
        specialist_id=a.specialist_id,
        direction_id=a.direction_id,
        patient_name=a.patient_name,
        patient_phone=phone_val if phone_val is not None else (phone_display or ""),
        patient_phone_display=phone_display,
        patient_phone_can_view_full=can_view,
        start_at=_ensure_utc(a.start_at),
        end_at=_ensure_utc(a.end_at),
        status=a.status,
        service_amount=float(a.service_amount or 0),
        paid_amount=float(a.paid_amount or 0),
        responsible_manager_id=a.responsible_manager_id,
        service_title=st,
        direction_name=direction_name,
        specialist_name=specialist_name,
        comment=a.comment,
        can_manage_journal=can,
        visit_number=visit_number,
        visit_label=visit_label,
        visit_stream=visit_stream,
        visit_stream_day=visit_stream_day,
        whatsapp_confirmation_sent=whatsapp_confirmation_sent,
    )


def _norm_work_weekdays(raw: list | None) -> list[int]:
    if raw is None or len(raw) == 0:
        return [0, 1, 2, 3, 4]
    return sorted({int(x) for x in raw if 0 <= int(x) <= 6})


def _apply_course_stream_fields(s: BookingSpecialist, data: dict) -> None:
    if "course_streams_enabled" in data and data["course_streams_enabled"] is not None:
        s.course_streams_enabled = bool(data["course_streams_enabled"])
    if "course_stream_max_days" in data and data["course_stream_max_days"] is not None:
        s.course_stream_max_days = int(data["course_stream_max_days"])
    if "course_stream_min_day_for_next" in data and data["course_stream_min_day_for_next"] is not None:
        s.course_stream_min_day_for_next = int(data["course_stream_min_day_for_next"])
    if "course_stream_gap_days" in data and data["course_stream_gap_days"] is not None:
        s.course_stream_gap_days = int(data["course_stream_gap_days"])


def _apply_direction_course_stream_fields(d: BookingDirection, data: dict) -> None:
    if "course_streams_enabled" in data and data["course_streams_enabled"] is not None:
        d.course_streams_enabled = bool(data["course_streams_enabled"])
    if "course_stream_max_days" in data and data["course_stream_max_days"] is not None:
        d.course_stream_max_days = int(data["course_stream_max_days"])
    if "course_stream_min_day_for_next" in data and data["course_stream_min_day_for_next"] is not None:
        d.course_stream_min_day_for_next = int(data["course_stream_min_day_for_next"])
    if "course_stream_gap_days" in data and data["course_stream_gap_days"] is not None:
        d.course_stream_gap_days = int(data["course_stream_gap_days"])


def _direction_read(d: BookingDirection, pipeline_name: str | None) -> BookingDirectionRead:
    return BookingDirectionRead(
        id=d.id,
        name=d.name,
        duration_min=d.duration_min,
        is_active=d.is_active,
        pipeline_id=d.pipeline_id,
        pipeline_name=pipeline_name,
        course_streams_enabled=bool(getattr(d, "course_streams_enabled", False)),
        course_stream_max_days=int(getattr(d, "course_stream_max_days", 15) or 15),
        course_stream_min_day_for_next=int(getattr(d, "course_stream_min_day_for_next", 10) or 10),
        course_stream_gap_days=int(getattr(d, "course_stream_gap_days", 10) or 10),
    )


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
        course_streams_enabled=bool(getattr(s, "course_streams_enabled", False)),
        course_stream_max_days=int(getattr(s, "course_stream_max_days", 15) or 15),
        course_stream_min_day_for_next=int(getattr(s, "course_stream_min_day_for_next", 10) or 10),
        course_stream_gap_days=int(getattr(s, "course_stream_gap_days", 10) or 10),
    )


def _course_streams_enabled_for_booking(specialist: BookingSpecialist, direction: BookingDirection) -> bool:
    if bool(getattr(direction, "course_streams_enabled", False)):
        return True
    return bool(getattr(specialist, "course_streams_enabled", False))


def _date_ymd_in_booking_tz(dt: datetime) -> str:
    tz = ZoneInfo(settings.booking_timezone)
    return dt.astimezone(tz).strftime("%Y-%m-%d")


def _add_booking_calendar_days(start_at: datetime, days: int) -> datetime:
    tz = ZoneInfo(settings.booking_timezone)
    local = start_at.astimezone(tz)
    return (local + timedelta(days=days)).astimezone(UTC)


async def _count_booked_appointments_on_day(
    db: AsyncSession,
    specialist_id: int,
    date_ymd: str,
) -> int:
    day_start, day_end = _day_bounds_utc_for_booking_tz(date_ymd)
    r = await db.execute(
        select(func.count())
        .select_from(BookingAppointment)
        .where(
            BookingAppointment.specialist_id == specialist_id,
            BookingAppointment.status == "booked",
            BookingAppointment.start_at >= day_start,
            BookingAppointment.start_at < day_end,
        ),
    )
    return int(r.scalar_one())


async def _assert_slot_available(
    db: AsyncSession,
    specialist: BookingSpecialist,
    specialist_id: int,
    start_at: datetime,
    duration_min: int,
) -> None:
    _assert_slot_in_specialist_schedule(specialist, start_at)
    end_at = start_at + timedelta(minutes=duration_min)
    overlap = await db.execute(
        select(BookingAppointment.id)
        .where(
            BookingAppointment.specialist_id == specialist_id,
            BookingAppointment.status == "booked",
            BookingAppointment.end_at > start_at,
            BookingAppointment.start_at < end_at,
        )
        .limit(1),
    )
    if overlap.scalar_one_or_none() is not None:
        date_ymd = _date_ymd_in_booking_tz(start_at)
        local = start_at.astimezone(ZoneInfo(settings.booking_timezone))
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Слот занят: {date_ymd} {local.strftime('%H:%M')}",
        )
    day_ymd = _date_ymd_in_booking_tz(start_at)
    booked_count = await _count_booked_appointments_on_day(db, specialist_id, day_ymd)
    if booked_count >= MAX_BOOKINGS_PER_SPECIALIST_DAY:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Лимит записей на день ({MAX_BOOKINGS_PER_SPECIALIST_DAY}): {day_ymd}",
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
    company_id: CurrentCompanyId,
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
        .where(Lead.company_id == company_id, Lead.status_id == q_sid)
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
    company_id: CurrentCompanyId,
) -> LeadRead:
    await _assert_expert_readonly_for_booking(db, current_user)
    q_sid = await _stage_id_by_name(db, settings.booking_queue_stage_name)
    if q_sid is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Stage '{settings.booking_queue_stage_name}' not found",
        )

    stage_row = await db.get(PipelineStage, q_sid)
    if stage_row is not None and stage_row.company_id != company_id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Stage belongs to another company")
    pipeline_id = stage_row.pipeline_id if stage_row else None
    manager_id: int | None = None
    if pipeline_id is not None:
        pipe = await db.get(Pipeline, int(pipeline_id))
        exclude_id = int(pipe.intake_manager_user_id) if pipe and pipe.intake_manager_user_id is not None else None
        assigned = await assign_manager_for_new_lead(db, pipeline_id=pipeline_id, exclude_user_id=exclude_id)
        if assigned is not None:
            manager_id = assigned
    if manager_id is None and current_user.role == UserRole.manager:
        # Только менеджер может стать ответственным; owner/admin — никогда.
        manager_id = current_user.id

    lead = Lead(
        company_id=company_id,
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
    company_id: CurrentCompanyId,
    pipeline_id: int | None = None,
) -> list[BookingDirectionRead]:
    q = (
        select(BookingDirection, Pipeline.name)
        .join(Pipeline, Pipeline.id == BookingDirection.pipeline_id, isouter=True)
        .where(BookingDirection.company_id == company_id)
        .order_by(BookingDirection.id.desc())
    )
    if pipeline_id is not None:
        q = q.where(BookingDirection.pipeline_id == pipeline_id)
    result = await db.execute(q)
    rows = result.all()
    return [_direction_read(d, pname) for d, pname in rows]


@router.post("/directions", response_model=BookingDirectionRead, status_code=status.HTTP_201_CREATED)
async def create_direction(
    body: BookingDirectionCreate,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentUser,
    company_id: CurrentCompanyId,
) -> BookingDirectionRead:
    await _assert_expert_readonly_for_booking(db, current_user)
    pipe = await db.get(Pipeline, body.pipeline_id)
    if pipe is None or pipe.company_id != company_id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Неизвестная воронка")
    row = BookingDirection(
        name=body.name.strip(),
        duration_min=body.duration_min,
        is_active=True,
        company_id=company_id,
        pipeline_id=body.pipeline_id,
    )
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
    return _direction_read(row, pipe.name)


@router.patch("/directions/{direction_id}", response_model=BookingDirectionRead)
async def patch_direction(
    direction_id: int,
    body: BookingDirectionUpdate,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentUser,
    company_id: CurrentCompanyId,
) -> BookingDirectionRead:
    await _assert_expert_readonly_for_booking(db, current_user)
    d = await db.get(BookingDirection, direction_id)
    if d is None or d.company_id != company_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Направление не найдено")
    patch = body.model_dump(exclude_unset=True)
    if not patch:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Нет полей для обновления")
    if "name" in patch and body.name is not None:
        d.name = body.name.strip()
    if "duration_min" in patch and body.duration_min is not None:
        d.duration_min = body.duration_min
    if "is_active" in patch and body.is_active is not None:
        d.is_active = body.is_active
    if "pipeline_id" in patch and body.pipeline_id is not None:
        p = await db.get(Pipeline, body.pipeline_id)
        if p is None or p.company_id != company_id:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Неизвестная воронка")
        d.pipeline_id = body.pipeline_id
    _apply_direction_course_stream_fields(d, patch)
    await db.flush()
    p_name: str | None = None
    if d.pipeline_id is not None:
        p = await db.get(Pipeline, d.pipeline_id)
        p_name = p.name if p is not None else None
    return _direction_read(d, p_name)


@router.delete("/directions/{direction_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_direction(
    direction_id: int,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentUser,
    company_id: CurrentCompanyId,
) -> Response:
    await _assert_expert_readonly_for_booking(db, current_user)
    d = await db.get(BookingDirection, direction_id)
    if d is None or d.company_id != company_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Направление не найдено")
    # Мягкое «удаление»: услуга скрывается из новых записей, но строка остаётся —
    # существующие записи и FK не ломаются (в отличие от физического DELETE с RESTRICT).
    if not d.is_active:
        return Response(status_code=status.HTTP_204_NO_CONTENT)
    suffix = f" [архив #{d.id}]"
    if "[архив #" not in d.name:
        base = d.name.strip()
        new_name = f"{base}{suffix}"
        if len(new_name) > 255:
            new_name = f"{base[: max(1, 255 - len(suffix))]}{suffix}"
        d.name = new_name
    d.is_active = False
    await db.flush()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/specialists", response_model=list[BookingSpecialistRead])
async def list_specialists(
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentUser,
    company_id: CurrentCompanyId,
) -> list[BookingSpecialistRead]:
    await ensure_active_expert_booking_profiles(db, company_id)
    q = (
        select(BookingSpecialist, BookingDirection.name)
        .join(BookingDirection, BookingSpecialist.direction_id == BookingDirection.id)
        .where(BookingSpecialist.company_id == company_id, BookingDirection.company_id == company_id)
    )
    if current_user.role == UserRole.expert:
        chief_pids = await _expert_chief_pipeline_ids(db, current_user)
        if chief_pids:
            q = q.where(_specialists_visible_to_chief_expert(pipeline_ids=chief_pids, company_id=company_id))
        else:
            q = q.where(BookingSpecialist.crm_user_id == current_user.id)
    q = q.order_by(BookingSpecialist.sort_order.asc(), BookingSpecialist.id.asc())
    result = await db.execute(q)
    rows = result.all()
    return [_specialist_read(s, dname) for s, dname in rows]


@router.post("/specialists", response_model=BookingSpecialistRead, status_code=status.HTTP_201_CREATED)
async def create_specialist(
    body: BookingSpecialistCreate,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentUser,
    company_id: CurrentCompanyId,
) -> BookingSpecialistRead:
    await _assert_expert_readonly_for_booking(db, current_user)
    dir_id = body.direction_id
    if dir_id is None:
        dir_id = await resolve_default_booking_direction_id(db, company_id)
    d = await db.get(BookingDirection, dir_id)
    if d is None or d.company_id != company_id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Неизвестное направление")
    spec = (body.specialization or "").strip() or None
    mx = await db.execute(select(func.coalesce(func.max(BookingSpecialist.sort_order), -1)))
    next_sort = int(mx.scalar_one()) + 1
    s = BookingSpecialist(
        company_id=company_id,
        full_name=body.full_name.strip(),
        direction_id=dir_id,
        phone=(body.phone or "").strip() or None,
        specialization=spec,
        is_active=True,
        sort_order=next_sort,
        slot_duration_min=body.slot_duration_min,
        work_start_hour=body.work_start_hour,
        work_end_hour=body.work_end_hour,
        work_weekdays=list(body.work_weekdays),
        course_streams_enabled=body.course_streams_enabled,
        course_stream_max_days=body.course_stream_max_days,
        course_stream_min_day_for_next=body.course_stream_min_day_for_next,
        course_stream_gap_days=body.course_stream_gap_days,
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
    await _assert_expert_readonly_for_booking(db, current_user)
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
    if "slot_duration_min" in patch and body.slot_duration_min is not None:
        s.slot_duration_min = body.slot_duration_min
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


@router.delete("/specialists/{specialist_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_specialist(
    specialist_id: int,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentUser,
) -> Response:
    await _assert_expert_readonly_for_booking(db, current_user)
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
    await _assert_expert_readonly_for_booking(db, current_user)
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


def _norm_patient_name(name: str) -> str:
    return " ".join((name or "").strip().lower().split())


async def _find_lead_by_phone_for_booking(
    db: AsyncSession,
    *,
    company_id: int,
    phone_digits: str,
) -> Lead | None:
    return await find_lead_by_any_phone(db, company_id=company_id, phone=phone_digits)


async def _find_lead_by_name_for_booking(
    db: AsyncSession,
    *,
    company_id: int,
    patient_name: str,
) -> Lead | None:
    key = _norm_patient_name(patient_name)
    if len(key) < 4:
        return None
    first_token = key.split(" ", 1)[0]
    candidates = (
        await db.execute(
            select(Lead)
            .where(
                Lead.company_id == company_id,
                Lead.name.is_not(None),
                Lead.name.ilike(f"%{first_token}%"),
            )
            .order_by(Lead.id.desc())
            .limit(40),
        )
    ).scalars().all()
    for lead in candidates:
        if _norm_patient_name(lead.name or "") == key:
            return lead
    return None


async def _upsert_lead_for_appointment(
    db: AsyncSession,
    *,
    company_id: int,
    patient_name: str,
    patient_phone: str,
    responsible_manager_id: int | None,
    lead_pipeline_id: int | None,
    lead_stage_id: int | None,
) -> int | None:
    phone_digits = _norm_phone(patient_phone) or ""
    found: Lead | None = None
    if phone_digits:
        found = await _find_lead_by_phone_for_booking(db, company_id=company_id, phone_digits=phone_digits)
    if found is None and patient_name.strip():
        found = await _find_lead_by_name_for_booking(db, company_id=company_id, patient_name=patient_name)

    if found is not None:
        name_s = patient_name.strip()
        if name_s and (not (found.name or "").strip() or (found.name or "").strip() == "Клиент"):
            found.name = name_s
        if phone_digits and not _norm_phone(found.phone):
            found.phone = phone_digits
        await db.flush()
        return found.id

    if not phone_digits:
        return None

    stage_id = lead_stage_id
    if stage_id is not None and lead_pipeline_id is not None:
        stage = await db.get(PipelineStage, stage_id)
        if stage is None or stage.pipeline_id != lead_pipeline_id:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Стадия не относится к выбранной воронке")
    if stage_id is None and lead_pipeline_id is not None:
        stage_id = await resolve_new_lead_stage_id(
            db,
            pipeline_id=lead_pipeline_id,
            preferred_stage_id=None,
            default_name="Новый",
        )
    if stage_id is None:
        stage_id = await _stage_id_by_name(db, settings.booking_stage_after_book)
    if stage_id is None:
        return None

    stage = await db.get(PipelineStage, stage_id)
    pipeline_id = stage.pipeline_id if stage else None
    manager_id = responsible_manager_id
    if manager_id is not None:
        resp_user = await db.get(User, int(manager_id))
        if resp_user is None or resp_user.company_id != company_id or resp_user.role != UserRole.manager:
            # Владелец/админ воронки не могут быть ответственными за лид.
            manager_id = None
    if manager_id is None and pipeline_id is not None:
        pipe = await db.get(Pipeline, int(pipeline_id))
        exclude_id = int(pipe.intake_manager_user_id) if pipe and pipe.intake_manager_user_id is not None else None
        manager_id = await assign_manager_for_new_lead(db, pipeline_id=pipeline_id, exclude_user_id=exclude_id)

    lead = Lead(
        company_id=company_id,
        name=patient_name.strip() or "Клиент",
        phone=phone_digits,
        source="Онлайн-запись",
        status_id=stage_id,
        manager_id=manager_id,
    )
    db.add(lead)
    await db.flush()
    return lead.id


@router.get("/viewer-context", response_model=BookingViewerContext)
async def booking_viewer_context(
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentUser,
) -> BookingViewerContext:
    """Главный эксперт воронки видит номер сеанса вместо времени; остальные — у #ID MetodiOne на карточке."""
    if current_user.role != UserRole.expert:
        return BookingViewerContext(is_chief_expert=False, show_session_instead_of_time=False)
    chief_pids = await _expert_chief_pipeline_ids(db, current_user)
    is_chief = bool(chief_pids)
    return BookingViewerContext(is_chief_expert=is_chief, show_session_instead_of_time=is_chief)


@router.get("/appointments", response_model=list[BookingAppointmentRead])
async def list_appointments(
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentUser,
    company_id: CurrentCompanyId,
    date: str | None = None,
    date_to: str | None = None,
    specialist_id: int | None = None,
    lead_id: int | None = None,
) -> list[BookingAppointmentRead]:
    q = (
        select(
            BookingAppointment,
            BookingDirection.name,
            BookingDirection.pipeline_id,
            BookingSpecialist.full_name,
        )
        .join(BookingDirection, BookingAppointment.direction_id == BookingDirection.id)
        .join(BookingSpecialist, BookingAppointment.specialist_id == BookingSpecialist.id)
        .where(BookingAppointment.company_id == company_id)
    )
    if lead_id is not None:
        q = q.where(BookingAppointment.lead_id == lead_id)
    if date:
        try:
            day_start, _ = _day_bounds_utc_for_booking_tz(date)
            if date_to:
                _, day_end = _day_bounds_utc_for_booking_tz(date_to)
            else:
                _, day_end = _day_bounds_utc_for_booking_tz(date)
        except ValueError:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Неверная дата")
        q = q.where(BookingAppointment.start_at >= day_start, BookingAppointment.start_at < day_end)
    if specialist_id is not None:
        q = q.where(BookingAppointment.specialist_id == specialist_id)
    if current_user.role == UserRole.expert:
        chief_pids = await _expert_chief_pipeline_ids(db, current_user)
        if chief_pids:
            q = q.where(_appointment_in_pipelines(pipeline_ids=chief_pids))
        else:
            q = q.where(BookingSpecialist.crm_user_id == current_user.id)
    q = q.order_by(BookingAppointment.start_at.asc())
    result = await db.execute(q)
    rows = result.all()
    all_ids = [int(r[0].id) for r in rows]
    labels_all = await _visit_labels_for_ids(db, company_id=company_id, appointment_ids=all_ids)
    from app.services.whatsapp_automation import booking_whatsapp_confirmation_sent

    out: list[BookingAppointmentRead] = []
    for a, dname, _dir_pid, sname in rows:
        li = labels_all.get(int(a.id))
        out.append(
            await _booking_appointment_read(
                db,
                a,
                direction_name=dname,
                specialist_name=sname,
                viewer=current_user,
                visit_number=li.visit_number if li else None,
                visit_label=li.visit_label if li else None,
                visit_stream=li.visit_stream if li else None,
                visit_stream_day=li.visit_stream_day if li else None,
                whatsapp_confirmation_sent=await booking_whatsapp_confirmation_sent(db, int(a.id)),
            ),
        )
    return out


@router.get("/patient-history", response_model=list[BookingPatientHistoryItem])
async def booking_patient_history(
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentUser,
    company_id: CurrentCompanyId,
    q: str = Query(..., min_length=2, max_length=120),
    limit: int = Query(20, ge=1, le=100),
) -> list[BookingPatientHistoryItem]:
    term = q.strip()
    if not term:
        return []

    like = f"%{term}%"
    rows = (
        await db.execute(
            select(
                BookingAppointment.id,
                BookingAppointment.patient_name,
                BookingAppointment.patient_phone,
                BookingAppointment.start_at,
                BookingAppointment.status,
                BookingAppointment.service_title,
                BookingAppointment.service_amount,
                BookingAppointment.paid_amount,
                BookingSpecialist.full_name,
                BookingSpecialist.crm_user_id,
            )
            .select_from(BookingAppointment)
            .join(BookingSpecialist, BookingAppointment.specialist_id == BookingSpecialist.id)
            .where(
                BookingAppointment.company_id == company_id,
                or_(
                    BookingAppointment.patient_name.ilike(like),
                    BookingAppointment.patient_phone.ilike(like),
                ),
            )
            .order_by(BookingAppointment.start_at.desc(), BookingAppointment.id.desc())
            .limit(limit * 20)
        )
    ).all()

    if current_user.role == UserRole.expert:
        chief_pids = await _expert_chief_pipeline_ids(db, current_user)
        if chief_pids:
            appt_ids = [int(r[0]) for r in rows]
            if appt_ids:
                pipe_rows = (
                    await db.execute(
                        select(BookingAppointment.id, BookingAppointment.pipeline_id, BookingDirection.pipeline_id)
                        .join(BookingDirection, BookingAppointment.direction_id == BookingDirection.id)
                        .where(BookingAppointment.id.in_(appt_ids))
                    )
                ).all()
                allowed_appt_ids: set[int] = set()
                for aid, appt_pid, dir_pid in pipe_rows:
                    if appt_pid is not None and int(appt_pid) in chief_pids:
                        allowed_appt_ids.add(int(aid))
                    elif dir_pid is not None and int(dir_pid) in chief_pids:
                        allowed_appt_ids.add(int(aid))
                rows = [r for r in rows if int(r[0]) in allowed_appt_ids]
            else:
                rows = []
        else:
            rows = [r for r in rows if r[9] and int(r[9]) == current_user.id]

    grouped: dict[tuple[str, str], BookingPatientHistoryItem] = {}
    for (
        appt_id,
        patient_name,
        patient_phone,
        start_at,
        status_value,
        service_title,
        service_amount,
        paid_amount,
        specialist_name,
        _specialist_crm_user_id,
    ) in rows:
        name = (patient_name or "").strip() or "Клиент"
        phone = (patient_phone or "").strip() or "—"
        key = (name.lower(), phone)
        item = grouped.get(key)
        if item is None:
            item = BookingPatientHistoryItem(
                patient_name=name,
                patient_phone=phone,
                total_visits=0,
                first_visit_at=None,
                last_visit_at=None,
                visits=[],
            )
            grouped[key] = item
        item.total_visits += 1
        if item.first_visit_at is None or start_at < item.first_visit_at:
            item.first_visit_at = start_at
        if item.last_visit_at is None or start_at > item.last_visit_at:
            item.last_visit_at = start_at
        item.visits.append(
            BookingPatientVisitRead(
                appointment_id=int(appt_id),
                start_at=start_at,
                specialist_name=specialist_name,
                status=str(status_value),
                service_title=(service_title or "").strip() or None,
                service_amount=float(service_amount or 0),
                paid_amount=float(paid_amount or 0),
            )
        )

    out = list(grouped.values())
    out.sort(key=lambda x: (x.last_visit_at or datetime.min.replace(tzinfo=UTC)), reverse=True)
    for item in out:
        item.visits.sort(key=lambda v: v.start_at, reverse=True)

    from app.services.patient_phone_visibility import resolve_phone_fields

    masked: list[BookingPatientHistoryItem] = []
    for item in out[:limit]:
        phone_val, phone_display, can_view = await resolve_phone_fields(
            db, current_user, None, item.patient_phone,
        )
        masked.append(
            item.model_copy(
                update={
                    "patient_phone": phone_val if phone_val is not None else (phone_display or "—"),
                    "patient_phone_display": phone_display,
                    "patient_phone_can_view_full": can_view,
                },
            ),
        )
    return masked


def _suggest_dedupe_key(phone: str, name: str) -> str:
    digits = _norm_phone(phone) or ""
    if len(digits) >= 7:
        return f"p:{digits[-9:]}"
    return f"n:{_norm_patient_name(name)}"


def _lead_matches_suggest_term(lead: Lead, term: str, phone_digits: str) -> bool:
    name_l = (lead.name or "").lower()
    phone_raw = (lead.phone or "").lower()
    if term.lower() in name_l:
        return True
    if term.lower() in phone_raw:
        return True
    ln = _norm_phone(lead.phone)
    if phone_digits and ln:
        if ln == phone_digits or (len(phone_digits) >= 9 and len(ln) >= 9 and ln[-9:] == phone_digits[-9:]):
            return True
    return False


@router.get("/patient-suggest", response_model=list[BookingPatientSuggestItem])
async def booking_patient_suggest(
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentUser,
    company_id: CurrentCompanyId,
    q: str = Query(..., min_length=2, max_length=120),
    limit: int = Query(12, ge=1, le=30),
) -> list[BookingPatientSuggestItem]:
    """Подсказки клиентов при заполнении формы записи (CRM + прошлые визиты)."""
    term = q.strip()
    if len(term) < 2:
        return []

    like = f"%{term}%"
    phone_digits = _norm_phone(term) or ""
    seen: set[str] = set()
    out: list[BookingPatientSuggestItem] = []

    def push(item: BookingPatientSuggestItem) -> None:
        key = _suggest_dedupe_key(item.patient_phone, item.patient_name)
        if key in seen:
            return
        seen.add(key)
        out.append(item)

    lead_filters = [Lead.name.ilike(like), Lead.phone.ilike(like)]
    if phone_digits and len(phone_digits) >= 4:
        lead_filters.append(Lead.phone.ilike(f"%{phone_digits[-9:]}%"))

    lead_rows = (
        await db.execute(
            select(Lead, User.full_name)
            .outerjoin(User, User.id == Lead.manager_id)
            .where(Lead.company_id == company_id, or_(*lead_filters))
            .order_by(Lead.id.desc())
            .limit(60),
        )
    ).all()

    from app.services.patient_phone_visibility import resolve_phone_fields

    for lead, mgr_name in lead_rows:
        if not _lead_matches_suggest_term(lead, term, phone_digits):
            continue
        await db.refresh(lead, ["stage"])
        pipeline_id = lead.stage.pipeline_id if lead.stage else None
        phone_val, phone_display, can_view = await resolve_phone_fields(
            db, current_user, pipeline_id, lead.phone,
        )
        push(
            BookingPatientSuggestItem(
                lead_id=int(lead.id),
                patient_name=(lead.name or "").strip() or "Клиент",
                patient_phone=phone_val if phone_val is not None else (phone_display or "—"),
                patient_phone_display=phone_display,
                patient_phone_can_view_full=can_view,
                manager_name=(mgr_name or "").strip() or None,
                source="crm",
            ),
        )
        if len(out) >= limit:
            return out[:limit]

    appt_filters = [
        BookingAppointment.patient_name.ilike(like),
        BookingAppointment.patient_phone.ilike(like),
    ]
    if phone_digits and len(phone_digits) >= 4:
        appt_filters.append(BookingAppointment.patient_phone.ilike(f"%{phone_digits[-9:]}%"))

    appt_rows = (
        await db.execute(
            select(
                BookingAppointment.lead_id,
                BookingAppointment.patient_name,
                BookingAppointment.patient_phone,
            )
            .where(BookingAppointment.company_id == company_id, or_(*appt_filters))
            .order_by(BookingAppointment.start_at.desc(), BookingAppointment.id.desc())
            .limit(80),
        )
    ).all()

    appt_lead_ids = {int(r[0]) for r in appt_rows if r[0] is not None}
    mgr_by_lead: dict[int, str | None] = {}
    if appt_lead_ids:
        mgr_rows = (
            await db.execute(
                select(Lead.id, User.full_name)
                .outerjoin(User, User.id == Lead.manager_id)
                .where(Lead.company_id == company_id, Lead.id.in_(appt_lead_ids)),
            )
        ).all()
        mgr_by_lead = {int(lid): (str(name).strip() if name else None) for lid, name in mgr_rows}

    for lead_id, patient_name, patient_phone in appt_rows:
        name = (patient_name or "").strip() or "Клиент"
        phone = (patient_phone or "").strip() or "—"
        if phone_digits:
            pn = _norm_phone(phone)
            if pn and pn != phone_digits and (len(phone_digits) < 9 or len(pn) < 9 or pn[-9:] != phone_digits[-9:]):
                if term.lower() not in name.lower():
                    continue
        mgr_name = mgr_by_lead.get(int(lead_id)) if lead_id is not None else None
        pipeline_id: int | None = None
        if lead_id is not None:
            lead_row = await db.get(Lead, int(lead_id))
            if lead_row is not None:
                await db.refresh(lead_row, ["stage"])
                pipeline_id = lead_row.stage.pipeline_id if lead_row.stage else None
        phone_val, phone_display, can_view = await resolve_phone_fields(
            db, current_user, pipeline_id, phone,
        )
        push(
            BookingPatientSuggestItem(
                lead_id=int(lead_id) if lead_id is not None else None,
                patient_name=name,
                patient_phone=phone_val if phone_val is not None else (phone_display or "—"),
                patient_phone_display=phone_display,
                patient_phone_can_view_full=can_view,
                manager_name=mgr_name,
                source="visits",
            ),
        )
        if len(out) >= limit:
            break

    return out[:limit]


@router.post("/appointments", response_model=BookingAppointmentRead, status_code=status.HTTP_201_CREATED)
async def create_appointment(
    body: BookingAppointmentCreate,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentUser,
    company_id: CurrentCompanyId,
) -> BookingAppointmentRead:
    await _assert_expert_readonly_for_booking(db, current_user)
    await ensure_active_expert_booking_profiles(db, company_id)
    specialist = await db.get(BookingSpecialist, body.specialist_id)
    if specialist is None or specialist.company_id != company_id or not specialist.is_active:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Специалист не найден")
    await _assert_expert_specialist_access(db, current_user, specialist)
    resolved_direction_id = int(specialist.direction_id)
    if body.direction_id is not None and int(body.direction_id) != resolved_direction_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="direction_id не совпадает с направлением выбранного специалиста",
        )
    direction = await db.get(BookingDirection, resolved_direction_id)
    if direction is None or direction.company_id != company_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Направление не найдено")

    start_at = _from_payload_to_utc(body.start_at)
    duration_min = _appointment_duration_minutes(specialist, direction)
    consecutive_days = int(body.consecutive_days or 1)
    if consecutive_days > 1:
        if not _course_streams_enabled_for_booking(specialist, direction):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Запись на несколько дней подряд доступна только для направлений с потоками",
            )
    start_times = [_add_booking_calendar_days(start_at, offset) for offset in range(consecutive_days)]
    for slot_start in start_times:
        await _assert_slot_available(db, specialist, body.specialist_id, slot_start, duration_min)
    if (
        current_user.role == UserRole.manager
        and float(body.paid_amount or 0) > 0
        and body.responsible_manager_id is None
    ):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Менеджер не может указать оплату без ответственного менеджера",
        )

    lead_id = body.lead_id
    appointment_pipeline_id: int | None = None
    resolved_manager_id = body.responsible_manager_id
    if resolved_manager_id is not None:
        resp_user = await db.get(User, int(resolved_manager_id))
        if resp_user is None or resp_user.company_id != company_id or resp_user.role != UserRole.manager:
            resolved_manager_id = None
            if current_user.role == UserRole.manager and float(body.paid_amount or 0) > 0:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="Ответственным может быть только менеджер",
                )
    if lead_id is not None:
        lead = await db.get(Lead, lead_id)
        if lead is None or lead.company_id != company_id:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Лид не найден")
        await db.refresh(lead, ["stage"])
        appointment_pipeline_id = lead.stage.pipeline_id if lead.stage else None
        if lead.manager_id is not None:
            resolved_manager_id = lead.manager_id
    else:
        lead_id = await _upsert_lead_for_appointment(
            db,
            company_id=company_id,
            patient_name=body.patient_name,
            patient_phone=body.patient_phone,
            responsible_manager_id=body.responsible_manager_id,
            lead_pipeline_id=body.lead_pipeline_id,
            lead_stage_id=body.lead_stage_id,
        )
        appointment_pipeline_id = body.lead_pipeline_id
        if lead_id is not None:
            lead = await db.get(Lead, lead_id)
            if lead is not None:
                await db.refresh(lead, ["stage"])
                if appointment_pipeline_id is None:
                    appointment_pipeline_id = lead.stage.pipeline_id if lead.stage else None
                if lead.manager_id is not None:
                    resolved_manager_id = lead.manager_id

    service_amount_value = float(body.service_amount)
    if appointment_pipeline_id is not None:
        fixed_price = await get_kpi_service_price(
            db,
            company_id=company_id,
            pipeline_id=int(appointment_pipeline_id),
            direction_id=resolved_direction_id,
            at_datetime=start_at,
        )
        if fixed_price is not None:
            service_amount_value = float(fixed_price)
    if float(body.paid_amount or 0) > float(service_amount_value):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Оплата не может быть больше стоимости услуги")

    if lead_id is not None and body.extra_phones:
        lead_for_extras = await db.get(Lead, lead_id)
        if lead_for_extras is not None:
            await sync_lead_extra_phones(
                db,
                company_id=company_id,
                lead_id=lead_id,
                extra_phones=body.extra_phones,
                primary_phone=lead_for_extras.phone or body.patient_phone,
            )

    now = datetime.now(UTC)
    service_title = (body.service_title or "").strip()
    stored_phone = body.patient_phone.strip()
    if lead_id is not None:
        lead_for_phone = await db.get(Lead, lead_id)
        if lead_for_phone is not None and (lead_for_phone.phone or "").strip():
            stored_phone = (lead_for_phone.phone or "").strip()

    created_appts: list[BookingAppointment] = []
    wa_sent = False
    for idx, slot_start in enumerate(start_times):
        slot_end = slot_start + timedelta(minutes=duration_min)
        # Каждый день серии = отдельный сеанс (массаж/логопед и т.п.): своя стоимость.
        # Оплату при создании пишем только в первый день; дальше — доплаты по факту визита.
        slot_service_amount = float(body.service_amount)
        if appointment_pipeline_id is not None:
            fixed_price = await get_kpi_service_price(
                db,
                company_id=company_id,
                pipeline_id=int(appointment_pipeline_id),
                direction_id=resolved_direction_id,
                at_datetime=slot_start,
            )
            if fixed_price is not None:
                slot_service_amount = float(fixed_price)
        slot_paid = float(body.paid_amount) if idx == 0 else 0.0
        appt = BookingAppointment(
            company_id=company_id,
            lead_id=lead_id,
            pipeline_id=appointment_pipeline_id,
            patient_name=body.patient_name.strip(),
            patient_phone=stored_phone,
            direction_id=resolved_direction_id,
            specialist_id=body.specialist_id,
            start_at=slot_start,
            end_at=slot_end,
            status="booked",
            service_amount=slot_service_amount,
            paid_amount=slot_paid,
            responsible_manager_id=resolved_manager_id,
            created_by_user_id=current_user.id,
            comment=((body.comment or "").strip() or None) if idx == 0 else None,
            service_title=service_title,
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
            details=(
                f"lead_id={appt.lead_id}, specialist_id={appt.specialist_id}, "
                f"start_at={appt.start_at.isoformat()}, series={idx + 1}/{consecutive_days}"
            ),
        )
        created_appts.append(appt)

    if lead_id is not None:
        await _sync_lead_to_stage_name(db, lead_id, settings.booking_stage_after_book)

    if created_appts:
        wa_sent = await send_booking_confirmation_if_needed(db, appointment=created_appts[0])

    appt = created_appts[0]
    await db.refresh(appt)

    dname = direction.name
    sname = specialist.full_name
    labels = await _visit_labels_for_ids(db, company_id=company_id, appointment_ids=[int(appt.id)])
    li = labels.get(int(appt.id))
    return await _booking_appointment_read(
        db,
        appt,
        direction_name=dname,
        specialist_name=sname,
        viewer=current_user,
        visit_number=li.visit_number if li else None,
        visit_label=li.visit_label if li else None,
        visit_stream=li.visit_stream if li else None,
        visit_stream_day=li.visit_stream_day if li else None,
        whatsapp_confirmation_sent=wa_sent,
    )


@router.patch("/appointments/{appointment_id}/move", response_model=BookingAppointmentRead)
async def move_appointment(
    appointment_id: int,
    body: BookingAppointmentMove,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentUser,
    company_id: CurrentCompanyId,
) -> BookingAppointmentRead:
    await _assert_expert_readonly_for_booking(db, current_user)
    appt = await db.get(BookingAppointment, appointment_id)
    if appt is None or appt.company_id != company_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Запись не найдена")
    if current_user.role == UserRole.expert and appt.specialist_id is not None:
        current_spec = await db.get(BookingSpecialist, appt.specialist_id)
        if current_spec is not None:
            await _assert_expert_specialist_access(db, current_user, current_spec)
    if appt.status != "booked":
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Перенос доступен только для активных записей")

    specialist = await db.get(BookingSpecialist, body.specialist_id)
    if specialist is None or specialist.company_id != company_id or not specialist.is_active:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Специалист не найден")
    await _assert_expert_specialist_access(db, current_user, specialist)

    direction = await db.get(BookingDirection, specialist.direction_id)
    if direction is None or direction.company_id != company_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Направление не найдено")

    start_at = _from_payload_to_utc(body.start_at)
    _assert_slot_in_specialist_schedule(specialist, start_at)
    duration_min = _appointment_duration_minutes(specialist, direction)
    end_at = start_at + timedelta(minutes=duration_min)

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
    appt.direction_id = specialist.direction_id
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

    return await _booking_appointment_read(
        db,
        appt,
        direction_name=direction.name,
        specialist_name=specialist.full_name,
        viewer=current_user,
    )


@router.patch("/appointments/{appointment_id}/details", response_model=BookingAppointmentRead)
async def patch_appointment_details(
    appointment_id: int,
    body: BookingAppointmentDetailsUpdate,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentUser,
    company_id: CurrentCompanyId,
) -> BookingAppointmentRead:
    await _assert_expert_readonly_for_booking(db, current_user)
    a = await db.get(BookingAppointment, appointment_id)
    if a is None or a.company_id != company_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Запись не найдена")
    if current_user.role == UserRole.expert and a.specialist_id is not None:
        specialist = await db.get(BookingSpecialist, a.specialist_id)
        if specialist is not None:
            await _assert_expert_specialist_access(db, current_user, specialist)

    if body.comment is not None:
        a.comment = (body.comment or "").strip() or None
    if body.service_title is not None:
        title = (body.service_title or "").strip()
        if not title:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Название услуги не может быть пустым")
        a.service_title = title
    a.updated_at = datetime.now(UTC)
    await write_audit_event(
        db,
        entity_type="booking_appointment",
        entity_id=a.id,
        action="appointment_details_updated",
        current_user=current_user,
        details="comment/service_title",
    )

    direction = await db.get(BookingDirection, a.direction_id)
    specialist = await db.get(BookingSpecialist, a.specialist_id)
    return await _booking_appointment_read(
        db,
        a,
        direction_name=direction.name if direction else "",
        specialist_name=specialist.full_name if specialist else "",
        viewer=current_user,
    )


@router.patch("/appointments/{appointment_id}/status", response_model=BookingAppointmentRead)
async def patch_appointment_status(
    appointment_id: int,
    body: BookingAppointmentStatusUpdate,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentUser,
    company_id: CurrentCompanyId,
) -> BookingAppointmentRead:
    await _assert_expert_readonly_for_booking(db, current_user)
    a = await db.get(BookingAppointment, appointment_id)
    if a is None or a.company_id != company_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Запись не найдена")
    if current_user.role == UserRole.expert and a.specialist_id is not None:
        specialist = await db.get(BookingSpecialist, a.specialist_id)
        if specialist is not None:
            await _assert_expert_specialist_access(db, current_user, specialist)

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
    return await _booking_appointment_read(
        db,
        a,
        direction_name=direction.name if direction else "",
        specialist_name=specialist.full_name if specialist else "",
        viewer=current_user,
    )


@router.patch("/appointments/{appointment_id}/payment", response_model=BookingAppointmentRead)
async def patch_appointment_payment(
    appointment_id: int,
    body: BookingAppointmentPaymentUpdate,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentUser,
    company_id: CurrentCompanyId,
) -> BookingAppointmentRead:
    """Оплата/доплата по конкретному сеансу.

    Каждый день серии (массаж, логопед…) — отдельная услуга со своей стоимостью.
    `add_payment` суммируется внутри этой записи; 100% оплаты разных дней суммируются
    в выручке/KPI как отдельные сеансы.
    """
    await _assert_expert_readonly_for_booking(db, current_user)
    appt = await db.get(BookingAppointment, appointment_id)
    if appt is None or appt.company_id != company_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Запись не найдена")
    await _assert_can_manage_appointment_journal(db, appt, current_user)

    tz = ZoneInfo(settings.booking_timezone)
    appt_day = _ensure_utc(appt.start_at).astimezone(tz).date()
    now_day = datetime.now(UTC).astimezone(tz).date()
    if appt_day != now_day:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Менять оплату можно только в день прихода клиента",
        )

    service = float(appt.service_amount or 0)
    prev_paid = float(appt.paid_amount or 0)
    if body.add_payment is not None:
        new_paid = prev_paid + float(body.add_payment)
    else:
        new_paid = float(body.paid_amount or 0)
    if new_paid > service + 1e-9:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Оплата не может быть больше стоимости сеанса ({service:g})",
        )
    if new_paid < 0:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Оплата не может быть отрицательной")

    appt.paid_amount = new_paid
    appt.updated_at = datetime.now(UTC)
    await db.flush()
    await write_audit_event(
        db,
        entity_type="booking_appointment",
        entity_id=appt.id,
        action="appointment_payment_updated",
        current_user=current_user,
        details=(
            f"prev_paid={prev_paid}; add_payment={body.add_payment}; "
            f"paid_amount={body.paid_amount}; new_paid={new_paid}"
        ),
    )

    direction = await db.get(BookingDirection, appt.direction_id)
    specialist = await db.get(BookingSpecialist, appt.specialist_id)
    return await _booking_appointment_read(
        db,
        appt,
        direction_name=direction.name if direction else "",
        specialist_name=specialist.full_name if specialist else "",
        viewer=current_user,
    )


@router.delete("/appointments/{appointment_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_appointment(
    appointment_id: int,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentUser,
    company_id: CurrentCompanyId,
) -> Response:
    await _assert_expert_readonly_for_booking(db, current_user)
    appt = await db.get(BookingAppointment, appointment_id)
    if appt is None or appt.company_id != company_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Запись не найдена")
    await db.delete(appt)
    await db.flush()
    await write_audit_event(
        db,
        entity_type="booking_appointment",
        entity_id=appointment_id,
        action="appointment_deleted",
        current_user=current_user,
        details=f"patient={appt.patient_name}, start_at={_ensure_utc(appt.start_at).isoformat()}",
    )
    return Response(status_code=status.HTTP_204_NO_CONTENT)
