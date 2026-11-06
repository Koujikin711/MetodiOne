"""Электронная мед. карта по lead_id. Без финансов. Диагноз пишется в карту."""

from __future__ import annotations

from datetime import date
from pathlib import Path
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import CurrentCompanyId, CurrentUser, get_db
from app.models import (
    BookingAppointment,
    BookingDirection,
    BookingSpecialist,
    ChatMessage,
    ChatThread,
    CuratorCourseFlow,
    CuratorFlowMembership,
    CuratorJournalComplaint,
    CuratorJournalEntry,
    Deal,
    Lead,
    PatientJourney,
    User,
    UserRole,
)
from app.schemas.emr import (
    EmrBirthUpdate,
    EmrChart,
    EmrComplaintPoint,
    EmrDiagnosisUpdate,
    EmrDocument,
    EmrJourney,
    EmrSearchItem,
    EmrServiceChip,
    EmrTodo,
    EmrVisit,
)
from app.services.clinic_roles import can_access_booking, can_access_curator_journal, can_access_rop
from app.services.emr_chart import (
    age_label,
    build_service_chips,
    complaint_label,
    derive_stages,
    format_complaint_value,
    visit_kind,
    visit_status_label,
)
from app.core.rbac import is_manager_like
from app.services.patient_phone_visibility import resolve_phone_fields

router = APIRouter(prefix="/emr", tags=["emr"])


def _can_access_emr(role: UserRole) -> bool:
    return can_access_booking(role) or can_access_curator_journal(role) or can_access_rop(role)


def _norm_phone(raw: str | None) -> str | None:
    if not raw:
        return None
    digits = "".join(ch for ch in raw if ch.isdigit())
    return digits or None


async def _assert_emr_access(current_user: CurrentUser) -> None:
    if not _can_access_emr(current_user.role):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="EMR access denied")


async def _assert_lead_visible(
    db: AsyncSession,
    *,
    current_user: CurrentUser,
    lead: Lead,
    company_id: int,
) -> None:
    if lead.company_id != company_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Lead not found")
    if is_manager_like(current_user.role) and current_user.role != UserRole.rop:
        await db.refresh(lead, ["stage"])
        if lead.manager_id is not None and lead.manager_id != current_user.id:
            # Менеджер видит чужих только через запись/админские роли — здесь запрет
            if current_user.role == UserRole.manager:
                raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Lead assigned to another manager")


@router.get("/search", response_model=list[EmrSearchItem])
async def emr_search(
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentUser,
    company_id: CurrentCompanyId,
    q: str = Query(..., min_length=2, max_length=120),
    limit: int = Query(12, ge=1, le=30),
) -> list[EmrSearchItem]:
    """Поиск пациента для ЭМК. Всегда с lead_id."""
    await _assert_emr_access(current_user)
    term = q.strip()
    if len(term) < 2:
        return []

    like = f"%{term}%"
    phone_digits = _norm_phone(term) or ""
    lead_filters = [Lead.name.ilike(like), Lead.phone.ilike(like)]
    if phone_digits and len(phone_digits) >= 4:
        lead_filters.append(Lead.phone.ilike(f"%{phone_digits[-9:]}%"))

    rows = (
        await db.execute(
            select(Lead, User.full_name)
            .outerjoin(User, User.id == Lead.manager_id)
            .where(Lead.company_id == company_id, or_(*lead_filters))
            .order_by(Lead.id.desc())
            .limit(60),
        )
    ).all()

    lead_ids = [int(lead.id) for lead, _ in rows]
    birth_by_lead: dict[int, date] = {}
    if lead_ids:
        born_rows = (
            await db.execute(
                select(BookingAppointment.lead_id, BookingAppointment.patient_birth_date)
                .where(
                    BookingAppointment.company_id == company_id,
                    BookingAppointment.lead_id.in_(lead_ids),
                    BookingAppointment.patient_birth_date.is_not(None),
                )
                .order_by(BookingAppointment.start_at.desc(), BookingAppointment.id.desc()),
            )
        ).all()
        for lid, born in born_rows:
            if lid is None or born is None:
                continue
            birth_by_lead.setdefault(int(lid), born)
        for lead, _mgr in rows:
            lid = int(lead.id)
            if lid not in birth_by_lead and lead.patient_birth_date is not None:
                birth_by_lead[lid] = lead.patient_birth_date

    out: list[EmrSearchItem] = []
    seen: set[int] = set()
    for lead, mgr_name in rows:
        lid = int(lead.id)
        if lid in seen:
            continue
        if is_manager_like(current_user.role) and current_user.role == UserRole.manager:
            if lead.manager_id is not None and lead.manager_id != current_user.id:
                continue
        name = (lead.name or "").strip() or "Клиент"
        if phone_digits:
            pn = _norm_phone(lead.phone) or ""
            if pn and pn != phone_digits and (len(phone_digits) < 9 or len(pn) < 9 or pn[-9:] != phone_digits[-9:]):
                if term.lower() not in name.lower():
                    continue
        await db.refresh(lead, ["stage"])
        pipeline_id = lead.stage.pipeline_id if lead.stage else None
        phone_val, phone_display, _can = await resolve_phone_fields(
            db, current_user, pipeline_id, lead.phone,
        )
        seen.add(lid)
        out.append(
            EmrSearchItem(
                lead_id=lid,
                name=name,
                phone=phone_val if phone_val is not None else (phone_display or lead.phone),
                birth_date=birth_by_lead.get(lid),
                manager_name=(mgr_name or "").strip() or None,
            ),
        )
        if len(out) >= limit:
            break
    return out


@router.get("/{lead_id}", response_model=EmrChart)
async def emr_chart(
    lead_id: int,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentUser,
    company_id: CurrentCompanyId,
) -> EmrChart:
    await _assert_emr_access(current_user)
    lead = await db.get(Lead, lead_id)
    if lead is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Lead not found")
    await _assert_lead_visible(db, current_user=current_user, lead=lead, company_id=company_id)
    await db.refresh(lead, ["stage"])

    mgr_name: str | None = None
    if lead.manager_id is not None:
        mgr = await db.get(User, int(lead.manager_id))
        if mgr is not None:
            mgr_name = (mgr.full_name or mgr.email or "").strip() or None

    pipeline_id = lead.stage.pipeline_id if lead.stage else None
    phone_val, phone_display, _can = await resolve_phone_fields(
        db, current_user, pipeline_id, lead.phone,
    )

    visits_q = (
        await db.execute(
            select(
                BookingAppointment.id,
                BookingAppointment.start_at,
                BookingAppointment.status,
                BookingAppointment.service_title,
                BookingAppointment.comment,
                BookingAppointment.patient_birth_date,
                BookingDirection.name,
                BookingSpecialist.full_name,
            )
            .join(BookingDirection, BookingDirection.id == BookingAppointment.direction_id)
            .join(BookingSpecialist, BookingSpecialist.id == BookingAppointment.specialist_id)
            .where(
                BookingAppointment.company_id == company_id,
                BookingAppointment.lead_id == lead_id,
            )
            .order_by(BookingAppointment.start_at.desc(), BookingAppointment.id.desc())
            .limit(300),
        )
    ).all()

    birth_from_booking = False
    birth: date | None = None
    for row in visits_q:
        if row[5] is not None:
            birth = row[5]
            birth_from_booking = True
            break
    if birth is None:
        birth = lead.patient_birth_date

    chips_raw = build_service_chips((r[6], r[3], r[2]) for r in visits_q)

    visits: list[EmrVisit] = []
    attending: str | None = None
    first_visit = None
    has_completed = False
    for appt_id, start_at, st, title, comment, _born, direction, specialist in reversed(visits_q):
        code = str(st or "")
        if code == "completed":
            has_completed = True
            if attending is None and specialist:
                attending = str(specialist)
        if first_visit is None or start_at < first_visit:
            first_visit = start_at
        visits.append(
            EmrVisit(
                appointment_id=int(appt_id),
                start_at=start_at,
                status=visit_status_label(code),
                status_code=code,
                service_title=str(title or direction or "Услуга"),
                direction_name=str(direction) if direction else None,
                specialist_name=str(specialist) if specialist else None,
                comment=(comment or None),
                kind=visit_kind(direction, title),
            ),
        )
    visits.sort(key=lambda v: v.start_at, reverse=True)

    journey_row = (
        await db.execute(
            select(PatientJourney).where(
                PatientJourney.company_id == company_id,
                PatientJourney.lead_id == lead_id,
            ),
        )
    ).scalar_one_or_none()

    membership = (
        await db.execute(
            select(CuratorFlowMembership, CuratorCourseFlow)
            .join(CuratorCourseFlow, CuratorCourseFlow.id == CuratorFlowMembership.flow_id)
            .where(
                CuratorFlowMembership.company_id == company_id,
                CuratorFlowMembership.lead_id == lead_id,
                CuratorFlowMembership.left_on.is_(None),
            )
            .order_by(CuratorFlowMembership.joined_on.desc())
            .limit(1),
        )
    ).first()

    membership_flow = None
    membership_joined = None
    if membership is not None:
        mem, flow = membership
        membership_flow = f"{flow.course_name} · поток {flow.flow_number}"
        membership_joined = mem.joined_on

    c15 = (journey_row.course_15_status if journey_row else "none") or "none"
    stages, current_stage = derive_stages(c15, has_completed, bool(visits_q))

    # Жалобы куратора (динамика proxy)
    mem_ids = (
        await db.execute(
            select(CuratorFlowMembership.id).where(
                CuratorFlowMembership.company_id == company_id,
                CuratorFlowMembership.lead_id == lead_id,
            ),
        )
    ).scalars().all()
    dynamics: list[EmrComplaintPoint] = []
    if mem_ids:
        complaint_rows = (
            await db.execute(
                select(
                    CuratorJournalEntry.entry_date,
                    CuratorJournalComplaint.category,
                    CuratorJournalComplaint.numeric_value,
                    CuratorJournalComplaint.unit,
                    CuratorJournalComplaint.count_value,
                    CuratorJournalComplaint.comment,
                )
                .join(CuratorJournalEntry, CuratorJournalEntry.id == CuratorJournalComplaint.journal_entry_id)
                .where(CuratorJournalEntry.membership_id.in_(list(mem_ids)))
                .order_by(CuratorJournalEntry.entry_date.desc())
                .limit(40),
            )
        ).all()
        for entry_date, category, num, unit, cnt, text in complaint_rows:
            dynamics.append(
                EmrComplaintPoint(
                    at=entry_date,
                    category=str(category),
                    label=complaint_label(str(category)),
                    value=format_complaint_value(
                        numeric_value=float(num) if num is not None else None,
                        unit=unit,
                        count_value=int(cnt) if cnt is not None else None,
                        text_value=text,
                    ),
                ),
            )

    todos: list[EmrTodo] = []
    upcoming = [v for v in visits if v.status_code == "booked"]
    for v in upcoming[:5]:
        todos.append(
            EmrTodo(
                text=f"{v.service_title}" + (f" · {v.specialist_name}" if v.specialist_name else ""),
                at=v.start_at.date() if v.start_at else None,
            ),
        )
    if c15 == "active" and membership_flow:
        todos.append(EmrTodo(text=f"Курс в потоке: {membership_flow}", at=None))

    # warning: recent allergy/rash complaint
    warning = None
    for d in dynamics:
        if d.category in {"rash_or_allergy", "pain"} and d.at >= date.today().replace(day=1):
            warning = f"{d.label}" + (f": {d.value}" if d.value else "")
            break

    return EmrChart(
        lead_id=int(lead.id),
        name=(lead.name or "").strip() or "Пациент",
        phone=phone_val if phone_val is not None else (phone_display or lead.phone),
        birth_date=birth,
        age_label=age_label(birth),
        birth_from_booking=birth_from_booking,
        stage_name=lead.stage.name if lead.stage else None,
        manager_name=mgr_name,
        first_visit_at=first_visit,
        attending_doctor=attending,
        diagnosis=(lead.clinical_diagnosis or "").strip() or None,
        warning=warning,
        service_chips=[EmrServiceChip(**c) for c in chips_raw],
        visits=visits,
        journey=EmrJourney(
            course_15_status=c15,
            course_15_started_at=journey_row.course_15_started_at if journey_row else None,
            course_15_completed_at=journey_row.course_15_completed_at if journey_row else None,
            branch=(journey_row.branch if journey_row else "none") or "none",
            membership_flow=membership_flow,
            membership_joined_on=membership_joined,
        ),
        dynamics=dynamics,
        todos=todos,
        stages=stages,
        current_stage=current_stage,
        documents=await _lead_documents(db, company_id=company_id, lead_id=lead_id),
    )


async def _lead_documents(db: AsyncSession, *, company_id: int, lead_id: int) -> list[EmrDocument]:
    """Файлы, которые уже есть: вложения чата и протокол сделки."""
    docs: list[EmrDocument] = []
    media = (
        await db.execute(
            select(
                ChatMessage.id,
                ChatMessage.file_name,
                ChatMessage.message_type,
                ChatMessage.created_at,
            )
            .join(ChatThread, ChatThread.id == ChatMessage.thread_id)
            .where(
                ChatThread.company_id == company_id,
                ChatThread.lead_id == lead_id,
                ChatMessage.media_url.is_not(None),
                ChatMessage.media_url != "",
            )
            .order_by(ChatMessage.created_at.desc())
            .limit(40),
        )
    ).all()
    for msg_id, file_name, message_type, created_at in media:
        title = (file_name or "").strip() or {
            "image": "Фото из чата",
            "video": "Видео из чата",
            "audio": "Аудио из чата",
            "document": "Файл из чата",
        }.get(str(message_type or ""), "Файл из чата")
        docs.append(
            EmrDocument(
                title=title,
                source="Чат",
                at=created_at,
                href=f"/api/chat/messages/{int(msg_id)}/media",
            ),
        )

    protocols = (
        await db.execute(
            select(Deal.id, Deal.title, Deal.protocol_file_path)
            .where(
                Deal.company_id == company_id,
                Deal.lead_id == lead_id,
                Deal.protocol_file_path.is_not(None),
                Deal.protocol_file_path != "",
            )
            .order_by(Deal.id.desc())
            .limit(10),
        )
    ).all()
    for _deal_id, title, path in protocols:
        name = Path(str(path)).name or "Протокол"
        docs.append(
            EmrDocument(
                title=(title or "").strip() or name,
                source="Протокол",
                at=None,
                href=f"/leads/{lead_id}",
            ),
        )
    return docs


@router.patch("/{lead_id}/diagnosis", response_model=EmrDiagnosisUpdate)
async def emr_save_diagnosis(
    lead_id: int,
    body: EmrDiagnosisUpdate,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentUser,
    company_id: CurrentCompanyId,
) -> EmrDiagnosisUpdate:
    """Основной диагноз пишется в карту пациента (leads.clinical_diagnosis)."""
    await _assert_emr_access(current_user)
    lead = await db.get(Lead, lead_id)
    if lead is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Lead not found")
    await _assert_lead_visible(db, current_user=current_user, lead=lead, company_id=company_id)
    text = (body.diagnosis or "").strip()
    lead.clinical_diagnosis = text[:2000] or None
    await db.flush()
    return EmrDiagnosisUpdate(diagnosis=lead.clinical_diagnosis)


@router.patch("/{lead_id}/birth-date", response_model=EmrBirthUpdate)
async def emr_save_birth_date(
    lead_id: int,
    body: EmrBirthUpdate,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentUser,
    company_id: CurrentCompanyId,
) -> EmrBirthUpdate:
    """Ручная дата рождения, только если в записях её нет."""
    await _assert_emr_access(current_user)
    lead = await db.get(Lead, lead_id)
    if lead is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Lead not found")
    await _assert_lead_visible(db, current_user=current_user, lead=lead, company_id=company_id)
    booking_birth = (
        await db.execute(
            select(BookingAppointment.patient_birth_date)
            .where(
                BookingAppointment.company_id == company_id,
                BookingAppointment.lead_id == lead_id,
                BookingAppointment.patient_birth_date.is_not(None),
            )
            .limit(1),
        )
    ).scalar_one_or_none()
    if booking_birth is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Дата рождения уже указана в записи",
        )
    born = body.birth_date
    if born is not None and (born > date.today() or born.year < 1900):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Некорректная дата рождения")
    lead.patient_birth_date = born
    await db.flush()
    return EmrBirthUpdate(birth_date=lead.patient_birth_date)
