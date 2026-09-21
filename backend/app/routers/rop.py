"""Кабинет РОП — дашборд, статистика, распределение, аналитика, отчёт, поиск."""

from __future__ import annotations

from collections import defaultdict
from datetime import UTC, date, datetime, time, timedelta
from decimal import Decimal
from typing import Annotated
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import and_, func, or_, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.core.deps import CurrentCompanyId, CurrentUser, get_db
from app.models import (
    BookingAppointment,
    BookingDirection,
    BookingSpecialist,
    ChatMessage,
    ChatThread,
    Lead,
    LeadAuditEvent,
    Pipeline,
    PipelineStage,
    SalesKpiManualSale,
    SalesKpiManualSalePayment,
    SalesKpiPlanItem,
    Task,
    TaskStatus,
    User,
    UserPipelineAssignment,
    UserRole,
)
from app.schemas.rop import (
    RopAcceptsLeadsPatch,
    RopAnalyticsManagerSla,
    RopAnalyticsReport,
    RopBulkTransferBody,
    RopBulkTransferResult,
    RopDashboard,
    RopDayClose,
    RopDayCloseManager,
    RopLeadTransferBody,
    RopLeadTransferResult,
    RopManagerPresence,
    RopManagerRow,
    RopManagersList,
    RopReportCell,
    RopRevenueReport,
    RopRevenueShare,
    RopSearchPatient,
    RopSearchVisit,
    RopStageCount,
    RopStatsManager,
    RopStatsReport,
    RopStatsStage,
)
from app.services.audit import write_audit_event
from app.services.clinic_roles import can_access_rop
from app.services.lead_sales_stages import ARCHIVE_STAGE_NAME

router = APIRouter(prefix="/rop", tags=["rop"])

ONLINE_WINDOW = timedelta(minutes=2)
PRESENCE_ROLES = frozenset(
    {
        UserRole.manager,
        UserRole.admin,
        UserRole.rop,
        UserRole.owner,
        UserRole.administrator,
    }
)


def _assert_rop(user: User) -> None:
    if not can_access_rop(user.role):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Доступ только для РОП / владельца")


def _booking_tz() -> ZoneInfo:
    try:
        return ZoneInfo(settings.booking_timezone or "Asia/Dushanbe")
    except Exception:
        return ZoneInfo("Asia/Dushanbe")


def _day_bounds(day: date) -> tuple[datetime, datetime]:
    tz = _booking_tz()
    start = datetime.combine(day, time.min, tzinfo=tz).astimezone(UTC)
    end = start + timedelta(days=1)
    return start, end


def _today_local() -> date:
    return datetime.now(_booking_tz()).date()


def _display_name(u: User) -> str:
    return (u.full_name or "").strip() or u.email


def _is_online(last_seen: datetime | None, *, now: datetime | None = None) -> bool:
    if last_seen is None:
        return False
    n = now or datetime.now(UTC)
    ts = last_seen if last_seen.tzinfo else last_seen.replace(tzinfo=UTC)
    return (n - ts.astimezone(UTC)) <= ONLINE_WINDOW


async def _load_pipeline(db: AsyncSession, company_id: int, pipeline_id: int) -> Pipeline:
    pipe = await db.get(Pipeline, pipeline_id)
    if pipe is None or pipe.company_id != company_id:
        raise HTTPException(status_code=404, detail="Воронка не найдена")
    return pipe


async def _pipeline_manager_ids(db: AsyncSession, *, company_id: int, pipeline_id: int) -> list[int]:
    rows = (
        await db.execute(
            select(User.id)
            .join(UserPipelineAssignment, UserPipelineAssignment.user_id == User.id)
            .where(
                User.company_id == company_id,
                User.is_active.is_(True),
                User.role == UserRole.manager,
                UserPipelineAssignment.company_id == company_id,
                UserPipelineAssignment.pipeline_id == pipeline_id,
            )
            .order_by(User.id.asc())
        )
    ).scalars().all()
    ids = [int(x) for x in rows]
    if ids:
        return ids
    return list(
        (
            await db.execute(
                select(User.id)
                .where(
                    User.company_id == company_id,
                    User.is_active.is_(True),
                    User.role == UserRole.manager,
                )
                .order_by(User.id.asc())
            )
        ).scalars().all()
    )


async def _archive_stage_ids(db: AsyncSession, *, company_id: int, pipeline_id: int) -> set[int]:
    rows = (
        await db.execute(
            select(PipelineStage.id).where(
                PipelineStage.company_id == company_id,
                PipelineStage.pipeline_id == pipeline_id,
                PipelineStage.name == ARCHIVE_STAGE_NAME,
            )
        )
    ).scalars().all()
    return {int(x) for x in rows}


@router.post("/presence/heartbeat")
async def presence_heartbeat(
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentUser,
) -> dict[str, str]:
    if current_user.role not in PRESENCE_ROLES:
        return {"ok": "skipped"}
    user = await db.get(User, current_user.id)
    if user is None:
        raise HTTPException(status_code=404, detail="Пользователь не найден")
    user.last_seen_at = datetime.now(UTC)
    await db.flush()
    return {"ok": "true"}


@router.get("/dashboard", response_model=RopDashboard)
async def rop_dashboard(
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentUser,
    company_id: CurrentCompanyId,
    pipeline_id: int = Query(..., ge=1),
) -> RopDashboard:
    _assert_rop(current_user)
    pipe = await _load_pipeline(db, company_id, pipeline_id)
    day = _today_local()
    start, end = _day_bounds(day)
    now = datetime.now(UTC)
    manager_ids = await _pipeline_manager_ids(db, company_id=company_id, pipeline_id=pipeline_id)
    archive_ids = await _archive_stage_ids(db, company_id=company_id, pipeline_id=pipeline_id)

    managers = (
        await db.execute(select(User).where(User.id.in_(manager_ids or [0])))
    ).scalars().all() if manager_ids else []
    by_id = {int(u.id): u for u in managers}

    active_q = (
        select(Lead.manager_id, func.count())
        .join(PipelineStage, PipelineStage.id == Lead.status_id)
        .where(
            Lead.company_id == company_id,
            PipelineStage.pipeline_id == pipeline_id,
            Lead.manager_id.in_(manager_ids or [0]),
        )
    )
    if archive_ids:
        active_q = active_q.where(Lead.status_id.notin_(archive_ids))
    active_rows = (await db.execute(active_q.group_by(Lead.manager_id))).all()
    active_map = {int(mid): int(cnt) for mid, cnt in active_rows if mid}

    new_rows = (
        await db.execute(
            select(Lead.manager_id, func.count())
            .join(PipelineStage, PipelineStage.id == Lead.status_id)
            .where(
                Lead.company_id == company_id,
                PipelineStage.pipeline_id == pipeline_id,
                Lead.manager_id.in_(manager_ids or [0]),
                Lead.created_at >= start,
                Lead.created_at < end,
            )
            .group_by(Lead.manager_id)
        )
    ).all() if manager_ids else []
    new_map = {int(mid): int(cnt) for mid, cnt in new_rows if mid}

    book_rows = (
        await db.execute(
            select(BookingAppointment.responsible_manager_id, func.count())
            .where(
                BookingAppointment.company_id == company_id,
                BookingAppointment.responsible_manager_id.in_(manager_ids or [0]),
                BookingAppointment.start_at >= start,
                BookingAppointment.start_at < end,
                BookingAppointment.status != "cancelled",
            )
            .group_by(BookingAppointment.responsible_manager_id)
        )
    ).all() if manager_ids else []
    book_map = {int(mid): int(cnt) for mid, cnt in book_rows if mid}

    rev_rows = (
        await db.execute(
            select(
                BookingAppointment.responsible_manager_id,
                func.coalesce(func.sum(BookingAppointment.paid_amount), 0),
            )
            .where(
                BookingAppointment.company_id == company_id,
                BookingAppointment.responsible_manager_id.in_(manager_ids or [0]),
                BookingAppointment.start_at >= start,
                BookingAppointment.start_at < end,
                BookingAppointment.status != "cancelled",
            )
            .group_by(BookingAppointment.responsible_manager_id)
        )
    ).all() if manager_ids else []
    rev_map = {int(mid): Decimal(str(amt or 0)) for mid, amt in rev_rows if mid}

    man_rows = (
        await db.execute(
            select(
                SalesKpiManualSale.manager_user_id,
                func.coalesce(func.sum(SalesKpiManualSalePayment.amount), 0),
            )
            .join(SalesKpiManualSalePayment, SalesKpiManualSalePayment.sale_id == SalesKpiManualSale.id)
            .where(
                SalesKpiManualSale.company_id == company_id,
                SalesKpiManualSale.pipeline_id == pipeline_id,
                SalesKpiManualSale.manager_user_id.in_(manager_ids or [0]),
                SalesKpiManualSalePayment.paid_at >= start,
                SalesKpiManualSalePayment.paid_at < end,
            )
            .group_by(SalesKpiManualSale.manager_user_id)
        )
    ).all() if manager_ids else []
    for mid, amt in man_rows:
        if mid is None:
            continue
        rev_map[int(mid)] = rev_map.get(int(mid), Decimal("0")) + Decimal(str(amt or 0))

    items: list[RopManagerPresence] = []
    for mid in manager_ids:
        u = by_id.get(mid)
        if u is None:
            continue
        items.append(
            RopManagerPresence(
                user_id=mid,
                full_name=_display_name(u),
                email=u.email,
                is_online=_is_online(u.last_seen_at, now=now),
                last_seen_at=u.last_seen_at,
                accepts_new_leads=bool(u.accepts_new_leads),
                active_leads=active_map.get(mid, 0),
                new_leads_today=new_map.get(mid, 0),
                bookings_today=book_map.get(mid, 0),
                revenue_today=rev_map.get(mid, Decimal("0")),
            )
        )
    items.sort(key=lambda x: (not x.is_online, x.full_name.lower()))
    return RopDashboard(
        pipeline_id=int(pipe.id),
        pipeline_name=pipe.name,
        date=day,
        online_count=sum(1 for x in items if x.is_online),
        managers=items,
    )


@router.get("/dashboard/day-close", response_model=RopDayClose)
async def rop_day_close(
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentUser,
    company_id: CurrentCompanyId,
    pipeline_id: int = Query(..., ge=1),
    day: date | None = Query(None, alias="date"),
) -> RopDayClose:
    _assert_rop(current_user)
    pipe = await _load_pipeline(db, company_id, pipeline_id)
    target = day or _today_local()
    start, end = _day_bounds(target)
    manager_ids = await _pipeline_manager_ids(db, company_id=company_id, pipeline_id=pipeline_id)
    archive_ids = await _archive_stage_ids(db, company_id=company_id, pipeline_id=pipeline_id)
    managers = (
        await db.execute(select(User).where(User.id.in_(manager_ids or [0])))
    ).scalars().all() if manager_ids else []
    by_id = {int(u.id): u for u in managers}

    stage_rows = (
        await db.execute(
            select(Lead.manager_id, Lead.status_id, PipelineStage.name, func.count())
            .join(PipelineStage, PipelineStage.id == Lead.status_id)
            .where(
                Lead.company_id == company_id,
                PipelineStage.pipeline_id == pipeline_id,
                Lead.manager_id.in_(manager_ids or [0]),
            )
            .group_by(Lead.manager_id, Lead.status_id, PipelineStage.name)
        )
    ).all() if manager_ids else []
    stages_map: dict[int, list[RopStageCount]] = defaultdict(list)
    for mid, sid, sname, cnt in stage_rows:
        if mid is None:
            continue
        stages_map[int(mid)].append(
            RopStageCount(stage_id=int(sid), stage_name=str(sname), count=int(cnt))
        )

    replied_map: dict[int, int] = {}
    if manager_ids:
        for mid, cnt in (
            await db.execute(
                select(Lead.manager_id, func.count(func.distinct(Lead.id)))
                .join(ChatThread, ChatThread.lead_id == Lead.id)
                .join(ChatMessage, ChatMessage.thread_id == ChatThread.id)
                .join(PipelineStage, PipelineStage.id == Lead.status_id)
                .where(
                    Lead.company_id == company_id,
                    PipelineStage.pipeline_id == pipeline_id,
                    Lead.manager_id.in_(manager_ids),
                    ChatMessage.direction == "out",
                    ChatMessage.created_at >= start,
                    ChatMessage.created_at < end,
                )
                .group_by(Lead.manager_id)
            )
        ).all():
            if mid is not None:
                replied_map[int(mid)] = int(cnt)
        for mid, cnt in (
            await db.execute(
                select(Lead.manager_id, func.count(func.distinct(Lead.id)))
                .join(LeadAuditEvent, LeadAuditEvent.lead_id == Lead.id)
                .join(PipelineStage, PipelineStage.id == Lead.status_id)
                .where(
                    Lead.company_id == company_id,
                    PipelineStage.pipeline_id == pipeline_id,
                    Lead.manager_id.in_(manager_ids),
                    LeadAuditEvent.action == "card_opened",
                    LeadAuditEvent.created_at >= start,
                    LeadAuditEvent.created_at < end,
                )
                .group_by(Lead.manager_id)
            )
        ).all():
            if mid is None:
                continue
            replied_map[int(mid)] = max(replied_map.get(int(mid), 0), int(cnt))

    book_map: dict[int, int] = {}
    rev_map: dict[int, Decimal] = {}
    if manager_ids:
        for mid, cnt in (
            await db.execute(
                select(BookingAppointment.responsible_manager_id, func.count())
                .where(
                    BookingAppointment.company_id == company_id,
                    BookingAppointment.responsible_manager_id.in_(manager_ids),
                    BookingAppointment.start_at >= start,
                    BookingAppointment.start_at < end,
                    BookingAppointment.status != "cancelled",
                )
                .group_by(BookingAppointment.responsible_manager_id)
            )
        ).all():
            if mid is not None:
                book_map[int(mid)] = int(cnt)
        for mid, amt in (
            await db.execute(
                select(
                    BookingAppointment.responsible_manager_id,
                    func.coalesce(func.sum(BookingAppointment.paid_amount), 0),
                )
                .where(
                    BookingAppointment.company_id == company_id,
                    BookingAppointment.responsible_manager_id.in_(manager_ids),
                    BookingAppointment.start_at >= start,
                    BookingAppointment.start_at < end,
                    BookingAppointment.status != "cancelled",
                )
                .group_by(BookingAppointment.responsible_manager_id)
            )
        ).all():
            if mid is not None:
                rev_map[int(mid)] = Decimal(str(amt or 0))

    out: list[RopDayCloseManager] = []
    for mid in manager_ids:
        u = by_id.get(mid)
        if u is None:
            continue
        stages = stages_map.get(mid, [])
        unreplied = sum(
            sc.count for sc in stages if not archive_ids or sc.stage_id not in archive_ids
        )
        unreplied = max(0, unreplied - replied_map.get(mid, 0))
        out.append(
            RopDayCloseManager(
                user_id=mid,
                full_name=_display_name(u),
                replied_leads=replied_map.get(mid, 0),
                unreplied_active=unreplied,
                stages=sorted(stages, key=lambda s: s.stage_name),
                bookings_today=book_map.get(mid, 0),
                revenue_today=rev_map.get(mid, Decimal("0")),
            )
        )
    out.sort(key=lambda x: x.full_name.lower())
    return RopDayClose(
        pipeline_id=int(pipe.id),
        pipeline_name=pipe.name,
        date=target,
        managers=out,
    )


@router.get("/stats", response_model=RopStatsReport)
async def rop_stats(
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentUser,
    company_id: CurrentCompanyId,
    pipeline_id: int = Query(..., ge=1),
    date_from: date = Query(..., alias="from"),
    date_to: date = Query(..., alias="to"),
) -> RopStatsReport:
    _assert_rop(current_user)
    if date_to < date_from:
        raise HTTPException(status_code=400, detail="Период: to должен быть ≥ from")
    pipe = await _load_pipeline(db, company_id, pipeline_id)
    start, _ = _day_bounds(date_from)
    _, end = _day_bounds(date_to)
    manager_ids = await _pipeline_manager_ids(db, company_id=company_id, pipeline_id=pipeline_id)
    managers = (
        await db.execute(select(User).where(User.id.in_(manager_ids or [0])))
    ).scalars().all() if manager_ids else []
    by_id = {int(u.id): u for u in managers}

    in_map: dict[int, int] = {}
    proc_map: dict[int, int] = {}
    stages_raw: dict[int, list[tuple[int, str, int]]] = defaultdict(list)
    if manager_ids:
        for mid, cnt in (
            await db.execute(
                select(Lead.manager_id, func.count())
                .join(PipelineStage, PipelineStage.id == Lead.status_id)
                .where(
                    Lead.company_id == company_id,
                    PipelineStage.pipeline_id == pipeline_id,
                    Lead.manager_id.in_(manager_ids),
                    Lead.created_at >= start,
                    Lead.created_at < end,
                )
                .group_by(Lead.manager_id)
            )
        ).all():
            if mid is not None:
                in_map[int(mid)] = int(cnt)
        for mid, cnt in (
            await db.execute(
                select(Lead.manager_id, func.count(func.distinct(Lead.id)))
                .join(ChatThread, ChatThread.lead_id == Lead.id)
                .join(ChatMessage, ChatMessage.thread_id == ChatThread.id)
                .join(PipelineStage, PipelineStage.id == Lead.status_id)
                .where(
                    Lead.company_id == company_id,
                    PipelineStage.pipeline_id == pipeline_id,
                    Lead.manager_id.in_(manager_ids),
                    Lead.created_at >= start,
                    Lead.created_at < end,
                    ChatMessage.direction == "out",
                    ChatMessage.created_at >= start,
                    ChatMessage.created_at < end,
                )
                .group_by(Lead.manager_id)
            )
        ).all():
            if mid is not None:
                proc_map[int(mid)] = int(cnt)
        for mid, cnt in (
            await db.execute(
                select(Lead.manager_id, func.count(func.distinct(Lead.id)))
                .join(LeadAuditEvent, LeadAuditEvent.lead_id == Lead.id)
                .join(PipelineStage, PipelineStage.id == Lead.status_id)
                .where(
                    Lead.company_id == company_id,
                    PipelineStage.pipeline_id == pipeline_id,
                    Lead.manager_id.in_(manager_ids),
                    Lead.created_at >= start,
                    Lead.created_at < end,
                    LeadAuditEvent.action == "card_opened",
                    LeadAuditEvent.created_at >= start,
                    LeadAuditEvent.created_at < end,
                )
                .group_by(Lead.manager_id)
            )
        ).all():
            if mid is None:
                continue
            proc_map[int(mid)] = max(proc_map.get(int(mid), 0), int(cnt))
        for mid, sid, sname, cnt in (
            await db.execute(
                select(Lead.manager_id, Lead.status_id, PipelineStage.name, func.count())
                .join(PipelineStage, PipelineStage.id == Lead.status_id)
                .where(
                    Lead.company_id == company_id,
                    PipelineStage.pipeline_id == pipeline_id,
                    Lead.manager_id.in_(manager_ids),
                    Lead.created_at >= start,
                    Lead.created_at < end,
                )
                .group_by(Lead.manager_id, Lead.status_id, PipelineStage.name)
            )
        ).all():
            if mid is None:
                continue
            stages_raw[int(mid)].append((int(sid), str(sname), int(cnt)))

    out: list[RopStatsManager] = []
    for mid in manager_ids:
        u = by_id.get(mid)
        if u is None:
            continue
        leads_in = in_map.get(mid, 0)
        processed = proc_map.get(mid, 0)
        conv = round(100.0 * processed / leads_in, 1) if leads_in else 0.0
        stages = [
            RopStatsStage(
                stage_id=sid,
                stage_name=sname,
                count=cnt,
                percent=round(100.0 * cnt / leads_in, 1) if leads_in else 0.0,
            )
            for sid, sname, cnt in stages_raw.get(mid, [])
        ]
        stages.sort(key=lambda s: -s.count)
        out.append(
            RopStatsManager(
                user_id=mid,
                full_name=_display_name(u),
                leads_in=leads_in,
                processed=processed,
                conversion_percent=conv,
                stages=stages,
            )
        )
    out.sort(key=lambda x: -x.leads_in)
    return RopStatsReport(
        pipeline_id=int(pipe.id),
        pipeline_name=pipe.name,
        date_from=date_from,
        date_to=date_to,
        managers=out,
    )


@router.get("/managers", response_model=RopManagersList)
async def rop_managers(
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentUser,
    company_id: CurrentCompanyId,
    pipeline_id: int = Query(..., ge=1),
) -> RopManagersList:
    _assert_rop(current_user)
    await _load_pipeline(db, company_id, pipeline_id)
    manager_ids = await _pipeline_manager_ids(db, company_id=company_id, pipeline_id=pipeline_id)
    now = datetime.now(UTC)
    managers = (
        await db.execute(select(User).where(User.id.in_(manager_ids or [0])))
    ).scalars().all() if manager_ids else []
    count_map: dict[int, int] = {}
    if manager_ids:
        for mid, cnt in (
            await db.execute(
                select(Lead.manager_id, func.count())
                .join(PipelineStage, PipelineStage.id == Lead.status_id)
                .where(
                    Lead.company_id == company_id,
                    PipelineStage.pipeline_id == pipeline_id,
                    Lead.manager_id.in_(manager_ids),
                )
                .group_by(Lead.manager_id)
            )
        ).all():
            if mid is not None:
                count_map[int(mid)] = int(cnt)
    rows = [
        RopManagerRow(
            user_id=int(u.id),
            full_name=_display_name(u),
            email=u.email,
            accepts_new_leads=bool(u.accepts_new_leads),
            lead_count=count_map.get(int(u.id), 0),
            is_online=_is_online(u.last_seen_at, now=now),
            last_seen_at=u.last_seen_at,
        )
        for u in managers
    ]
    rows.sort(key=lambda x: x.full_name.lower())
    return RopManagersList(pipeline_id=pipeline_id, managers=rows)


@router.patch("/managers/{manager_id}/accepts-leads", response_model=RopManagerRow)
async def rop_patch_accepts_leads(
    manager_id: int,
    body: RopAcceptsLeadsPatch,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentUser,
    company_id: CurrentCompanyId,
    pipeline_id: int = Query(..., ge=1),
) -> RopManagerRow:
    _assert_rop(current_user)
    await _load_pipeline(db, company_id, pipeline_id)
    user = await db.get(User, manager_id)
    if user is None or user.company_id != company_id or user.role != UserRole.manager:
        raise HTTPException(status_code=404, detail="Менеджер не найден")
    user.accepts_new_leads = bool(body.accepts_new_leads)
    await write_audit_event(
        db,
        entity_type="user",
        entity_id=user.id,
        action="accepts_new_leads_updated",
        current_user=current_user,
        details=f"accepts_new_leads={user.accepts_new_leads}; by_rop={current_user.id}",
    )
    await db.flush()
    cnt = (
        await db.execute(
            select(func.count())
            .select_from(Lead)
            .join(PipelineStage, PipelineStage.id == Lead.status_id)
            .where(
                Lead.company_id == company_id,
                PipelineStage.pipeline_id == pipeline_id,
                Lead.manager_id == user.id,
            )
        )
    ).scalar_one()
    return RopManagerRow(
        user_id=int(user.id),
        full_name=_display_name(user),
        email=user.email,
        accepts_new_leads=bool(user.accepts_new_leads),
        lead_count=int(cnt or 0),
        is_online=_is_online(user.last_seen_at),
        last_seen_at=user.last_seen_at,
    )


@router.post("/leads/transfer", response_model=RopLeadTransferResult)
async def rop_transfer_lead(
    body: RopLeadTransferBody,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentUser,
    company_id: CurrentCompanyId,
) -> RopLeadTransferResult:
    _assert_rop(current_user)
    lead = await db.get(Lead, body.lead_id)
    if lead is None or lead.company_id != company_id:
        raise HTTPException(status_code=404, detail="Лид не найден")
    target = await db.get(User, body.to_manager_id)
    if (
        target is None
        or target.company_id != company_id
        or target.role != UserRole.manager
        or not target.is_active
    ):
        raise HTTPException(status_code=400, detail="Получатель должен быть активным менеджером")
    from_id = int(lead.manager_id) if lead.manager_id is not None else None
    lead.manager_id = int(target.id)
    await write_audit_event(
        db,
        entity_type="lead",
        entity_id=lead.id,
        action="manager_reassigned",
        current_user=current_user,
        details=f"from_manager_id={from_id}, to_manager_id={target.id}, via=rop_transfer",
    )
    if from_id is not None:
        appts = (
            await db.execute(
                select(BookingAppointment).where(
                    BookingAppointment.company_id == company_id,
                    BookingAppointment.lead_id == lead.id,
                    BookingAppointment.responsible_manager_id == from_id,
                )
            )
        ).scalars().all()
        for appt in appts:
            appt.responsible_manager_id = int(target.id)
        await db.execute(
            update(Task)
            .where(
                Task.company_id == company_id,
                Task.related_lead_id == lead.id,
                Task.assigned_to == from_id,
                Task.status.in_([TaskStatus.pending, TaskStatus.in_progress]),
            )
            .values(assigned_to=int(target.id))
        )
    await db.flush()
    return RopLeadTransferResult(
        lead_id=int(lead.id),
        from_manager_id=from_id,
        to_manager_id=int(target.id),
    )


@router.post("/leads/transfer-bulk", response_model=RopBulkTransferResult)
async def rop_transfer_bulk(
    body: RopBulkTransferBody,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentUser,
    company_id: CurrentCompanyId,
) -> RopBulkTransferResult:
    _assert_rop(current_user)
    from app.routers.leads import LeadRedistributeBody, redistribute_manager_leads

    result = await redistribute_manager_leads(
        LeadRedistributeBody(from_manager_id=body.from_manager_id, to_manager_ids=body.to_manager_ids),
        db,
        current_user,
        company_id,
    )
    return RopBulkTransferResult(
        total=int(result.total),
        reassigned=int(result.reassigned),
        per_manager={int(k): int(v) for k, v in (result.per_manager or {}).items()},
    )


@router.get("/analytics", response_model=RopAnalyticsReport)
async def rop_analytics(
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentUser,
    company_id: CurrentCompanyId,
    pipeline_id: int = Query(..., ge=1),
    date_from: date = Query(..., alias="from"),
    date_to: date = Query(..., alias="to"),
) -> RopAnalyticsReport:
    _assert_rop(current_user)
    if date_to < date_from:
        raise HTTPException(status_code=400, detail="Период: to должен быть ≥ from")
    pipe = await _load_pipeline(db, company_id, pipeline_id)
    start, _ = _day_bounds(date_from)
    _, end = _day_bounds(date_to)
    manager_ids = await _pipeline_manager_ids(db, company_id=company_id, pipeline_id=pipeline_id)
    managers = (
        await db.execute(select(User).where(User.id.in_(manager_ids or [0])))
    ).scalars().all() if manager_ids else []
    by_id = {int(u.id): u for u in managers}

    leads = (
        await db.execute(
            select(Lead.id, Lead.manager_id, Lead.created_at)
            .join(PipelineStage, PipelineStage.id == Lead.status_id)
            .where(
                Lead.company_id == company_id,
                PipelineStage.pipeline_id == pipeline_id,
                Lead.manager_id.in_(manager_ids or [0]),
                Lead.created_at >= start,
                Lead.created_at < end,
            )
        )
    ).all() if manager_ids else []
    lead_ids = [int(r[0]) for r in leads]
    created_map = {int(r[0]): r[2] for r in leads}
    mgr_of = {int(r[0]): int(r[1]) for r in leads if r[1] is not None}

    first_opened: dict[int, datetime] = {}
    if lead_ids:
        for lid, ts in (
            await db.execute(
                select(LeadAuditEvent.lead_id, LeadAuditEvent.created_at)
                .where(
                    LeadAuditEvent.action == "card_opened",
                    LeadAuditEvent.lead_id.in_(lead_ids),
                )
                .order_by(LeadAuditEvent.created_at.asc())
            )
        ).all():
            lid_i = int(lid)
            if lid_i not in first_opened:
                first_opened[lid_i] = ts

    sla_by_mgr: dict[int, list[float]] = defaultdict(list)
    leads_cnt: dict[int, int] = defaultdict(int)
    for lid, mid in mgr_of.items():
        leads_cnt[mid] += 1
        created = created_map.get(lid)
        opened = first_opened.get(lid)
        if created is None or opened is None:
            continue
        c = created if created.tzinfo else created.replace(tzinfo=UTC)
        o = opened if opened.tzinfo else opened.replace(tzinfo=UTC)
        mins = (o.astimezone(UTC) - c.astimezone(UTC)).total_seconds() / 60.0
        if mins >= 0:
            sla_by_mgr[mid].append(mins)

    all_mins = [m for vals in sla_by_mgr.values() for m in vals]
    avg_all = round(sum(all_mins) / len(all_mins), 2) if all_mins else None
    managers_sla = [
        RopAnalyticsManagerSla(
            user_id=mid,
            full_name=_display_name(by_id[mid]) if mid in by_id else f"#{mid}",
            avg_first_response_minutes=(
                round(sum(sla_by_mgr[mid]) / len(sla_by_mgr[mid]), 2) if sla_by_mgr.get(mid) else None
            ),
            leads_count=leads_cnt.get(mid, 0),
        )
        for mid in manager_ids
        if mid in by_id
    ]

    amounts: list[tuple[int, str, Decimal]] = []
    if manager_ids:
        for mid, svc, amt in (
            await db.execute(
                select(
                    func.coalesce(BookingAppointment.responsible_manager_id, Lead.manager_id),
                    BookingDirection.name,
                    func.coalesce(func.sum(BookingAppointment.paid_amount), 0),
                )
                .outerjoin(Lead, Lead.id == BookingAppointment.lead_id)
                .join(BookingDirection, BookingDirection.id == BookingAppointment.direction_id)
                .where(
                    BookingAppointment.company_id == company_id,
                    BookingAppointment.start_at >= start,
                    BookingAppointment.start_at < end,
                    BookingAppointment.status != "cancelled",
                    BookingAppointment.paid_amount > 0,
                    or_(
                        BookingAppointment.responsible_manager_id.in_(manager_ids),
                        and_(
                            BookingAppointment.responsible_manager_id.is_(None),
                            Lead.manager_id.in_(manager_ids),
                        ),
                    ),
                )
                .group_by(
                    func.coalesce(BookingAppointment.responsible_manager_id, Lead.manager_id),
                    BookingDirection.name,
                )
            )
        ).all():
            if mid is not None:
                amounts.append((int(mid), str(svc or "Услуга"), Decimal(str(amt or 0))))

        man_rev = (
            await db.execute(
                select(
                    SalesKpiManualSale.manager_user_id,
                    SalesKpiManualSale.plan_item_id,
                    func.coalesce(func.sum(SalesKpiManualSalePayment.amount), 0),
                )
                .join(SalesKpiManualSalePayment, SalesKpiManualSalePayment.sale_id == SalesKpiManualSale.id)
                .where(
                    SalesKpiManualSale.company_id == company_id,
                    SalesKpiManualSale.pipeline_id == pipeline_id,
                    SalesKpiManualSale.manager_user_id.in_(manager_ids),
                    SalesKpiManualSalePayment.paid_at >= start,
                    SalesKpiManualSalePayment.paid_at < end,
                )
                .group_by(SalesKpiManualSale.manager_user_id, SalesKpiManualSale.plan_item_id)
            )
        ).all()
        plan_names: dict[int, str] = {}
        pids = {int(r[1]) for r in man_rev if r[1] is not None}
        if pids:
            for pid, pname in (
                await db.execute(
                    select(SalesKpiPlanItem.id, SalesKpiPlanItem.name).where(SalesKpiPlanItem.id.in_(pids))
                )
            ).all():
                plan_names[int(pid)] = str(pname)
        for mid, pid, amt in man_rev:
            if mid is None:
                continue
            amounts.append(
                (int(mid), plan_names.get(int(pid), "Курс/протокол"), Decimal(str(amt or 0)))
            )

    total = sum((a for _, _, a in amounts), Decimal("0"))
    shares = [
        RopRevenueShare(
            manager_id=mid,
            manager_name=_display_name(by_id[mid]) if mid in by_id else f"#{mid}",
            service_name=svc,
            amount=amt,
            percent_of_total=round(float(amt) * 100.0 / float(total), 1) if total else 0.0,
        )
        for mid, svc, amt in amounts
        if amt > 0
    ]
    shares.sort(key=lambda x: -float(x.amount))

    return RopAnalyticsReport(
        pipeline_id=int(pipe.id),
        pipeline_name=pipe.name,
        date_from=date_from,
        date_to=date_to,
        avg_first_response_minutes=avg_all,
        managers_sla=managers_sla,
        revenue_shares=shares,
        revenue_total=total,
    )


@router.get("/report", response_model=RopRevenueReport)
async def rop_report(
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentUser,
    company_id: CurrentCompanyId,
    pipeline_id: int = Query(..., ge=1),
    date_from: date = Query(..., alias="from"),
    date_to: date = Query(..., alias="to"),
) -> RopRevenueReport:
    analytics = await rop_analytics(db, current_user, company_id, pipeline_id, date_from, date_to)
    rows = [
        RopReportCell(
            manager_id=s.manager_id,
            manager_name=s.manager_name,
            service_name=s.service_name,
            amount=s.amount,
        )
        for s in analytics.revenue_shares
    ]
    return RopRevenueReport(
        pipeline_id=analytics.pipeline_id,
        pipeline_name=analytics.pipeline_name,
        date_from=date_from,
        date_to=date_to,
        rows=rows,
        total=analytics.revenue_total,
    )


@router.get("/search", response_model=list[RopSearchPatient])
async def rop_search(
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentUser,
    company_id: CurrentCompanyId,
    q: str = Query(..., min_length=2, max_length=120),
    limit: int = Query(20, ge=1, le=50),
) -> list[RopSearchPatient]:
    _assert_rop(current_user)
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
                BookingAppointment.responsible_manager_id,
                BookingSpecialist.full_name,
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
            .limit(limit * 25)
        )
    ).all()

    mgr_ids = {int(r[8]) for r in rows if r[8] is not None}
    mgr_names: dict[int, str] = {}
    if mgr_ids:
        for u in (await db.execute(select(User).where(User.id.in_(mgr_ids)))).scalars().all():
            mgr_names[int(u.id)] = _display_name(u)

    grouped: dict[tuple[str, str], RopSearchPatient] = {}
    for (
        appt_id,
        patient_name,
        patient_phone,
        start_at,
        status_value,
        service_title,
        service_amount,
        paid_amount,
        resp_mid,
        specialist_name,
    ) in rows:
        name = (patient_name or "").strip() or "Клиент"
        phone = (patient_phone or "").strip() or "—"
        key = (name.lower(), phone)
        item = grouped.get(key)
        if item is None:
            if len(grouped) >= limit:
                continue
            item = RopSearchPatient(
                patient_name=name,
                patient_phone=phone,
                total_visits=0,
                visits=[],
            )
            grouped[key] = item
        item.total_visits += 1
        if item.first_visit_at is None or start_at < item.first_visit_at:
            item.first_visit_at = start_at
        if item.last_visit_at is None or start_at > item.last_visit_at:
            item.last_visit_at = start_at
        mid = int(resp_mid) if resp_mid is not None else None
        item.visits.append(
            RopSearchVisit(
                appointment_id=int(appt_id),
                start_at=start_at,
                specialist_name=specialist_name,
                status=str(status_value or ""),
                service_title=service_title,
                service_amount=float(service_amount or 0),
                paid_amount=float(paid_amount or 0),
                responsible_manager_id=mid,
                responsible_manager_name=mgr_names.get(mid) if mid else None,
            )
        )

    return list(grouped.values())[:limit]
