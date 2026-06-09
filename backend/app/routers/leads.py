from datetime import UTC, datetime
from decimal import Decimal
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, UploadFile, status
from fastapi.responses import Response
from pydantic import BaseModel, Field
from sqlalchemy import and_, case, delete, false, func, or_, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.config import settings
from app.core.deps import CurrentCompanyId, CurrentUser
from app.core.manager_scope import manager_lead_visibility
from app.core.rbac import is_manager_like
from app.database import get_db
from app.models import (
    BookingAppointment,
    ChatThread,
    Deal,
    FinanceJournalEntry,
    Integration,
    Lead,
    LeadAuditEvent,
    Pipeline,
    PipelineStage,
    Task,
    TaskStatus,
    User,
    UserPipelineAssignment,
    UserRole,
)
from app.schemas.lead import (
    LeadCreate,
    LeadImportErrorItem,
    LeadImportResponse,
    LeadRead,
    LeadStatusPatchResponse,
    LeadStatusUpdate,
    LeadTablePage,
    LeadUpdate,
)
from app.services.audit import write_audit_event
from app.services.patient_phone_visibility import resolve_phone_fields
from app.services.automation import process_lead_automation
from app.services.finance_crm_bridge import sync_deal_payment_revenue
from app.services.lead_assignment import assign_manager_for_new_lead
from app.services.sales_kpi import get_kpi_service_price
from app.services.lead_import import decode_csv_text, normalize_email_strict, parse_csv_rows, row_to_parsed_lead
from app.schemas.deal import DealRead, ExtraServiceAddBody, ProtocolConfirmBody
from app.schemas.deal import ProtocolFinishBody

router = APIRouter(prefix="/leads", tags=["leads"])

INTEGRATION_CLOSE_DEAL_TYPE = "integration_close"
_MAX_REDISTRIBUTE_BATCH = 2000

# asyncpg / PostgreSQL wire protocol: max 32767 bind parameters per statement.
# Deal aggregate query uses 7 fixed params + one per lead_id in IN (...).
_MAX_LEAD_IDS_PER_IN_QUERY = 32000


def _chunked_ids(ids: list[int], size: int) -> list[list[int]]:
    return [ids[i : i + size] for i in range(0, len(ids), size)]


class LeadAuditRead(BaseModel):
    id: int
    lead_id: int
    action: str
    details: str | None = None
    user_id: int | None = None
    user_name: str | None = None
    created_at: datetime


async def _audit_lead(
    db: AsyncSession,
    *,
    lead_id: int,
    action: str,
    current_user: User | None,
    details: str | None = None,
) -> None:
    lead = await db.get(Lead, lead_id)
    db.add(
        LeadAuditEvent(
            company_id=(lead.company_id if lead else (current_user.company_id if current_user else None)),
            lead_id=lead_id,
            user_id=(current_user.id if current_user else None),
            action=action,
            details=details,
        )
    )
    await db.flush()


async def _stage_id_by_name(db: AsyncSession, name: str, pipeline_id: int | None = None) -> int | None:
    q = select(PipelineStage.id).where(PipelineStage.name == name)
    if pipeline_id is not None:
        q = q.where(PipelineStage.pipeline_id == pipeline_id)
    r = await db.execute(q)
    return r.scalar_one_or_none()


async def _ensure_stage_by_name(
    db: AsyncSession,
    *,
    name: str,
    pipeline_id: int,
    color: str = "#ef4444",
) -> tuple[int, bool]:
    sid = await _stage_id_by_name(db, name, pipeline_id=pipeline_id)
    if sid is not None:
        return sid, False
    max_order = await db.scalar(
        select(func.max(PipelineStage.order)).where(PipelineStage.pipeline_id == pipeline_id),
    )
    st = PipelineStage(
        name=name,
        order=int(max_order or -1) + 1,
        color=color,
        pipeline_id=pipeline_id,
    )
    db.add(st)
    await db.flush()
    return st.id, True


async def _manager_pipeline_ids(db: AsyncSession, user_id: int) -> set[int]:
    u = await db.get(User, user_id)
    if u is None or u.company_id is None:
        return set()
    rows = await db.execute(
        select(UserPipelineAssignment.pipeline_id).where(
            UserPipelineAssignment.user_id == user_id,
            UserPipelineAssignment.company_id == u.company_id,
        ),
    )
    return {r[0] for r in rows.all()}


async def _expert_pipeline_ids(db: AsyncSession, *, user_id: int, company_id: int) -> set[int]:
    rows = await db.execute(
        select(Pipeline.id).where(
            Pipeline.company_id == company_id,
            Pipeline.expert_user_id == user_id,
        ),
    )
    return {int(r[0]) for r in rows.all()}


async def _assert_expert_lead_access(
    db: AsyncSession,
    *,
    current_user: User,
    lead: Lead,
    company_id: int,
) -> None:
    if current_user.role != UserRole.expert:
        return
    await db.refresh(lead, ["stage"])
    pid = lead.stage.pipeline_id if lead.stage else None
    if pid is None:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Лид не привязан к воронке эксперта")
    allowed = await _expert_pipeline_ids(db, user_id=current_user.id, company_id=company_id)
    if pid not in allowed:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Лид не относится к воронке эксперта")


async def _pipelines_with_manager_close_deal(db: AsyncSession) -> set[int]:
    r = await db.execute(
        select(Integration.pipeline_id)
        .where(
            Integration.is_active.is_(True),
            Integration.manager_close_deal_enabled.is_(True),
        )
        .distinct(),
    )
    return {row[0] for row in r.all()}


async def _pipeline_has_manager_close_deal(db: AsyncSession, pipeline_id: int | None) -> bool:
    if pipeline_id is None:
        return False
    r = await db.scalar(
        select(Integration.id).where(
            Integration.pipeline_id == pipeline_id,
            Integration.is_active.is_(True),
            Integration.manager_close_deal_enabled.is_(True),
        ).limit(1),
    )
    return r is not None


async def _lead_ids_with_integration_close_deal(db: AsyncSession, lead_ids: list[int]) -> set[int]:
    if not lead_ids:
        return set()
    out: set[int] = set()
    for chunk in _chunked_ids(lead_ids, _MAX_LEAD_IDS_PER_IN_QUERY):
        r = await db.execute(
            select(Deal.lead_id).where(
                Deal.lead_id.in_(chunk),
                Deal.deal_type == INTEGRATION_CLOSE_DEAL_TYPE,
            ),
        )
        out.update(row[0] for row in r.all())
    return out


def _show_close_deal_ui(
    lead: Lead,
    read: LeadRead,
    current_user: User,
    pipelines_flag: set[int],
    closed_ids: set[int],
    mgr_allowed: set[int] | None,
) -> bool:
    pid = read.pipeline_id
    if pid is None or pid not in pipelines_flag:
        return False
    if lead.id in closed_ids:
        return False
    if (read.stage_name or "").strip() == settings.booking_stage_completed:
        return False
    if current_user.role == UserRole.owner:
        return True
    if not is_manager_like(current_user.role) or mgr_allowed is None:
        return False
    if pid not in mgr_allowed:
        return False
    if lead.manager_id is not None and lead.manager_id != current_user.id:
        return False
    return True


async def _enrich_leads_close_deal(
    db: AsyncSession,
    leads: list[Lead],
    items: list[LeadRead],
    current_user: User,
) -> list[LeadRead]:
    if not leads or len(leads) != len(items):
        return items
    pf = await _pipelines_with_manager_close_deal(db)
    closed = await _lead_ids_with_integration_close_deal(db, [l.id for l in leads])
    mgr_allowed: set[int] | None = None
    if is_manager_like(current_user.role):
        mgr_allowed = await _manager_pipeline_ids(db, current_user.id)
    out: list[LeadRead] = []
    for lead, read in zip(leads, items, strict=True):
        show = _show_close_deal_ui(lead, read, current_user, pf, closed, mgr_allowed)
        out.append(read.model_copy(update={"show_close_deal_button": show}))
    return out


def _is_lead_redistribution_admin(role: UserRole) -> bool:
    return role in (UserRole.owner, UserRole.admin)


def _is_redistribution_manager_role(role: UserRole) -> bool:
    return role in (UserRole.manager, UserRole.admin)


def _user_display_name(user: User) -> str:
    return (str(user.full_name or "").strip() or str(user.email or "").strip() or f"#{user.id}")


async def _notify_users(
    db: AsyncSession,
    *,
    company_id: int,
    user_ids: list[int],
    title: str,
    description: str | None = None,
    related_lead_id: int | None = None,
) -> None:
    if not user_ids:
        return
    for uid in sorted(set(user_ids)):
        db.add(
            Task(
                company_id=company_id,
                title=title,
                deadline=None,
                status=TaskStatus.pending,
                assigned_to=uid,
                created_by_user_id=None,
                description=description,
                related_lead_id=related_lead_id,
            )
        )
    await db.flush()


async def _notify_by_roles(
    db: AsyncSession,
    *,
    company_id: int,
    lead_id: int,
    title: str,
    assigned_roles: list[UserRole],
    description: str | None = None,
) -> None:
    if not assigned_roles:
        return
    result = await db.execute(
        select(User.id).where(User.company_id == company_id, User.is_active.is_(True), User.role.in_(assigned_roles))
    )
    user_ids = [row[0] for row in result.all()]
    if not user_ids:
        return
    now = datetime.now(UTC)
    for uid in user_ids:
        db.add(
            Task(
                company_id=company_id,
                title=title,
                deadline=None,
                status=TaskStatus.pending,
                assigned_to=uid,
                created_by_user_id=None,
                description=description,
                related_lead_id=lead_id,
            )
        )
    await db.flush()


def _lead_to_read(lead: Lead) -> LeadRead:
    return LeadRead(
        id=lead.id,
        name=lead.name,
        phone=lead.phone,
        phone_display=lead.phone,
        phone_can_view_full=True,
        email=lead.email,
        source=lead.source,
        status_id=lead.status_id,
        stage_name=lead.stage.name if lead.stage else None,
        manager_id=lead.manager_id,
        manager_name=None,
        refusal_reason=lead.refusal_reason,
        pipeline_id=lead.stage.pipeline_id if lead.stage else None,
        created_at=lead.created_at,
    )


async def _apply_phone_visibility_to_read(db: AsyncSession, user: User, read: LeadRead) -> LeadRead:
    phone, display, can_view = await resolve_phone_fields(db, user, read.pipeline_id, read.phone)
    return read.model_copy(
        update={"phone": phone, "phone_display": display, "phone_can_view_full": can_view},
    )


async def _apply_phone_visibility_batch(db: AsyncSession, user: User, items: list[LeadRead]) -> list[LeadRead]:
    out: list[LeadRead] = []
    for item in items:
        out.append(await _apply_phone_visibility_to_read(db, user, item))
    return out


async def _manager_names_map(db: AsyncSession, manager_ids: set[int]) -> dict[int, str]:
    if not manager_ids:
        return {}
    rows = await db.execute(
        select(User.id, User.full_name, User.email).where(User.id.in_(manager_ids)),
    )
    out: dict[int, str] = {}
    for uid, full_name, email in rows.all():
        name = (str(full_name or "").strip() or str(email or "").strip())
        if name:
            out[int(uid)] = name
    return out


async def _lead_to_read_with_manager(db: AsyncSession, lead: Lead, user: User) -> LeadRead:
    mids = {lead.manager_id} if lead.manager_id else set()
    managers = await _manager_names_map(db, mids)
    base = _lead_to_read(lead).model_copy(update={"manager_name": managers.get(lead.manager_id or -1)})
    return await _apply_phone_visibility_to_read(db, user, base)


async def _manager_id_for_manual_lead_create(
    db: AsyncSession,
    *,
    stage: PipelineStage,
    current_user: User,
    company_id: int,
) -> int | None:
    if current_user.role == UserRole.admin:
        return None
    if not is_manager_like(current_user.role):
        return None

    pipeline_id = stage.pipeline_id
    if pipeline_id is None:
        return current_user.id

    pipe = await db.get(Pipeline, int(pipeline_id))
    if pipe is None or pipe.company_id != company_id:
        return current_user.id

    mode = (pipe.lead_assignment_mode or "none").strip().lower()
    intake_id = pipe.intake_manager_user_id
    if (
        current_user.role == UserRole.manager
        and intake_id is not None
        and int(intake_id) == int(current_user.id)
        and mode in ("round_robin", "least_loaded")
    ):
        mid = await assign_manager_for_new_lead(db, pipeline_id=int(pipeline_id))
        return mid

    return current_user.id


@router.post("", response_model=LeadRead, status_code=status.HTTP_201_CREATED)
async def create_lead(
    body: LeadCreate,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentUser,
    company_id: CurrentCompanyId,
) -> LeadRead:
    stage = await db.get(PipelineStage, body.status_id)
    if stage is None or stage.company_id != company_id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Unknown status_id")
    if is_manager_like(current_user.role):
        allowed = await _manager_pipeline_ids(db, current_user.id)
        if stage.pipeline_id not in allowed:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Stage is outside manager directions")
    manager_id = await _manager_id_for_manual_lead_create(db, stage=stage, current_user=current_user, company_id=company_id)
    lead = Lead(
        company_id=company_id,
        name=body.name,
        phone=body.phone,
        email=body.email,
        source=body.source,
        status_id=body.status_id,
        manager_id=manager_id,
    )
    db.add(lead)
    await db.flush()
    await _audit_lead(
        db,
        lead_id=lead.id,
        action="lead_created",
        current_user=current_user,
        details=f"Создан лид на стадии id={lead.status_id}",
    )
    await db.refresh(lead)
    await db.refresh(lead, ["stage"])
    base = await _lead_to_read_with_manager(db, lead, current_user)
    enriched = await _enrich_leads_close_deal(db, [lead], [base], current_user)
    return enriched[0]


async def _leads_to_read_with_deals(
    db: AsyncSession,
    leads: list[Lead],
    current_user: User,
) -> list[LeadRead]:
    if not leads:
        return []

    lead_ids = [l.id for l in leads]
    deal_info: dict[int, dict[str, object]] = {}
    for chunk in _chunked_ids(lead_ids, _MAX_LEAD_IDS_PER_IN_QUERY):
        deal_info_rows = await db.execute(
            select(
                Deal.lead_id,
                func.min(case((Deal.is_protocol.is_(True), Deal.id))).label("protocol_deal_id"),
                func.max(
                    case(
                        (
                            and_(Deal.is_protocol.is_(True), Deal.protocol_requested.is_(True)),
                            1,
                        ),
                        else_=0,
                    ),
                ).label("protocol_requested"),
                func.max(
                    case(
                        (
                            and_(Deal.is_protocol.is_(True), Deal.protocol_confirmed.is_(True)),
                            1,
                        ),
                        else_=0,
                    ),
                ).label("protocol_confirmed"),
                func.max(
                    case(
                        (
                            and_(
                                Deal.is_protocol.is_(True),
                                Deal.protocol_file_path.is_not(None),
                            ),
                            1,
                        ),
                        else_=0,
                    ),
                ).label("protocol_file_attached"),
                func.coalesce(func.sum(Deal.paid_amount), 0).label("paid_extras_amount"),
            )
            .where(Deal.lead_id.in_(chunk))
            .group_by(Deal.lead_id)
        )
        for r in deal_info_rows.all():
            lead_id = r[0]
            deal_info[lead_id] = {
                "protocol_deal_id": r[1],
                "protocol_requested": r[2],
                "protocol_confirmed": r[3],
                "protocol_file_attached": r[4],
                "paid_extras_amount": r[5],
            }

    manager_ids = {lead.manager_id for lead in leads if lead.manager_id is not None}
    manager_names = await _manager_names_map(db, manager_ids)
    out: list[LeadRead] = []
    for lead in leads:
        info = deal_info.get(lead.id)
        base = _lead_to_read(lead).model_copy(update={"manager_name": manager_names.get(lead.manager_id or -1)})
        out.append(
            base.model_copy(
                update={
                    "protocol_deal_id": (info["protocol_deal_id"] if info else None) or None,
                    "protocol_requested": bool(info["protocol_requested"]) if info else False,
                    "protocol_confirmed": bool(info["protocol_confirmed"]) if info else False,
                    "protocol_file_attached": bool(info["protocol_file_attached"]) if info else False,
                    "paid_extras_amount": (info["paid_extras_amount"] if info else Decimal("0")),
                },
            ),
        )
    enriched = await _enrich_leads_close_deal(db, leads, out, current_user)
    return await _apply_phone_visibility_batch(db, current_user, enriched)


@router.get("", response_model=list[LeadRead])
async def list_leads(
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentUser,
    company_id: CurrentCompanyId,
    pipeline_id: int | None = Query(None, ge=1),
    per_stage_limit: int | None = Query(None, ge=1, le=500),
) -> list[LeadRead]:
    """
    Канбан: передайте pipeline_id + per_stage_limit (по умолчанию 200), чтобы не отдавать
    десятки тысяч лидов и не вешать браузер — в каждой колонке будут последние N лидов.
    """
    if pipeline_id is not None:
        if per_stage_limit is None:
            per_stage_limit = 200
        if is_manager_like(current_user.role):
            allowed = await _manager_pipeline_ids(db, current_user.id)
            if not allowed or pipeline_id not in allowed:
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail="Воронка недоступна",
                )
        if current_user.role == UserRole.expert:
            allowed = await _expert_pipeline_ids(db, user_id=current_user.id, company_id=company_id)
            if not allowed or pipeline_id not in allowed:
                raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Воронка недоступна эксперту")
        rn = func.row_number().over(partition_by=Lead.status_id, order_by=Lead.id.desc()).label("rn")
        ranked = (
            select(Lead.id.label("lead_id"), rn)
            .join(PipelineStage, PipelineStage.id == Lead.status_id)
            .where(PipelineStage.pipeline_id == pipeline_id, Lead.company_id == company_id, PipelineStage.company_id == company_id)
        )
        if is_manager_like(current_user.role):
            ranked = ranked.where(manager_lead_visibility(current_user.id))
        ranked_sq = ranked.subquery()
        q = (
            select(Lead)
            .join(ranked_sq, Lead.id == ranked_sq.c.lead_id)
            .where(ranked_sq.c.rn <= per_stage_limit)
            .options(selectinload(Lead.stage))
            .order_by(Lead.id.desc())
        )
        result = await db.execute(q)
        leads = result.scalars().unique().all()
        return await _leads_to_read_with_deals(db, leads, current_user)

    q = select(Lead).options(selectinload(Lead.stage)).where(Lead.company_id == company_id).order_by(Lead.id.desc())
    if is_manager_like(current_user.role):
        allowed = await _manager_pipeline_ids(db, current_user.id)
        if not allowed:
            return []
        q = q.join(PipelineStage, PipelineStage.id == Lead.status_id).where(
            PipelineStage.company_id == company_id,
            PipelineStage.pipeline_id.in_(allowed),
            manager_lead_visibility(current_user.id),
        )
    if current_user.role == UserRole.expert:
        allowed = await _expert_pipeline_ids(db, user_id=current_user.id, company_id=company_id)
        if not allowed:
            return []
        q = q.join(PipelineStage, PipelineStage.id == Lead.status_id).where(
            PipelineStage.company_id == company_id,
            PipelineStage.pipeline_id.in_(allowed),
        )
    result = await db.execute(q)
    leads = result.scalars().unique().all()
    return await _leads_to_read_with_deals(db, leads, current_user)


@router.get("/table", response_model=LeadTablePage)
async def list_leads_table(
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentUser,
    company_id: CurrentCompanyId,
    pipeline_id: int = Query(..., ge=1),
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=100),
    q: str | None = Query(None, max_length=200),
    status_id: int | None = Query(None, ge=1),
) -> LeadTablePage:
    """Полный список лидов воронки с пагинацией и поиском (без лимита «на стадию» как в канбане)."""
    if is_manager_like(current_user.role):
        allowed = await _manager_pipeline_ids(db, current_user.id)
        if not allowed or pipeline_id not in allowed:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Воронка недоступна",
            )
    if current_user.role == UserRole.expert:
        allowed = await _expert_pipeline_ids(db, user_id=current_user.id, company_id=company_id)
        if not allowed or pipeline_id not in allowed:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Воронка недоступна эксперту")

    if status_id is not None:
        st = await db.get(PipelineStage, status_id)
        if st is None or st.pipeline_id != pipeline_id:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Стадия не принадлежит выбранной воронке",
            )

    filters = [PipelineStage.pipeline_id == pipeline_id, PipelineStage.company_id == company_id, Lead.company_id == company_id]
    if is_manager_like(current_user.role):
        filters.append(manager_lead_visibility(current_user.id))
    if status_id is not None:
        filters.append(Lead.status_id == status_id)
    if q and q.strip():
        term = f"%{q.strip()}%"
        filters.append(
            or_(
                Lead.name.ilike(term),
                Lead.phone.ilike(term),
                Lead.email.ilike(term),
            ),
        )

    where_clause = and_(*filters)
    count_q = (
        select(func.count(Lead.id))
        .select_from(Lead)
        .join(PipelineStage, PipelineStage.id == Lead.status_id)
        .where(where_clause)
    )
    total = int((await db.execute(count_q)).scalar_one())

    offset = (page - 1) * page_size
    data_q = (
        select(Lead)
        .options(selectinload(Lead.stage))
        .join(PipelineStage, PipelineStage.id == Lead.status_id)
        .where(where_clause)
        .order_by(Lead.id.desc())
        .offset(offset)
        .limit(page_size)
    )
    result = await db.execute(data_q)
    leads = result.scalars().unique().all()
    items = await _leads_to_read_with_deals(db, list(leads), current_user)
    return LeadTablePage(items=items, total=total, page=page, page_size=page_size)


@router.get("/import/template")
async def lead_import_csv_template(current_user: CurrentUser) -> Response:
    _ = current_user
    body = "name,phone,email,source\nИван Иванов,+79001234567,client@example.com,Битрикс24\n"
    return Response(
        content=("\ufeff" + body).encode("utf-8"),
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": 'attachment; filename="metodione_leads_import.csv"'},
    )


@router.post("/import", response_model=LeadImportResponse)
async def import_leads_csv(
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentUser,
    company_id: CurrentCompanyId,
    file: UploadFile = File(...),
    default_stage_id: int = Form(...),
) -> LeadImportResponse:
    if not file.filename or not file.filename.lower().endswith((".csv", ".txt")):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Ожидается файл .csv (экспорт из Битрикс24 или шаблон MetodiOne)",
        )
    raw = await file.read()
    try:
        text = decode_csv_text(raw)
        rows, _headers = parse_csv_rows(text)
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e)) from e

    if not rows:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="В файле нет строк с данными")

    stage = await db.get(PipelineStage, default_stage_id)
    if stage is None or stage.company_id != company_id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Неизвестная стадия")
    if is_manager_like(current_user.role):
        allowed = await _manager_pipeline_ids(db, current_user.id)
        if stage.pipeline_id not in allowed:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Стадия вне ваших направлений",
            )

    errors: list[LeadImportErrorItem] = []
    work: list[tuple[int, Lead]] = []
    import_manager_id = None if current_user.role == UserRole.admin else current_user.id

    async def _import_manager_id_for_row() -> int | None:
        if import_manager_id is None:
            return None
        if stage.pipeline_id is None:
            return import_manager_id
        pipe = await db.get(Pipeline, int(stage.pipeline_id))
        if pipe is None or pipe.company_id != company_id:
            return import_manager_id
        mode = (pipe.lead_assignment_mode or "none").strip().lower()
        intake_id = pipe.intake_manager_user_id
        if intake_id is None or int(intake_id) != int(import_manager_id):
            return import_manager_id
        if mode not in ("round_robin", "least_loaded"):
            return import_manager_id
        return await assign_manager_for_new_lead(db, pipeline_id=int(stage.pipeline_id))

    for idx, row_map in enumerate(rows, start=2):
        parsed = row_to_parsed_lead(row_map)
        if not parsed:
            errors.append(LeadImportErrorItem(row=idx, message="Нет названия, имени или компании"))
            continue
        email = normalize_email_strict(parsed.email) if parsed.email else None
        row_manager_id = await _import_manager_id_for_row()
        work.append(
            (
                idx,
                Lead(
                    company_id=company_id,
                    name=parsed.name,
                    phone=parsed.phone,
                    email=email,
                    source=parsed.source,
                    status_id=default_stage_id,
                    manager_id=row_manager_id,
                ),
            ),
        )

    created = 0
    batch_size = 500

    for start in range(0, len(work), batch_size):
        batch = work[start : start + batch_size]
        try:
            for _row_idx, lead in batch:
                db.add(lead)
            await db.flush()
            for _row_idx, lead in batch:
                await _audit_lead(
                    db,
                    lead_id=lead.id,
                    action="lead_imported",
                    current_user=current_user,
                    details="Импорт из CSV",
                )
            await db.commit()
            created += len(batch)
        except Exception:
            await db.rollback()
            for row_idx, lead in batch:
                try:
                    l2 = Lead(
                        company_id=company_id,
                        name=lead.name,
                        phone=lead.phone,
                        email=lead.email,
                        source=lead.source,
                        status_id=default_stage_id,
                        manager_id=lead.manager_id,
                    )
                    db.add(l2)
                    await db.flush()
                    await _audit_lead(
                        db,
                        lead_id=l2.id,
                        action="lead_imported",
                        current_user=current_user,
                        details="Импорт из CSV",
                    )
                    await db.commit()
                    created += 1
                except Exception as e2:
                    await db.rollback()
                    errors.append(LeadImportErrorItem(row=row_idx, message=str(e2)[:240]))

    return LeadImportResponse(created=created, errors=errors)


class LeadRedistributionSource(BaseModel):
    manager_id: int
    manager_name: str
    lead_count: int
    is_active: bool


class LeadRedistributionPreview(BaseModel):
    from_manager_id: int
    from_manager_name: str
    lead_count: int


class LeadRedistributeBody(BaseModel):
    from_manager_id: int = Field(..., ge=1)
    to_manager_ids: list[int] = Field(..., min_length=1)


class LeadRedistributeResult(BaseModel):
    total: int
    reassigned: int
    per_manager: dict[int, int]


async def _load_redistribution_manager(
    db: AsyncSession,
    *,
    manager_id: int,
    company_id: int,
    require_active: bool,
) -> User:
    user = await db.get(User, manager_id)
    if user is None or user.company_id != company_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Менеджер не найден")
    if require_active and not user.is_active:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Менеджер уволен — его можно указать только как источник лидов, не как получателя",
        )
    if not _is_redistribution_manager_role(user.role):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Перераспределение доступно только для ролей менеджер и админ воронки",
        )
    return user


@router.get("/redistribution/sources", response_model=list[LeadRedistributionSource])
async def lead_redistribution_sources(
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentUser,
    company_id: CurrentCompanyId,
) -> list[LeadRedistributionSource]:
    """Менеджеры/админы с числом лидов (в т.ч. уволенные, если лиды ещё на них)."""
    if not _is_lead_redistribution_admin(current_user.role):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Только владелец или админ воронки")

    lead_counts: dict[int, int] = {}
    rows = await db.execute(
        select(Lead.manager_id, func.count(Lead.id))
        .where(Lead.company_id == company_id, Lead.manager_id.is_not(None))
        .group_by(Lead.manager_id),
    )
    for mid, cnt in rows.all():
        if mid is not None:
            lead_counts[int(mid)] = int(cnt or 0)

    users = (
        await db.execute(
            select(User).where(
                User.company_id == company_id,
                User.role.in_([UserRole.manager, UserRole.admin]),
            ),
        )
    ).scalars().all()

    out: list[LeadRedistributionSource] = []
    for user in users:
        cnt = lead_counts.get(user.id, 0)
        if not user.is_active and cnt <= 0:
            continue
        out.append(
            LeadRedistributionSource(
                manager_id=user.id,
                manager_name=_user_display_name(user),
                lead_count=cnt,
                is_active=bool(user.is_active),
            ),
        )
    out.sort(key=lambda x: (-x.lead_count, x.manager_name.lower()))
    return out


@router.get("/redistribution/preview", response_model=LeadRedistributionPreview)
async def lead_redistribution_preview(
    from_manager_id: int,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentUser,
    company_id: CurrentCompanyId,
) -> LeadRedistributionPreview:
    if not _is_lead_redistribution_admin(current_user.role):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Только владелец или админ воронки")
    src = await _load_redistribution_manager(
        db,
        manager_id=from_manager_id,
        company_id=company_id,
        require_active=False,
    )
    cnt = int(
        await db.scalar(
            select(func.count(Lead.id)).where(
                Lead.company_id == company_id,
                Lead.manager_id == from_manager_id,
            ),
        )
        or 0,
    )
    return LeadRedistributionPreview(
        from_manager_id=from_manager_id,
        from_manager_name=_user_display_name(src),
        lead_count=cnt,
    )


@router.post("/redistribute", response_model=LeadRedistributeResult)
async def redistribute_manager_leads(
    body: LeadRedistributeBody,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentUser,
    company_id: CurrentCompanyId,
) -> LeadRedistributeResult:
    """Перенести все лиды менеджера к другим менеджерам (равномерно, round-robin)."""
    if not _is_lead_redistribution_admin(current_user.role):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Только владелец или админ воронки")

    from_id = int(body.from_manager_id)
    to_ids_raw = sorted({int(x) for x in body.to_manager_ids if int(x) != from_id})
    if not to_ids_raw:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Укажите хотя бы одного другого менеджера для приёма лидов",
        )

    src = await _load_redistribution_manager(
        db,
        manager_id=from_id,
        company_id=company_id,
        require_active=False,
    )
    src_name = _user_display_name(src)

    targets: list[User] = []
    for tid in to_ids_raw:
        u = await _load_redistribution_manager(
            db,
            manager_id=tid,
            company_id=company_id,
            require_active=True,
        )
        targets.append(u)
    target_ids = [u.id for u in targets]

    lead_ids: list[int] = []
    offset = 0
    while True:
        chunk = (
            await db.execute(
                select(Lead.id)
                .where(Lead.company_id == company_id, Lead.manager_id == from_id)
                .order_by(Lead.id.asc())
                .offset(offset)
                .limit(_MAX_REDISTRIBUTE_BATCH),
            )
        ).scalars().all()
        if not chunk:
            break
        lead_ids.extend(int(x) for x in chunk)
        offset += len(chunk)
        if len(chunk) < _MAX_REDISTRIBUTE_BATCH:
            break

    total = len(lead_ids)
    if total == 0:
        return LeadRedistributeResult(total=0, reassigned=0, per_manager={})

    per_manager: dict[int, int] = {tid: 0 for tid in target_ids}
    n_targets = len(target_ids)
    lead_to_manager: dict[int, int] = {}

    for i, lead_id in enumerate(lead_ids):
        new_mid = target_ids[i % n_targets]
        lead_to_manager[lead_id] = new_mid
        per_manager[new_mid] = per_manager.get(new_mid, 0) + 1

    for lead_id, new_mid in lead_to_manager.items():
        lead = await db.get(Lead, lead_id)
        if lead is None:
            continue
        lead.manager_id = new_mid
        await _audit_lead(
            db,
            lead_id=lead_id,
            action="manager_reassigned",
            current_user=current_user,
            details=f"from_manager_id={from_id} ({src_name}), to_manager_id={new_mid}",
        )

    for lead_id, new_mid in lead_to_manager.items():
        appts = (
            await db.execute(
                select(BookingAppointment).where(
                    BookingAppointment.company_id == company_id,
                    BookingAppointment.lead_id == lead_id,
                    BookingAppointment.responsible_manager_id == from_id,
                ),
            )
        ).scalars().all()
        for appt in appts:
            appt.responsible_manager_id = new_mid

        await db.execute(
            update(Task)
            .where(
                Task.company_id == company_id,
                Task.related_lead_id == lead_id,
                Task.assigned_to == from_id,
                Task.status.in_([TaskStatus.pending, TaskStatus.in_progress]),
            )
            .values(assigned_to=new_mid),
        )

    await db.flush()

    for tid, cnt in per_manager.items():
        if cnt <= 0:
            continue
        await _notify_users(
            db,
            company_id=company_id,
            user_ids=[tid],
            title=f"Вам переданы лиды от {src_name}",
            description=(
                f"Передано лидов: {cnt}. Ранее ответственным был {src_name} — теперь вы отвечаете "
                f"за этих клиентов (входящие сообщения в чате и карточки в CRM)."
            ),
        )

    await write_audit_event(
        db,
        entity_type="lead",
        entity_id=from_id,
        action="leads_redistributed",
        current_user=current_user,
        details=f"from={from_id}, targets={target_ids}, total={total}, per_manager={per_manager}",
    )

    return LeadRedistributeResult(total=total, reassigned=total, per_manager=per_manager)


@router.get("/{lead_id}", response_model=LeadRead)
async def get_lead(
    lead_id: int,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentUser,
    company_id: CurrentCompanyId,
) -> LeadRead:
    lead = await db.get(Lead, lead_id)
    if lead is None or lead.company_id != company_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Lead not found")
    await db.refresh(lead, ["stage"])
    await _assert_expert_lead_access(db, current_user=current_user, lead=lead, company_id=company_id)
    if is_manager_like(current_user.role):
        allowed = await _manager_pipeline_ids(db, current_user.id)
        if (lead.stage.pipeline_id if lead.stage else None) not in allowed:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Lead is outside manager directions")
        if lead.manager_id is not None and lead.manager_id != current_user.id:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Lead is assigned to another manager")
    await _audit_lead(
        db,
        lead_id=lead.id,
        action="card_opened",
        current_user=current_user,
        details="Открыта карточка лида",
    )
    deals_info_rows = await db.execute(
        select(
            func.min(case((Deal.is_protocol.is_(True), Deal.id))).label("protocol_deal_id"),
            func.max(
                case(
                    (
                        and_(Deal.is_protocol.is_(True), Deal.protocol_requested.is_(True)),
                        1,
                    ),
                    else_=0,
                ),
            ).label("protocol_requested"),
            func.max(
                case(
                    (
                        and_(Deal.is_protocol.is_(True), Deal.protocol_confirmed.is_(True)),
                        1,
                    ),
                    else_=0,
                ),
            ).label("protocol_confirmed"),
            func.max(
                case(
                    (
                        and_(Deal.is_protocol.is_(True), Deal.protocol_file_path.is_not(None)),
                        1,
                    ),
                    else_=0,
                ),
            ).label("protocol_file_attached"),
            func.coalesce(func.sum(Deal.paid_amount), 0).label("paid_extras_amount"),
        )
        .where(Deal.lead_id == lead_id)
        .group_by(Deal.lead_id),
    )
    row = deals_info_rows.first()
    info = None
    if row is not None:
        info = {
            "protocol_deal_id": row[0],
            "protocol_requested": row[1],
            "protocol_confirmed": row[2],
            "protocol_file_attached": row[3],
            "paid_extras_amount": row[4],
        }

    base = (await _lead_to_read_with_manager(db, lead, current_user)).model_copy(
        update={
            "protocol_deal_id": (info["protocol_deal_id"] if info else None) or None,
            "protocol_requested": bool(info["protocol_requested"]) if info else False,
            "protocol_confirmed": bool(info["protocol_confirmed"]) if info else False,
            "protocol_file_attached": bool(info["protocol_file_attached"]) if info else False,
            "paid_extras_amount": (info["paid_extras_amount"] if info else Decimal("0")),
        },
    )
    enriched = await _enrich_leads_close_deal(db, [lead], [base], current_user)
    return enriched[0]


@router.patch("/{lead_id}", response_model=LeadRead)
async def patch_lead(
    lead_id: int,
    body: LeadUpdate,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentUser,
    company_id: CurrentCompanyId,
) -> LeadRead:
    lead = await db.get(Lead, lead_id)
    if lead is None or lead.company_id != company_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Lead not found")
    await db.refresh(lead, ["stage"])
    await _assert_expert_lead_access(db, current_user=current_user, lead=lead, company_id=company_id)

    if current_user.role == UserRole.owner:
        pass
    elif current_user.role == UserRole.admin:
        pipeline_id = lead.stage.pipeline_id if lead.stage else None
        allowed = await _manager_pipeline_ids(db, current_user.id)
        if pipeline_id is None or pipeline_id not in allowed:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Lead is outside admin directions")
    else:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Редактирование карточки доступно только владельцу и админу назначенной воронки",
        )

    patch = body.model_dump(exclude_unset=True)
    if not patch:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Нет полей для обновления")

    if "name" in patch and body.name is not None:
        name = body.name.strip()
        if not name:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Имя не может быть пустым")
        lead.name = name
    if "phone" in patch:
        lead.phone = (body.phone or "").strip() or None
    if "email" in patch:
        lead.email = str(body.email).strip() if body.email else None
    if "source" in patch:
        lead.source = (body.source or "").strip() or None

    await db.flush()
    await _audit_lead(
        db,
        lead_id=lead.id,
        action="lead_profile_updated",
        current_user=current_user,
        details="Обновлены поля карточки клиента (ФИО/телефон/email/источник)",
    )
    await db.refresh(lead, ["stage"])
    base = await _lead_to_read_with_manager(db, lead, current_user)
    enriched = await _enrich_leads_close_deal(db, [lead], [base], current_user)
    return enriched[0]


@router.delete("/{lead_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_lead(
    lead_id: int,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentUser,
    company_id: CurrentCompanyId,
) -> Response:
    if current_user.role != UserRole.owner:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Удаление клиента доступно только владельцу")
    lead = await db.get(Lead, lead_id)
    if lead is None or lead.company_id != company_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Lead not found")

    # Полное удаление связанных сущностей по клиенту.
    deal_ids = list(
        (
            await db.execute(
                select(Deal.id).where(
                    Deal.company_id == company_id,
                    Deal.lead_id == lead_id,
                )
            )
        ).scalars()
    )
    await db.execute(
        delete(FinanceJournalEntry).where(
            FinanceJournalEntry.company_id == company_id,
            or_(
                FinanceJournalEntry.related_lead_id == lead_id,
                FinanceJournalEntry.related_deal_id.in_(deal_ids) if deal_ids else false(),
            ),
        )
    )
    await db.execute(
        delete(BookingAppointment).where(
            BookingAppointment.company_id == company_id,
            BookingAppointment.lead_id == lead_id,
        )
    )
    await db.execute(
        delete(ChatThread).where(
            ChatThread.company_id == company_id,
            ChatThread.lead_id == lead_id,
        )
    )
    await db.execute(
        delete(Task).where(
            Task.company_id == company_id,
            Task.related_lead_id == lead_id,
        )
    )
    await db.execute(
        delete(Deal).where(
            Deal.company_id == company_id,
            Deal.lead_id == lead_id,
        )
    )
    await db.execute(
        delete(LeadAuditEvent).where(
            LeadAuditEvent.company_id == company_id,
            LeadAuditEvent.lead_id == lead_id,
        )
    )
    await db.delete(lead)
    try:
        await db.flush()
    except IntegrityError:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Нельзя удалить клиента: часть связанных данных не удалось удалить.",
        )
    return Response(status_code=status.HTTP_204_NO_CONTENT)


class CloseDealBody(BaseModel):
    amount: Decimal | None = Field(default=None, ge=0)
    paid_amount: Decimal = Field(..., ge=0)


@router.post("/{lead_id}/close-deal", response_model=LeadRead)
async def close_deal_from_integration_pipeline(
    lead_id: int,
    body: CloseDealBody,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentUser,
    company_id: CurrentCompanyId,
) -> LeadRead:
    if current_user.role not in (UserRole.owner, UserRole.manager, UserRole.admin):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Только владелец, админ воронки или менеджер")

    lead = await db.get(Lead, lead_id)
    if lead is None or lead.company_id != company_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Lead not found")
    await db.refresh(lead, ["stage"])
    pipeline_id = lead.stage.pipeline_id if lead.stage else None

    if not await _pipeline_has_manager_close_deal(db, pipeline_id):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Для этой воронки не включена кнопка закрытия сделки в настройках интеграции",
        )

    dup = await db.scalar(
        select(Deal.id).where(
            Deal.lead_id == lead_id,
            Deal.deal_type == INTEGRATION_CLOSE_DEAL_TYPE,
        ).limit(1),
    )
    if dup is not None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Сделка по этому лиду уже закрыта (есть запись закрытия)",
        )

    if is_manager_like(current_user.role):
        allowed = await _manager_pipeline_ids(db, current_user.id)
        if pipeline_id not in allowed:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Lead is outside manager directions")
        if lead.manager_id is not None and lead.manager_id != current_user.id:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Lead is assigned to another manager")

    success_stage_id = await _stage_id_by_name(
        db,
        settings.booking_stage_completed,
        pipeline_id=pipeline_id,
    )
    if success_stage_id is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"В воронке нет стадии «{settings.booking_stage_completed}» для успешного закрытия",
        )

    last_appt = (
        await db.execute(
            select(BookingAppointment)
            .where(
                BookingAppointment.company_id == company_id,
                BookingAppointment.lead_id == lead_id,
            )
            .order_by(BookingAppointment.start_at.desc(), BookingAppointment.id.desc())
            .limit(1),
        )
    ).scalars().first()

    final_amount = body.amount
    if pipeline_id is not None and last_appt is not None and last_appt.direction_id is not None:
        start_dt = last_appt.start_at if last_appt.start_at.tzinfo else last_appt.start_at.replace(tzinfo=UTC)
        fixed_price = await get_kpi_service_price(
            db,
            company_id=company_id,
            pipeline_id=int(pipeline_id),
            direction_id=int(last_appt.direction_id),
            at_datetime=start_dt,
        )
        if fixed_price is not None:
            final_amount = fixed_price

    if final_amount is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Для этой услуги не задана цена KPI: укажите стоимость сделки",
        )
    if body.paid_amount > final_amount:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Оплата не может быть больше стоимости услуги")

    deal = Deal(
        company_id=company_id,
        title="Закрытая сделка",
        deal_type=INTEGRATION_CLOSE_DEAL_TYPE,
        amount=final_amount,
        paid_amount=body.paid_amount,
        is_protocol=False,
        protocol_requested=False,
        protocol_confirmed=False,
        protocol_file_path=None,
        stage_id=success_stage_id,
        lead_id=lead.id,
        probability=100,
    )
    db.add(deal)
    lead.status_id = success_stage_id
    await db.flush()
    await sync_deal_payment_revenue(
        db,
        company_id=company_id,
        lead_id=lead.id,
        deal_id=deal.id,
        target_paid_amount=body.paid_amount,
        user_id=current_user.id,
    )
    await _audit_lead(
        db,
        lead_id=lead.id,
        action="integration_deal_closed",
        current_user=current_user,
        details=f"Сумма={final_amount}, оплачено={body.paid_amount}",
    )
    await db.refresh(lead, ["stage"])
    await process_lead_automation(db, lead_id, success_stage_id)

    deals_info_rows = await db.execute(
        select(
            func.min(case((Deal.is_protocol.is_(True), Deal.id))).label("protocol_deal_id"),
            func.max(
                case(
                    (
                        and_(Deal.is_protocol.is_(True), Deal.protocol_requested.is_(True)),
                        1,
                    ),
                    else_=0,
                ),
            ).label("protocol_requested"),
            func.max(
                case(
                    (
                        and_(Deal.is_protocol.is_(True), Deal.protocol_confirmed.is_(True)),
                        1,
                    ),
                    else_=0,
                ),
            ).label("protocol_confirmed"),
            func.max(
                case(
                    (
                        and_(Deal.is_protocol.is_(True), Deal.protocol_file_path.is_not(None)),
                        1,
                    ),
                    else_=0,
                ),
            ).label("protocol_file_attached"),
            func.coalesce(func.sum(Deal.paid_amount), 0).label("paid_extras_amount"),
        )
        .where(Deal.lead_id == lead_id)
        .group_by(Deal.lead_id),
    )
    row = deals_info_rows.first()
    info = None
    if row is not None:
        info = {
            "protocol_deal_id": row[0],
            "protocol_requested": row[1],
            "protocol_confirmed": row[2],
            "protocol_file_attached": row[3],
            "paid_extras_amount": row[4],
        }
    base = (await _lead_to_read_with_manager(db, lead, current_user)).model_copy(
        update={
            "protocol_deal_id": (info["protocol_deal_id"] if info else None) or None,
            "protocol_requested": bool(info["protocol_requested"]) if info else False,
            "protocol_confirmed": bool(info["protocol_confirmed"]) if info else False,
            "protocol_file_attached": bool(info["protocol_file_attached"]) if info else False,
            "paid_extras_amount": (info["paid_extras_amount"] if info else Decimal("0")),
        },
    )
    enriched = await _enrich_leads_close_deal(db, [lead], [base], current_user)
    return enriched[0]


class LeadRejectBody(BaseModel):
    reason: str | None = Field(default=None, max_length=2000)


@router.post("/{lead_id}/reject", response_model=LeadRead)
async def reject_lead(
    lead_id: int,
    body: LeadRejectBody,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentUser,
    company_id: CurrentCompanyId,
) -> LeadRead:
    if current_user.role not in (UserRole.owner, UserRole.manager, UserRole.admin):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Только владелец, админ воронки или менеджер")

    lead = await db.get(Lead, lead_id)
    if lead is None or lead.company_id != company_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Lead not found")
    await db.refresh(lead, ["stage"])
    pipeline_id = lead.stage.pipeline_id if lead.stage else None
    if pipeline_id is None:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Лид не привязан к воронке")

    if is_manager_like(current_user.role):
        allowed = await _manager_pipeline_ids(db, current_user.id)
        if pipeline_id not in allowed:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Lead is outside manager directions")
        if lead.manager_id is not None and lead.manager_id != current_user.id:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Lead is assigned to another manager")

    reject_stage_id, created_new_stage = await _ensure_stage_by_name(
        db,
        name="Неуспешно",
        pipeline_id=pipeline_id,
        color="#ef4444",
    )
    lead.status_id = reject_stage_id
    reason = (body.reason or "").strip()
    lead.refusal_reason = reason or "Отказ"
    await db.flush()
    await _audit_lead(
        db,
        lead_id=lead.id,
        action="lead_rejected",
        current_user=current_user,
        details=(
            f"Лид переведён в «Неуспешно», reason={lead.refusal_reason}, "
            f"stage_created={created_new_stage}"
        ),
    )
    await db.refresh(lead, ["stage"])
    return await _lead_to_read_with_manager(db, lead, current_user)


@router.patch("/{lead_id}/status", response_model=LeadStatusPatchResponse)
async def update_lead_status(
    lead_id: int,
    body: LeadStatusUpdate,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentUser,
    company_id: CurrentCompanyId,
) -> LeadStatusPatchResponse:
    stage = await db.get(PipelineStage, body.status_id)
    if stage is None or stage.company_id != company_id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Unknown status_id")
    lead = await db.get(Lead, lead_id)
    if lead is None or lead.company_id != company_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Lead not found")
    await _assert_expert_lead_access(db, current_user=current_user, lead=lead, company_id=company_id)

    from_stage = await db.get(PipelineStage, lead.status_id)
    if from_stage is None:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Current stage not found")
    if is_manager_like(current_user.role):
        allowed = await _manager_pipeline_ids(db, current_user.id)
        if from_stage.pipeline_id not in allowed:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Lead is outside manager directions")

    if stage.pipeline_id != from_stage.pipeline_id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Переход между воронками недоступен",
        )

    # MVP-валидация для переходов через drag-and-drop/ручное изменение статуса.
    # Остальные действия (неявка/отказ/корзина/протокол) будут вынесены в отдельные endpoint'ы.
    allowed = False
    if (
        current_user.role == UserRole.owner
        and from_stage.name == "Запись"
        and stage.name == "У эксперта"
    ):
        allowed = True
    elif (
        current_user.role == UserRole.expert
        and from_stage.name == "У эксперта"
        and stage.name == "Доп. услуги"
    ):
        allowed = True

    if not allowed:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Недопустимый переход статуса для текущей роли",
        )

    lead.status_id = body.status_id
    await db.flush()
    await _audit_lead(
        db,
        lead_id=lead.id,
        action="status_changed",
        current_user=current_user,
        details=f"Смена стадии: {from_stage.name} -> {stage.name}",
    )
    await db.refresh(lead, ["stage"])
    read = await _lead_to_read_with_manager(db, lead, current_user)
    automation_task_created = await process_lead_automation(db, lead_id, body.status_id)
    return LeadStatusPatchResponse(
        **read.model_dump(),
        automation_task_created=automation_task_created,
    )


class ArrivalNoShowBody(BaseModel):
    action: Literal["reschedule", "refuse"]
    reason: str | None = Field(None, max_length=2000)
    new_start_at: datetime | None = None


class ServiceRejectBody(BaseModel):
    reason: str = Field(..., min_length=1, max_length=2000)


@router.post("/{lead_id}/arrival", response_model=LeadRead)
async def lead_arrival(
    lead_id: int,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentUser,
    company_id: CurrentCompanyId,
) -> LeadRead:
    if current_user.role != UserRole.owner:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Только владелец")

    lead = await db.get(Lead, lead_id)
    if lead is None or lead.company_id != company_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Lead not found")
    await _assert_expert_lead_access(db, current_user=current_user, lead=lead, company_id=company_id)
    await db.refresh(lead, ["stage"])

    if lead.stage is None or lead.stage.name != "Запись":
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Lead is not in stage 'Запись'")

    to_stage_id = await _stage_id_by_name(
        db,
        "У эксперта",
        pipeline_id=lead.stage.pipeline_id if lead.stage else None,
    )
    if to_stage_id is None:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Stage 'У эксперта' not found")

    lead.status_id = to_stage_id
    lead.refusal_reason = None
    await db.flush()
    await _audit_lead(
        db,
        lead_id=lead.id,
        action="arrival_marked",
        current_user=current_user,
        details="Отмечена явка клиента",
    )
    await db.refresh(lead, ["stage"])

    await _notify_by_roles(
        db,
        company_id=company_id,
        lead_id=lead.id,
        title="Появилась запись (явка) — перейдите в карточку",
        assigned_roles=[UserRole.expert],
    )

    return await _lead_to_read_with_manager(db, lead, current_user)


@router.post("/{lead_id}/no-show", response_model=LeadRead)
async def lead_no_show(
    lead_id: int,
    body: ArrivalNoShowBody,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentUser,
    company_id: CurrentCompanyId,
) -> LeadRead:
    if current_user.role != UserRole.owner:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Только владелец")

    lead = await db.get(Lead, lead_id)
    if lead is None or lead.company_id != company_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Lead not found")
    await _assert_expert_lead_access(db, current_user=current_user, lead=lead, company_id=company_id)
    await db.refresh(lead, ["stage"])

    if lead.stage is None or lead.stage.name != "Запись":
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Lead is not in stage 'Запись'")

    # MVP: если есть оплаченная часть (paid_amount > 0), то владелец подтверждает ветвление
    paid_any = await db.scalar(select(Deal.id).where(Deal.lead_id == lead_id, Deal.paid_amount > 0).limit(1))
    if not paid_any and body.action != "reschedule":
        # если оплат нет — «отказано» без причины не делаем
        if body.action == "refuse":
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Для отказа укажите reason и оплату/подтверждение")

    if body.action == "reschedule":
        to_stage_id = await _stage_id_by_name(
            db,
            "Квалифицирован",
            pipeline_id=lead.stage.pipeline_id if lead.stage else None,
        )
        if to_stage_id is None:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Stage 'Квалифицирован' not found")
        lead.status_id = to_stage_id
        lead.refusal_reason = None
    else:
        if not body.reason or not body.reason.strip():
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Reason обязателен")
        to_stage_id = await _stage_id_by_name(
            db,
            "Потерян",
            pipeline_id=lead.stage.pipeline_id if lead.stage else None,
        )
        if to_stage_id is None:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Stage 'Потерян' not found")
        lead.status_id = to_stage_id
        lead.refusal_reason = body.reason.strip()

    await db.flush()
    await _audit_lead(
        db,
        lead_id=lead.id,
        action="no_show_processed",
        current_user=current_user,
        details=f"Неявка обработана: action={body.action}, reason={(body.reason or '').strip() or '-'}",
    )
    await db.refresh(lead, ["stage"])
    return await _lead_to_read_with_manager(db, lead, current_user)


@router.post("/{lead_id}/service-done", response_model=LeadRead)
async def lead_service_done(
    lead_id: int,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentUser,
    company_id: CurrentCompanyId,
) -> LeadRead:
    if current_user.role != UserRole.expert:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Expert only")

    lead = await db.get(Lead, lead_id)
    if lead is None or lead.company_id != company_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Lead not found")
    await _assert_expert_lead_access(db, current_user=current_user, lead=lead, company_id=company_id)
    await db.refresh(lead, ["stage"])

    if lead.stage is None or lead.stage.name not in {"У эксперта", "Оказание услуги"}:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Lead is not in expert stage",
        )

    to_stage_id = await _stage_id_by_name(
        db,
        "Доп. услуги",
        pipeline_id=lead.stage.pipeline_id if lead.stage else None,
    )
    if to_stage_id is None:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Stage 'Доп. услуги' not found")

    lead.status_id = to_stage_id
    await db.flush()
    await _audit_lead(
        db,
        lead_id=lead.id,
        action="service_done",
        current_user=current_user,
        details="Услуга оказана, перевод на стадию доп. услуг",
    )
    await db.refresh(lead, ["stage"])

    await _notify_by_roles(
        db,
        company_id=company_id,
        lead_id=lead.id,
        title="Нужны доп. услуги по записи — откройте карточку",
        assigned_roles=[UserRole.manager, UserRole.admin],
    )

    return await _lead_to_read_with_manager(db, lead, current_user)


@router.post("/{lead_id}/service-reject", response_model=LeadRead)
async def lead_service_reject(
    lead_id: int,
    body: ServiceRejectBody,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentUser,
    company_id: CurrentCompanyId,
) -> LeadRead:
    if current_user.role != UserRole.expert:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Expert only")

    lead = await db.get(Lead, lead_id)
    if lead is None or lead.company_id != company_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Lead not found")
    await db.refresh(lead, ["stage"])

    if lead.stage is None or lead.stage.name not in {"У эксперта", "Оказание услуги"}:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Lead is not in expert stage",
        )

    to_stage_id = await _stage_id_by_name(
        db,
        "Потерян",
        pipeline_id=lead.stage.pipeline_id if lead.stage else None,
    )
    if to_stage_id is None:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Stage 'Потерян' not found")

    lead.status_id = to_stage_id
    lead.refusal_reason = body.reason.strip()
    await db.flush()
    await _audit_lead(
        db,
        lead_id=lead.id,
        action="service_rejected",
        current_user=current_user,
        details=f"Отказ в услуге: {body.reason.strip()}",
    )
    await db.refresh(lead, ["stage"])
    return await _lead_to_read_with_manager(db, lead, current_user)


@router.post("/{lead_id}/cart/extra-services/add", response_model=DealRead)
async def add_extra_service_to_cart(
    lead_id: int,
    body: ExtraServiceAddBody,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentUser,
    company_id: CurrentCompanyId,
) -> DealRead:
    if not is_manager_like(current_user.role):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Только менеджер или админ воронки")

    lead = await db.get(Lead, lead_id)
    if lead is None or lead.company_id != company_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Lead not found")
    await db.refresh(lead, ["stage"])
    allowed = await _manager_pipeline_ids(db, current_user.id)
    if (lead.stage.pipeline_id if lead.stage else None) not in allowed:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Lead is outside manager directions")

    if lead.stage is None or lead.stage.name != "Доп. услуги":
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Lead is not in stage 'Доп. услуги'")

    # Для валидного stage_id у Deal (по схеме) берём стадию «Доп. услуги».
    deal_stage_id = await _stage_id_by_name(
        db,
        "Доп. услуги",
        pipeline_id=lead.stage.pipeline_id if lead.stage else None,
    )
    if deal_stage_id is None:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Stage 'Доп. услуги' not found")

    is_protocol = body.type.strip().lower() == "протокол"
    deal = Deal(
        company_id=company_id,
        title=body.type.strip(),
        deal_type=body.type.strip(),
        amount=body.amount,
        paid_amount=body.paid_amount,
        is_protocol=is_protocol,
        protocol_requested=is_protocol,
        protocol_confirmed=False,
        stage_id=deal_stage_id,
        lead_id=lead.id,
        probability=0,
    )
    db.add(deal)
    await db.flush()
    await _audit_lead(
        db,
        lead_id=lead.id,
        action="extra_service_added",
        current_user=current_user,
        details=f"Добавлена доп. услуга: {body.type.strip()}, сумма={body.amount}, оплачено={body.paid_amount}",
    )
    await db.refresh(deal)

    if body.paid_amount and Decimal(str(body.paid_amount)) > 0:
        await sync_deal_payment_revenue(
            db,
            company_id=company_id,
            lead_id=lead.id,
            deal_id=deal.id,
            target_paid_amount=Decimal(str(body.paid_amount)),
            user_id=current_user.id,
        )

    if is_protocol:
        await _notify_by_roles(
            db,
            company_id=company_id,
            lead_id=lead.id,
            title="Запрос по протоколу: вы написали протокол?",
            assigned_roles=[UserRole.expert],
            description=f"deal_id={deal.id}",
        )

    return DealRead.model_validate(deal)


@router.post("/{lead_id}/protocol/finish", response_model=LeadRead)
async def protocol_finish(
    lead_id: int,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentUser,
    company_id: CurrentCompanyId,
) -> LeadRead:
    if current_user.role != UserRole.expert:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Expert only")

    lead = await db.get(Lead, lead_id)
    if lead is None or lead.company_id != company_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Lead not found")
    await db.refresh(lead, ["stage"])

    # Проверяем, что по лиду есть протокол с загруженным файлом
    ok = await db.scalar(
        select(Deal.id).where(
            Deal.lead_id == lead_id,
            Deal.is_protocol.is_(True),
            Deal.protocol_file_path.is_not(None),
        ).limit(1)
    )
    if ok is None:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Протокол ещё не прикреплён")

    to_stage_id = await _stage_id_by_name(
        db,
        "Успешно реализован",
        pipeline_id=lead.stage.pipeline_id if lead.stage else None,
    )
    if to_stage_id is None:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Stage 'Успешно реализован' not found")

    lead.status_id = to_stage_id
    lead.refusal_reason = None
    await db.flush()
    await _audit_lead(
        db,
        lead_id=lead.id,
        action="protocol_finished",
        current_user=current_user,
        details="Протокол завершен, сделка закрыта успешно",
    )
    await db.refresh(lead, ["stage"])

    await _notify_by_roles(
        db,
        company_id=company_id,
        lead_id=lead.id,
        title="Сделка завершена — проверьте этап в канбане",
        assigned_roles=[UserRole.manager, UserRole.admin, UserRole.owner],
    )

    return await _lead_to_read_with_manager(db, lead, current_user)


@router.get("/{lead_id}/audit", response_model=list[LeadAuditRead])
async def list_lead_audit(
    lead_id: int,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentUser,
    company_id: CurrentCompanyId,
) -> list[LeadAuditRead]:
    lead = await db.get(Lead, lead_id)
    if lead is None or lead.company_id != company_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Lead not found")
    await db.refresh(lead, ["stage"])
    await _assert_expert_lead_access(db, current_user=current_user, lead=lead, company_id=company_id)
    if is_manager_like(current_user.role):
        allowed = await _manager_pipeline_ids(db, current_user.id)
        if (lead.stage.pipeline_id if lead.stage else None) not in allowed:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Lead is outside manager directions")
        if lead.manager_id is not None and lead.manager_id != current_user.id:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Lead is assigned to another manager")

    rows = (
        await db.execute(
            select(LeadAuditEvent, User)
            .outerjoin(User, User.id == LeadAuditEvent.user_id)
            .where(LeadAuditEvent.lead_id == lead_id)
            .where(LeadAuditEvent.company_id == company_id)
            .order_by(LeadAuditEvent.created_at.desc(), LeadAuditEvent.id.desc())
            .limit(200),
        )
    ).all()
    return [
        LeadAuditRead(
            id=evt.id,
            lead_id=evt.lead_id,
            action=evt.action,
            details=evt.details,
            user_id=evt.user_id,
            user_name=((usr.full_name or "").strip() or usr.email) if usr else None,
            created_at=evt.created_at,
        )
        for evt, usr in rows
    ]
