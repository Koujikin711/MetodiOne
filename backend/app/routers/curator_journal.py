"""API журнала куратора / табеля потока."""

from __future__ import annotations

import calendar
from datetime import UTC, date, datetime
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import delete, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import CurrentCompanyId, CurrentUser
from app.database import get_db
from app.models import Lead, SalesKpiManualSale, SalesKpiPlanItem, User, UserRole
from app.models.curator_journal import (
    CuratorCourseFlow,
    CuratorFlowMembership,
    CuratorJournalComplaint,
    CuratorJournalEntry,
)
from app.schemas.curator_journal import (
    COMPLAINT_CATEGORIES,
    ComplaintsReportItem,
    ComplaintsReportOut,
    ComplaintIn,
    ComplaintOut,
    Course15QueueOut,
    Course15QueueRowOut,
    CuratorFlowCreate,
    CuratorFlowOut,
    CuratorFlowUpdate,
    CuratorUserOut,
    DaySummaryOut,
    EntryUpsert,
    ImportKpiBody,
    ImportLeadsBody,
    ImportResultOut,
    JournalEntryOut,
    KpiImportPreviewOut,
    KpiImportPreviewRow,
    MemberHistoryOut,
    MembershipCreate,
    MembershipOut,
    MembershipTransfer,
    MonthJournalOut,
    RecurringComplaintOut,
)
from app.services.curator_journal_access import (
    assert_flow_admin,
    assert_flow_readable,
    assert_flow_writable,
    assert_journal_access,
    can_manage_all_flows,
)

router = APIRouter(prefix="/curator-journal", tags=["curator-journal"])


def _utc_now() -> datetime:
    return datetime.now(UTC)


def _norm_phone(raw: str | None) -> str:
    if not raw:
        return ""
    digits = "".join(ch for ch in raw if ch.isdigit())
    if len(digits) >= 9:
        return digits[-9:]
    return digits


def _membership_out(m: CuratorFlowMembership) -> MembershipOut:
    return MembershipOut(
        id=int(m.id),
        flow_id=int(m.flow_id),
        lead_id=int(m.lead_id) if m.lead_id is not None else None,
        display_name=m.display_name,
        phone=m.phone,
        joined_on=m.joined_on,
        left_on=m.left_on,
        source=m.source or "manual",
        kpi_sale_id=int(m.kpi_sale_id) if m.kpi_sale_id is not None else None,
        is_active=m.left_on is None,
    )


def _complaint_out(c: CuratorJournalComplaint) -> ComplaintOut:
    return ComplaintOut(
        id=int(c.id),
        category=c.category,
        comment=c.comment,
        numeric_value=c.numeric_value,
        unit=c.unit,
        count_value=c.count_value,
    )


async def _flow_out(
    db: AsyncSession,
    flow: CuratorCourseFlow,
    *,
    participants_count: int | None = None,
) -> CuratorFlowOut:
    curator_name: str | None = None
    if flow.curator_user_id:
        u = (
            await db.execute(select(User).where(User.id == flow.curator_user_id))
        ).scalar_one_or_none()
        if u:
            curator_name = u.full_name or u.email or f"#{u.id}"
    if participants_count is None:
        participants_count = int(
            (
                await db.execute(
                    select(func.count())
                    .select_from(CuratorFlowMembership)
                    .where(
                        CuratorFlowMembership.flow_id == flow.id,
                        CuratorFlowMembership.left_on.is_(None),
                    )
                )
            ).scalar_one()
            or 0
        )
    return CuratorFlowOut(
        id=int(flow.id),
        company_id=int(flow.company_id),
        pipeline_id=int(flow.pipeline_id) if flow.pipeline_id is not None else None,
        course_name=flow.course_name,
        flow_number=int(flow.flow_number),
        title=flow.title,
        starts_on=flow.starts_on,
        ends_on=flow.ends_on,
        curator_user_id=int(flow.curator_user_id) if flow.curator_user_id is not None else None,
        curator_name=curator_name,
        kpi_group_no=int(flow.kpi_group_no) if flow.kpi_group_no is not None else None,
        status=flow.status,
        participants_count=participants_count,
        created_at=flow.created_at,
        updated_at=flow.updated_at,
    )


async def _get_flow(
    db: AsyncSession,
    company_id: int,
    flow_id: int,
) -> CuratorCourseFlow:
    flow = (
        await db.execute(
            select(CuratorCourseFlow).where(
                CuratorCourseFlow.id == flow_id,
                CuratorCourseFlow.company_id == company_id,
            )
        )
    ).scalar_one_or_none()
    if not flow:
        raise HTTPException(status_code=404, detail="Поток не найден")
    return flow


def _month_days_in_flow(flow: CuratorCourseFlow, year: int, month: int) -> list[date]:
    last = calendar.monthrange(year, month)[1]
    days: list[date] = []
    for d in range(1, last + 1):
        day = date(year, month, d)
        if flow.starts_on <= day <= flow.ends_on:
            days.append(day)
    return days


def _validate_complaints(complaints: list[ComplaintIn], status_val: str) -> None:
    if status_val != "complaint":
        return
    if not complaints:
        raise HTTPException(status_code=400, detail="Укажите хотя бы одну категорию жалобы")
    seen: set[str] = set()
    for c in complaints:
        if c.category in seen:
            raise HTTPException(status_code=400, detail=f"Дубликат категории: {c.category}")
        seen.add(c.category)
        if c.category not in COMPLAINT_CATEGORIES:
            raise HTTPException(status_code=400, detail=f"Неизвестная категория: {c.category}")
        if c.category == "other" and not (c.comment and c.comment.strip()):
            raise HTTPException(status_code=400, detail="Для «Другое» нужен комментарий")
        if c.category == "temperature" and c.numeric_value is None:
            raise HTTPException(status_code=400, detail="Укажите температуру")
        if c.category == "vomiting" and c.count_value is None:
            raise HTTPException(status_code=400, detail="Укажите количество эпизодов рвоты")


async def _replace_complaints(
    db: AsyncSession,
    entry: CuratorJournalEntry,
    complaints: list[ComplaintIn] | None,
    complaint_status: str,
) -> list[CuratorJournalComplaint]:
    await db.execute(
        delete(CuratorJournalComplaint).where(
            CuratorJournalComplaint.journal_entry_id == entry.id
        )
    )
    rows: list[CuratorJournalComplaint] = []
    if complaint_status != "complaint" or not complaints:
        return rows
    for c in complaints:
        unit = c.unit
        numeric = c.numeric_value
        count_v = c.count_value
        if c.category == "temperature":
            unit = unit or "C"
        if c.category == "weight":
            unit = unit or "kg"
        row = CuratorJournalComplaint(
            journal_entry_id=entry.id,
            category=c.category,
            comment=(c.comment.strip() if c.comment else None),
            numeric_value=numeric,
            unit=unit,
            count_value=count_v,
        )
        db.add(row)
        rows.append(row)
    return rows


async def _entries_with_complaints(
    db: AsyncSession,
    entry_ids: list[int],
) -> dict[int, list[CuratorJournalComplaint]]:
    if not entry_ids:
        return {}
    rows = (
        await db.execute(
            select(CuratorJournalComplaint).where(
                CuratorJournalComplaint.journal_entry_id.in_(entry_ids)
            )
        )
    ).scalars().all()
    out: dict[int, list[CuratorJournalComplaint]] = {i: [] for i in entry_ids}
    for r in rows:
        out.setdefault(int(r.journal_entry_id), []).append(r)
    return out


def _entry_out(
    e: CuratorJournalEntry,
    complaints: list[CuratorJournalComplaint],
) -> JournalEntryOut:
    return JournalEntryOut(
        id=int(e.id),
        membership_id=int(e.membership_id),
        entry_date=e.entry_date,
        diary_status=e.diary_status,
        photo_status=e.photo_status,
        complaint_status=e.complaint_status,
        complaint_general_comment=e.complaint_general_comment,
        complaints=[_complaint_out(c) for c in complaints],
    )


# ── curators list ──────────────────────────────────────────────


@router.get("/course15-queue", response_model=Course15QueueOut)
async def course15_waiting_queue(
    user: CurrentUser,
    company_id: CurrentCompanyId,
    db: Annotated[AsyncSession, Depends(get_db)],
    include_converted: bool = Query(
        False,
        description="Включить converted (обычно скрыты из active queue)",
    ),
    q: str | None = Query(None, max_length=120),
) -> Course15QueueOut:
    """Курс 15 lifecycle / next-product queue. Не daily Telegram journal."""
    assert_journal_access(user)
    from app.services.course15_queue import build_course15_queue

    raw = await build_course15_queue(
        db,
        company_id=company_id,
        include_converted=include_converted,
        q=q,
    )
    return Course15QueueOut(
        predicate=raw["predicate"],
        include_converted=raw["include_converted"],
        note=raw["note"],
        counts=raw["counts"],
        rows=[Course15QueueRowOut(**r) for r in raw["rows"]],
    )


@router.get("/curators", response_model=list[CuratorUserOut])
async def list_curators(
    user: CurrentUser,
    company_id: CurrentCompanyId,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> list[CuratorUserOut]:
    assert_journal_access(user)
    rows = (
        await db.execute(
            select(User)
            .where(
                User.company_id == company_id,
                User.is_active.is_(True),
                or_(
                    User.role == UserRole.curator,
                    User.role.in_(
                        [
                            UserRole.administrator,
                            UserRole.admin,
                            UserRole.owner,
                        ]
                    ),
                ),
            )
            .order_by(User.full_name)
        )
    ).scalars().all()
    return [
        CuratorUserOut(
            id=int(u.id),
            full_name=u.full_name or u.email or f"#{u.id}",
            role=u.role.value if hasattr(u.role, "value") else str(u.role),
        )
        for u in rows
    ]


# ── flows CRUD ─────────────────────────────────────────────────


@router.get("/flows", response_model=list[CuratorFlowOut])
async def list_flows(
    user: CurrentUser,
    company_id: CurrentCompanyId,
    db: Annotated[AsyncSession, Depends(get_db)],
    status_filter: str | None = Query(default="active", alias="status"),
) -> list[CuratorFlowOut]:
    assert_journal_access(user)
    q = select(CuratorCourseFlow).where(CuratorCourseFlow.company_id == company_id)
    if status_filter and status_filter != "all":
        q = q.where(CuratorCourseFlow.status == status_filter)
    if not can_manage_all_flows(user.role):
        q = q.where(CuratorCourseFlow.curator_user_id == user.id)
    q = q.order_by(CuratorCourseFlow.starts_on.desc(), CuratorCourseFlow.flow_number.desc())
    flows = (await db.execute(q)).scalars().all()
    out: list[CuratorFlowOut] = []
    for f in flows:
        out.append(await _flow_out(db, f))
    return out


@router.post("/flows", response_model=CuratorFlowOut, status_code=status.HTTP_201_CREATED)
async def create_flow(
    body: CuratorFlowCreate,
    user: CurrentUser,
    company_id: CurrentCompanyId,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> CuratorFlowOut:
    assert_flow_admin(user)
    if body.ends_on < body.starts_on:
        raise HTTPException(status_code=400, detail="Период потока некорректен")
    flow = CuratorCourseFlow(
        company_id=company_id,
        pipeline_id=body.pipeline_id,
        course_name=body.course_name.strip(),
        flow_number=body.flow_number,
        title=(body.title.strip() if body.title else None),
        starts_on=body.starts_on,
        ends_on=body.ends_on,
        curator_user_id=body.curator_user_id,
        kpi_group_no=body.kpi_group_no,
        status="active",
        created_by_user_id=user.id,
    )
    db.add(flow)
    await db.commit()
    await db.refresh(flow)
    return await _flow_out(db, flow)


@router.get("/flows/{flow_id}", response_model=CuratorFlowOut)
async def get_flow(
    flow_id: int,
    user: CurrentUser,
    company_id: CurrentCompanyId,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> CuratorFlowOut:
    flow = await _get_flow(db, company_id, flow_id)
    assert_flow_readable(user, flow)
    return await _flow_out(db, flow)


@router.patch("/flows/{flow_id}", response_model=CuratorFlowOut)
async def update_flow(
    flow_id: int,
    body: CuratorFlowUpdate,
    user: CurrentUser,
    company_id: CurrentCompanyId,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> CuratorFlowOut:
    flow = await _get_flow(db, company_id, flow_id)
    assert_flow_admin(user)
    data = body.model_dump(exclude_unset=True)
    starts = data.get("starts_on", flow.starts_on)
    ends = data.get("ends_on", flow.ends_on)
    if ends < starts:
        raise HTTPException(status_code=400, detail="Период потока некорректен")
    for key, val in data.items():
        if key in ("course_name", "title") and isinstance(val, str):
            val = val.strip() or None if key == "title" else val.strip()
        setattr(flow, key, val)
    flow.updated_at = _utc_now()
    await db.commit()
    await db.refresh(flow)
    return await _flow_out(db, flow)


# ── memberships ────────────────────────────────────────────────


@router.get("/flows/{flow_id}/memberships", response_model=list[MembershipOut])
async def list_memberships(
    flow_id: int,
    user: CurrentUser,
    company_id: CurrentCompanyId,
    db: Annotated[AsyncSession, Depends(get_db)],
    active_only: bool = True,
) -> list[MembershipOut]:
    flow = await _get_flow(db, company_id, flow_id)
    assert_flow_readable(user, flow)
    q = select(CuratorFlowMembership).where(
        CuratorFlowMembership.flow_id == flow_id,
        CuratorFlowMembership.company_id == company_id,
    )
    if active_only:
        q = q.where(CuratorFlowMembership.left_on.is_(None))
    q = q.order_by(CuratorFlowMembership.display_name)
    rows = (await db.execute(q)).scalars().all()
    return [_membership_out(m) for m in rows]


@router.post(
    "/flows/{flow_id}/memberships",
    response_model=MembershipOut,
    status_code=status.HTTP_201_CREATED,
)
async def add_membership(
    flow_id: int,
    body: MembershipCreate,
    user: CurrentUser,
    company_id: CurrentCompanyId,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> MembershipOut:
    flow = await _get_flow(db, company_id, flow_id)
    assert_flow_writable(user, flow)
    joined = body.joined_on or max(flow.starts_on, date.today())
    if joined < flow.starts_on or joined > flow.ends_on:
        joined = flow.starts_on
    # prevent duplicate active by phone/name
    phone_n = _norm_phone(body.phone)
    existing = (
        await db.execute(
            select(CuratorFlowMembership).where(
                CuratorFlowMembership.flow_id == flow_id,
                CuratorFlowMembership.left_on.is_(None),
            )
        )
    ).scalars().all()
    for m in existing:
        if body.lead_id and m.lead_id == body.lead_id:
            raise HTTPException(status_code=400, detail="Участник уже в потоке")
        if phone_n and _norm_phone(m.phone) == phone_n:
            raise HTTPException(status_code=400, detail="Участник с таким телефоном уже в потоке")
        if m.display_name.strip().lower() == body.display_name.strip().lower() and not phone_n:
            raise HTTPException(status_code=400, detail="Участник с таким ФИО уже в потоке")
    m = CuratorFlowMembership(
        company_id=company_id,
        flow_id=flow_id,
        lead_id=body.lead_id,
        display_name=body.display_name.strip(),
        phone=(body.phone.strip() if body.phone else None),
        joined_on=joined,
        left_on=None,
        source="lead" if body.lead_id else "manual",
    )
    db.add(m)
    await db.commit()
    await db.refresh(m)
    return _membership_out(m)


@router.post("/memberships/{membership_id}/leave", response_model=MembershipOut)
async def leave_membership(
    membership_id: int,
    user: CurrentUser,
    company_id: CurrentCompanyId,
    db: Annotated[AsyncSession, Depends(get_db)],
    left_on: date | None = None,
) -> MembershipOut:
    m = (
        await db.execute(
            select(CuratorFlowMembership).where(
                CuratorFlowMembership.id == membership_id,
                CuratorFlowMembership.company_id == company_id,
            )
        )
    ).scalar_one_or_none()
    if not m:
        raise HTTPException(status_code=404, detail="Участник не найден")
    flow = await _get_flow(db, company_id, int(m.flow_id))
    assert_flow_writable(user, flow)
    m.left_on = left_on or date.today()
    await db.commit()
    await db.refresh(m)
    return _membership_out(m)


@router.post("/memberships/{membership_id}/transfer", response_model=MembershipOut)
async def transfer_membership(
    membership_id: int,
    body: MembershipTransfer,
    user: CurrentUser,
    company_id: CurrentCompanyId,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> MembershipOut:
    m = (
        await db.execute(
            select(CuratorFlowMembership).where(
                CuratorFlowMembership.id == membership_id,
                CuratorFlowMembership.company_id == company_id,
            )
        )
    ).scalar_one_or_none()
    if not m:
        raise HTTPException(status_code=404, detail="Участник не найден")
    old_flow = await _get_flow(db, company_id, int(m.flow_id))
    assert_flow_writable(user, old_flow)
    new_flow = await _get_flow(db, company_id, body.target_flow_id)
    assert_flow_writable(user, new_flow)
    if new_flow.id == old_flow.id:
        raise HTTPException(status_code=400, detail="Целевой поток совпадает с текущим")
    left = body.left_on or date.today()
    joined = body.joined_on or left
    m.left_on = left
    # history stays on old membership; create new in target
    nm = CuratorFlowMembership(
        company_id=company_id,
        flow_id=new_flow.id,
        lead_id=m.lead_id,
        display_name=m.display_name,
        phone=m.phone,
        joined_on=joined,
        left_on=None,
        source=m.source,
        kpi_sale_id=m.kpi_sale_id,
    )
    db.add(nm)
    await db.commit()
    await db.refresh(nm)
    return _membership_out(nm)


# ── import ─────────────────────────────────────────────────────


@router.get("/import-preview/kpi", response_model=KpiImportPreviewOut)
async def preview_kpi_import(
    user: CurrentUser,
    company_id: CurrentCompanyId,
    db: Annotated[AsyncSession, Depends(get_db)],
    group_no: int = Query(ge=1, le=20),
    plan_item_id: int | None = None,
) -> KpiImportPreviewOut:
    assert_journal_access(user)
    q = (
        select(SalesKpiManualSale, SalesKpiPlanItem.name)
        .outerjoin(SalesKpiPlanItem, SalesKpiPlanItem.id == SalesKpiManualSale.plan_item_id)
        .where(
            SalesKpiManualSale.company_id == company_id,
            SalesKpiManualSale.group_no == group_no,
        )
    )
    if plan_item_id is not None:
        q = q.where(SalesKpiManualSale.plan_item_id == plan_item_id)
    rows = (await db.execute(q.order_by(SalesKpiManualSale.client_name))).all()
    return KpiImportPreviewOut(
        group_no=group_no,
        rows=[
            KpiImportPreviewRow(
                sale_id=int(sale.id),
                client_name=sale.client_name,
                client_phone=sale.client_phone or "",
                group_no=int(sale.group_no) if sale.group_no is not None else None,
                plan_item_name=name,
                status=sale.status,
            )
            for sale, name in rows
        ],
    )


@router.post("/flows/{flow_id}/import-kpi", response_model=ImportResultOut)
async def import_from_kpi(
    flow_id: int,
    body: ImportKpiBody,
    user: CurrentUser,
    company_id: CurrentCompanyId,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> ImportResultOut:
    flow = await _get_flow(db, company_id, flow_id)
    assert_flow_writable(user, flow)
    q = select(SalesKpiManualSale).where(
        SalesKpiManualSale.company_id == company_id,
        SalesKpiManualSale.group_no == body.group_no,
    )
    if body.plan_item_id is not None:
        q = q.where(SalesKpiManualSale.plan_item_id == body.plan_item_id)
    if body.only_active:
        q = q.where(SalesKpiManualSale.status == "active")
    sales = (await db.execute(q)).scalars().all()
    existing = (
        await db.execute(
            select(CuratorFlowMembership).where(
                CuratorFlowMembership.flow_id == flow_id,
                CuratorFlowMembership.left_on.is_(None),
            )
        )
    ).scalars().all()
    existing_phones = {_norm_phone(m.phone) for m in existing if _norm_phone(m.phone)}
    existing_sale_ids = {int(m.kpi_sale_id) for m in existing if m.kpi_sale_id}
    existing_names = {m.display_name.strip().lower() for m in existing}
    added: list[CuratorFlowMembership] = []
    skipped = 0
    for sale in sales:
        phone_n = _norm_phone(sale.client_phone)
        if int(sale.id) in existing_sale_ids:
            skipped += 1
            continue
        if phone_n and phone_n in existing_phones:
            skipped += 1
            continue
        if not phone_n and sale.client_name.strip().lower() in existing_names:
            skipped += 1
            continue
        m = CuratorFlowMembership(
            company_id=company_id,
            flow_id=flow_id,
            display_name=sale.client_name.strip(),
            phone=sale.client_phone or None,
            joined_on=flow.starts_on,
            source="kpi",
            kpi_sale_id=int(sale.id),
        )
        db.add(m)
        added.append(m)
        if phone_n:
            existing_phones.add(phone_n)
        existing_names.add(sale.client_name.strip().lower())
        existing_sale_ids.add(int(sale.id))
    if flow.kpi_group_no is None:
        flow.kpi_group_no = body.group_no
    await db.commit()
    for m in added:
        await db.refresh(m)
    return ImportResultOut(
        added=len(added),
        skipped=skipped,
        memberships=[_membership_out(m) for m in added],
    )


@router.post("/flows/{flow_id}/import-leads", response_model=ImportResultOut)
async def import_from_leads(
    flow_id: int,
    body: ImportLeadsBody,
    user: CurrentUser,
    company_id: CurrentCompanyId,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> ImportResultOut:
    flow = await _get_flow(db, company_id, flow_id)
    assert_flow_writable(user, flow)
    leads = (
        await db.execute(
            select(Lead).where(
                Lead.company_id == company_id,
                Lead.id.in_(body.lead_ids),
            )
        )
    ).scalars().all()
    if not leads:
        raise HTTPException(status_code=400, detail="Лиды не найдены")
    existing = (
        await db.execute(
            select(CuratorFlowMembership).where(
                CuratorFlowMembership.flow_id == flow_id,
                CuratorFlowMembership.left_on.is_(None),
            )
        )
    ).scalars().all()
    existing_lead_ids = {int(m.lead_id) for m in existing if m.lead_id}
    existing_phones = {_norm_phone(m.phone) for m in existing if _norm_phone(m.phone)}
    joined = body.joined_on or flow.starts_on
    added: list[CuratorFlowMembership] = []
    skipped = 0
    for lead in leads:
        phone_n = _norm_phone(lead.phone)
        if int(lead.id) in existing_lead_ids:
            skipped += 1
            continue
        if phone_n and phone_n in existing_phones:
            skipped += 1
            continue
        m = CuratorFlowMembership(
            company_id=company_id,
            flow_id=flow_id,
            lead_id=int(lead.id),
            display_name=lead.name.strip(),
            phone=lead.phone,
            joined_on=joined,
            source="lead",
        )
        db.add(m)
        added.append(m)
        existing_lead_ids.add(int(lead.id))
        if phone_n:
            existing_phones.add(phone_n)
    await db.commit()
    for m in added:
        await db.refresh(m)
    return ImportResultOut(
        added=len(added),
        skipped=skipped,
        memberships=[_membership_out(m) for m in added],
    )


# ── month journal ──────────────────────────────────────────────


@router.get("/flows/{flow_id}/month", response_model=MonthJournalOut)
async def get_month_journal(
    flow_id: int,
    user: CurrentUser,
    company_id: CurrentCompanyId,
    db: Annotated[AsyncSession, Depends(get_db)],
    year: int = Query(ge=2000, le=2100),
    month: int = Query(ge=1, le=12),
    q: str | None = Query(default=None, description="Поиск по ФИО"),
) -> MonthJournalOut:
    flow = await _get_flow(db, company_id, flow_id)
    assert_flow_readable(user, flow)
    days = _month_days_in_flow(flow, year, month)
    month_start = date(year, month, 1)
    month_end = date(year, month, calendar.monthrange(year, month)[1])

    mq = select(CuratorFlowMembership).where(
        CuratorFlowMembership.flow_id == flow_id,
        CuratorFlowMembership.company_id == company_id,
        CuratorFlowMembership.joined_on <= month_end,
        or_(
            CuratorFlowMembership.left_on.is_(None),
            CuratorFlowMembership.left_on >= month_start,
        ),
    )
    if q and q.strip():
        like = f"%{q.strip()}%"
        mq = mq.where(CuratorFlowMembership.display_name.ilike(like))
    mq = mq.order_by(CuratorFlowMembership.display_name)
    participants = (await db.execute(mq)).scalars().all()
    member_ids = [int(m.id) for m in participants]

    entries: list[CuratorJournalEntry] = []
    if member_ids and days:
        entries = list(
            (
                await db.execute(
                    select(CuratorJournalEntry).where(
                        CuratorJournalEntry.flow_id == flow_id,
                        CuratorJournalEntry.membership_id.in_(member_ids),
                        CuratorJournalEntry.entry_date >= days[0],
                        CuratorJournalEntry.entry_date <= days[-1],
                    )
                )
            ).scalars().all()
        )
    complaints_map = await _entries_with_complaints(db, [int(e.id) for e in entries])
    return MonthJournalOut(
        flow=await _flow_out(db, flow, participants_count=len([m for m in participants if m.left_on is None])),
        year=year,
        month=month,
        days=days,
        participants=[_membership_out(m) for m in participants],
        entries=[_entry_out(e, complaints_map.get(int(e.id), [])) for e in entries],
    )


@router.patch("/flows/{flow_id}/entries", response_model=JournalEntryOut)
async def upsert_entry(
    flow_id: int,
    body: EntryUpsert,
    user: CurrentUser,
    company_id: CurrentCompanyId,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> JournalEntryOut:
    flow = await _get_flow(db, company_id, flow_id)
    assert_flow_writable(user, flow)
    if body.entry_date < flow.starts_on or body.entry_date > flow.ends_on:
        raise HTTPException(status_code=400, detail="Дата вне периода потока")
    membership = (
        await db.execute(
            select(CuratorFlowMembership).where(
                CuratorFlowMembership.id == body.membership_id,
                CuratorFlowMembership.flow_id == flow_id,
                CuratorFlowMembership.company_id == company_id,
            )
        )
    ).scalar_one_or_none()
    if not membership:
        raise HTTPException(status_code=404, detail="Участник не найден в потоке")

    entry = (
        await db.execute(
            select(CuratorJournalEntry).where(
                CuratorJournalEntry.flow_id == flow_id,
                CuratorJournalEntry.membership_id == body.membership_id,
                CuratorJournalEntry.entry_date == body.entry_date,
            )
        )
    ).scalar_one_or_none()

    if entry is None:
        entry = CuratorJournalEntry(
            company_id=company_id,
            flow_id=flow_id,
            membership_id=body.membership_id,
            entry_date=body.entry_date,
            diary_status="pending",
            photo_status="pending",
            complaint_status="pending",
            created_by_user_id=user.id,
            updated_by_user_id=user.id,
        )
        db.add(entry)
        await db.flush()

    if body.diary_status is not None:
        entry.diary_status = body.diary_status
    if body.photo_status is not None:
        entry.photo_status = body.photo_status

    if body.complaint_status is not None:
        entry.complaint_status = body.complaint_status
        if body.complaint_general_comment is not None:
            entry.complaint_general_comment = body.complaint_general_comment
        if body.complaint_status in ("no_complaint", "pending"):
            await _replace_complaints(db, entry, None, body.complaint_status)
        elif body.complaint_status == "complaint":
            _validate_complaints(body.complaints or [], "complaint")
            await _replace_complaints(db, entry, body.complaints, "complaint")
    elif body.complaints is not None:
        entry.complaint_status = "complaint"
        _validate_complaints(body.complaints, "complaint")
        await _replace_complaints(db, entry, body.complaints, "complaint")
        if body.complaint_general_comment is not None:
            entry.complaint_general_comment = body.complaint_general_comment

    entry.updated_by_user_id = user.id
    entry.updated_at = _utc_now()
    await db.commit()
    await db.refresh(entry)
    cmap = await _entries_with_complaints(db, [int(entry.id)])
    return _entry_out(entry, cmap.get(int(entry.id), []))


# ── summaries / reports ────────────────────────────────────────


@router.get("/flows/{flow_id}/day-summary", response_model=DaySummaryOut)
async def day_summary(
    flow_id: int,
    user: CurrentUser,
    company_id: CurrentCompanyId,
    db: Annotated[AsyncSession, Depends(get_db)],
    day: date = Query(..., alias="date"),
) -> DaySummaryOut:
    flow = await _get_flow(db, company_id, flow_id)
    assert_flow_readable(user, flow)
    members = (
        await db.execute(
            select(CuratorFlowMembership).where(
                CuratorFlowMembership.flow_id == flow_id,
                CuratorFlowMembership.joined_on <= day,
                or_(
                    CuratorFlowMembership.left_on.is_(None),
                    CuratorFlowMembership.left_on >= day,
                ),
            )
        )
    ).scalars().all()
    total = len(members)
    member_ids = [int(m.id) for m in members]
    entries = []
    if member_ids:
        entries = list(
            (
                await db.execute(
                    select(CuratorJournalEntry).where(
                        CuratorJournalEntry.flow_id == flow_id,
                        CuratorJournalEntry.entry_date == day,
                        CuratorJournalEntry.membership_id.in_(member_ids),
                    )
                )
            ).scalars().all()
        )
    by_member = {int(e.membership_id): e for e in entries}

    diary_done = diary_missed = diary_pending = 0
    photo_done = photo_missed = photo_pending = 0
    with_complaints = 0
    not_filled = 0
    for m in members:
        e = by_member.get(int(m.id))
        if e is None:
            diary_pending += 1
            photo_pending += 1
            not_filled += 1
            continue
        if e.diary_status == "done":
            diary_done += 1
        elif e.diary_status == "missed":
            diary_missed += 1
        else:
            diary_pending += 1
        if e.photo_status == "done":
            photo_done += 1
        elif e.photo_status == "missed":
            photo_missed += 1
        else:
            photo_pending += 1
        if e.complaint_status == "complaint":
            with_complaints += 1
        if (
            e.diary_status == "pending"
            and e.photo_status == "pending"
            and e.complaint_status == "pending"
        ):
            not_filled += 1

    complaint_counts = {c: 0 for c in COMPLAINT_CATEGORIES}
    if entries:
        entry_ids = [int(e.id) for e in entries if e.complaint_status == "complaint"]
        if entry_ids:
            rows = (
                await db.execute(
                    select(CuratorJournalComplaint.category, func.count())
                    .where(CuratorJournalComplaint.journal_entry_id.in_(entry_ids))
                    .group_by(CuratorJournalComplaint.category)
                )
            ).all()
            for cat, cnt in rows:
                complaint_counts[str(cat)] = int(cnt)

    return DaySummaryOut(
        date=day,
        participants_total=total,
        diary_done=diary_done,
        diary_missed=diary_missed,
        diary_pending=diary_pending,
        photo_done=photo_done,
        photo_missed=photo_missed,
        photo_pending=photo_pending,
        with_complaints=with_complaints,
        not_filled=not_filled,
        diary_percent=round((diary_done / total * 100) if total else 0.0, 1),
        photo_percent=round((photo_done / total * 100) if total else 0.0, 1),
        complaint_counts=complaint_counts,
    )


@router.get("/flows/{flow_id}/complaints-report", response_model=ComplaintsReportOut)
async def complaints_report(
    flow_id: int,
    user: CurrentUser,
    company_id: CurrentCompanyId,
    db: Annotated[AsyncSession, Depends(get_db)],
    date_from: date = Query(...),
    date_to: date = Query(...),
) -> ComplaintsReportOut:
    flow = await _get_flow(db, company_id, flow_id)
    assert_flow_readable(user, flow)
    if date_to < date_from:
        raise HTTPException(status_code=400, detail="Некорректный период")
    entries = (
        await db.execute(
            select(CuratorJournalEntry).where(
                CuratorJournalEntry.flow_id == flow_id,
                CuratorJournalEntry.company_id == company_id,
                CuratorJournalEntry.complaint_status == "complaint",
                CuratorJournalEntry.entry_date >= date_from,
                CuratorJournalEntry.entry_date <= date_to,
            )
            .order_by(CuratorJournalEntry.entry_date, CuratorJournalEntry.membership_id)
        )
    ).scalars().all()
    member_ids = list({int(e.membership_id) for e in entries})
    members: dict[int, CuratorFlowMembership] = {}
    if member_ids:
        for m in (
            await db.execute(
                select(CuratorFlowMembership).where(CuratorFlowMembership.id.in_(member_ids))
            )
        ).scalars().all():
            members[int(m.id)] = m
    cmap = await _entries_with_complaints(db, [int(e.id) for e in entries])
    category_totals = {c: 0 for c in COMPLAINT_CATEGORIES}
    items: list[ComplaintsReportItem] = []
    patient_ids: set[int] = set()
    for e in entries:
        comps = cmap.get(int(e.id), [])
        if not comps:
            continue
        patient_ids.add(int(e.membership_id))
        for c in comps:
            category_totals[c.category] = category_totals.get(c.category, 0) + 1
        mem = members.get(int(e.membership_id))
        items.append(
            ComplaintsReportItem(
                membership_id=int(e.membership_id),
                display_name=mem.display_name if mem else f"#{e.membership_id}",
                entry_date=e.entry_date,
                complaints=[_complaint_out(c) for c in comps],
                general_comment=e.complaint_general_comment,
            )
        )
    return ComplaintsReportOut(
        date_from=date_from,
        date_to=date_to,
        patients_with_complaints=len(patient_ids),
        category_totals=category_totals,
        items=items,
    )


@router.get("/memberships/{membership_id}/history", response_model=MemberHistoryOut)
async def member_history(
    membership_id: int,
    user: CurrentUser,
    company_id: CurrentCompanyId,
    db: Annotated[AsyncSession, Depends(get_db)],
    year: int | None = None,
    month: int | None = None,
) -> MemberHistoryOut:
    m = (
        await db.execute(
            select(CuratorFlowMembership).where(
                CuratorFlowMembership.id == membership_id,
                CuratorFlowMembership.company_id == company_id,
            )
        )
    ).scalar_one_or_none()
    if not m:
        raise HTTPException(status_code=404, detail="Участник не найден")
    flow = await _get_flow(db, company_id, int(m.flow_id))
    assert_flow_readable(user, flow)

    eq = select(CuratorJournalEntry).where(
        CuratorJournalEntry.membership_id == membership_id,
        CuratorJournalEntry.flow_id == flow.id,
    )
    if year and month:
        days = _month_days_in_flow(flow, year, month)
        if days:
            eq = eq.where(
                CuratorJournalEntry.entry_date >= days[0],
                CuratorJournalEntry.entry_date <= days[-1],
            )
        total_days = len(days)
    else:
        # whole membership span clipped to flow
        start = max(flow.starts_on, m.joined_on)
        end = min(flow.ends_on, m.left_on or flow.ends_on)
        total_days = max(0, (end - start).days + 1) if end >= start else 0
    eq = eq.order_by(CuratorJournalEntry.entry_date)
    entries = list((await db.execute(eq)).scalars().all())
    cmap = await _entries_with_complaints(db, [int(e.id) for e in entries])

    diary_done = sum(1 for e in entries if e.diary_status == "done")
    photo_done = sum(1 for e in entries if e.photo_status == "done")
    complaint_days = sum(1 for e in entries if e.complaint_status == "complaint")

    recurring_map: dict[str, set[date]] = {}
    for e in entries:
        if e.complaint_status != "complaint":
            continue
        for c in cmap.get(int(e.id), []):
            recurring_map.setdefault(c.category, set()).add(e.entry_date)
    recurring = [
        RecurringComplaintOut(category=cat, days_count=len(ds))
        for cat, ds in sorted(recurring_map.items(), key=lambda x: -len(x[1]))
        if len(ds) >= 2
    ]

    return MemberHistoryOut(
        membership=_membership_out(m),
        flow_number=int(flow.flow_number),
        course_name=flow.course_name,
        year=year,
        month=month,
        diary_done=diary_done,
        diary_total_days=total_days,
        photo_done=photo_done,
        photo_total_days=total_days,
        complaint_days=complaint_days,
        entries=[_entry_out(e, cmap.get(int(e.id), [])) for e in entries],
        recurring=recurring,
    )
