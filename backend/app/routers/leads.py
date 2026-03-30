from datetime import UTC, datetime
from decimal import Decimal
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy import and_, case, func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.deps import CurrentUser
from app.database import get_db
from app.models import Deal, Lead, PipelineStage, Task, TaskStatus, User, UserPipelineAssignment, UserRole
from app.schemas.lead import LeadCreate, LeadRead, LeadStatusPatchResponse, LeadStatusUpdate
from app.services.automation import process_lead_automation
from app.schemas.deal import DealRead, ExtraServiceAddBody, ProtocolConfirmBody
from app.schemas.deal import ProtocolFinishBody

router = APIRouter(prefix="/leads", tags=["leads"])


async def _stage_id_by_name(db: AsyncSession, name: str, pipeline_id: int | None = None) -> int | None:
    q = select(PipelineStage.id).where(PipelineStage.name == name)
    if pipeline_id is not None:
        q = q.where(PipelineStage.pipeline_id == pipeline_id)
    r = await db.execute(q)
    return r.scalar_one_or_none()


async def _manager_pipeline_ids(db: AsyncSession, user_id: int) -> set[int]:
    rows = await db.execute(
        select(UserPipelineAssignment.pipeline_id).where(UserPipelineAssignment.user_id == user_id),
    )
    return {r[0] for r in rows.all()}


async def _notify_by_roles(
    db: AsyncSession,
    *,
    lead_id: int,
    title: str,
    assigned_roles: list[UserRole],
    description: str | None = None,
) -> None:
    if not assigned_roles:
        return
    result = await db.execute(select(User.id).where(User.role.in_(assigned_roles)))
    user_ids = [row[0] for row in result.all()]
    if not user_ids:
        return
    now = datetime.now(UTC)
    for uid in user_ids:
        db.add(
            Task(
                title=title,
                deadline=None,
                status=TaskStatus.pending,
                assigned_to=uid,
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
        email=lead.email,
        source=lead.source,
        status_id=lead.status_id,
        stage_name=lead.stage.name if lead.stage else None,
        manager_id=lead.manager_id,
        refusal_reason=lead.refusal_reason,
        pipeline_id=lead.stage.pipeline_id if lead.stage else None,
    )


@router.post("", response_model=LeadRead, status_code=status.HTTP_201_CREATED)
async def create_lead(
    body: LeadCreate,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentUser,
) -> LeadRead:
    stage = await db.get(PipelineStage, body.status_id)
    if stage is None:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Unknown status_id")
    if current_user.role == UserRole.manager:
        allowed = await _manager_pipeline_ids(db, current_user.id)
        if stage.pipeline_id not in allowed:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Stage is outside manager directions")
    lead = Lead(
        name=body.name,
        phone=body.phone,
        email=body.email,
        source=body.source,
        status_id=body.status_id,
        manager_id=current_user.id,
    )
    db.add(lead)
    await db.flush()
    await db.refresh(lead)
    await db.refresh(lead, ["stage"])
    return _lead_to_read(lead)


@router.get("", response_model=list[LeadRead])
async def list_leads(
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentUser,
) -> list[LeadRead]:
    q = select(Lead).options(selectinload(Lead.stage)).order_by(Lead.id.desc())
    if current_user.role == UserRole.manager:
        allowed = await _manager_pipeline_ids(db, current_user.id)
        if not allowed:
            return []
        q = q.join(PipelineStage, PipelineStage.id == Lead.status_id).where(
            PipelineStage.pipeline_id.in_(allowed),
            Lead.manager_id == current_user.id,
        )
    result = await db.execute(q)
    leads = result.scalars().unique().all()
    if not leads:
        return []

    lead_ids = [l.id for l in leads]
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
        .where(Deal.lead_id.in_(lead_ids))
        .group_by(Deal.lead_id)
    )
    rows = deal_info_rows.all()
    deal_info: dict[int, dict[str, object]] = {}
    for r in rows:
        lead_id = r[0]
        deal_info[lead_id] = {
            "protocol_deal_id": r[1],
            "protocol_requested": r[2],
            "protocol_confirmed": r[3],
            "protocol_file_attached": r[4],
            "paid_extras_amount": r[5],
        }

    out: list[LeadRead] = []
    for lead in leads:
        info = deal_info.get(lead.id)
        base = _lead_to_read(lead)
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
    return out


@router.get("/{lead_id}", response_model=LeadRead)
async def get_lead(
    lead_id: int,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentUser,
) -> LeadRead:
    lead = await db.get(Lead, lead_id)
    if lead is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Lead not found")
    await db.refresh(lead, ["stage"])
    if current_user.role == UserRole.manager:
        allowed = await _manager_pipeline_ids(db, current_user.id)
        if (lead.stage.pipeline_id if lead.stage else None) not in allowed:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Lead is outside manager directions")
        if lead.manager_id is not None and lead.manager_id != current_user.id:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Lead is assigned to another manager")
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

    return _lead_to_read(lead).model_copy(
        update={
            "protocol_deal_id": (info["protocol_deal_id"] if info else None) or None,
            "protocol_requested": bool(info["protocol_requested"]) if info else False,
            "protocol_confirmed": bool(info["protocol_confirmed"]) if info else False,
            "protocol_file_attached": bool(info["protocol_file_attached"]) if info else False,
            "paid_extras_amount": (info["paid_extras_amount"] if info else Decimal("0")),
        },
    )


@router.patch("/{lead_id}/status", response_model=LeadStatusPatchResponse)
async def update_lead_status(
    lead_id: int,
    body: LeadStatusUpdate,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentUser,
) -> LeadStatusPatchResponse:
    stage = await db.get(PipelineStage, body.status_id)
    if stage is None:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Unknown status_id")
    lead = await db.get(Lead, lead_id)
    if lead is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Lead not found")

    from_stage = await db.get(PipelineStage, lead.status_id)
    if from_stage is None:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Current stage not found")
    if current_user.role == UserRole.manager:
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
        current_user.role == UserRole.admin
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
    await db.refresh(lead, ["stage"])
    read = _lead_to_read(lead)
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
) -> LeadRead:
    if current_user.role != UserRole.admin:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Admin only")

    lead = await db.get(Lead, lead_id)
    if lead is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Lead not found")
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
    await db.refresh(lead, ["stage"])

    await _notify_by_roles(
        db,
        lead_id=lead.id,
        title="Появилась запись (явка) — перейдите в карточку",
        assigned_roles=[UserRole.expert],
    )

    return _lead_to_read(lead)


@router.post("/{lead_id}/no-show", response_model=LeadRead)
async def lead_no_show(
    lead_id: int,
    body: ArrivalNoShowBody,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentUser,
) -> LeadRead:
    if current_user.role != UserRole.admin:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Admin only")

    lead = await db.get(Lead, lead_id)
    if lead is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Lead not found")
    await db.refresh(lead, ["stage"])

    if lead.stage is None or lead.stage.name != "Запись":
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Lead is not in stage 'Запись'")

    # MVP: если есть оплаченная часть (paid_amount > 0), то админ подтверждает ветвление
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
    await db.refresh(lead, ["stage"])
    return _lead_to_read(lead)


@router.post("/{lead_id}/service-done", response_model=LeadRead)
async def lead_service_done(
    lead_id: int,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentUser,
) -> LeadRead:
    if current_user.role != UserRole.expert:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Expert only")

    lead = await db.get(Lead, lead_id)
    if lead is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Lead not found")
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
    await db.refresh(lead, ["stage"])

    await _notify_by_roles(
        db,
        lead_id=lead.id,
        title="Нужны доп. услуги по записи — откройте карточку",
        assigned_roles=[UserRole.manager],
    )

    return _lead_to_read(lead)


@router.post("/{lead_id}/service-reject", response_model=LeadRead)
async def lead_service_reject(
    lead_id: int,
    body: ServiceRejectBody,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentUser,
) -> LeadRead:
    if current_user.role != UserRole.expert:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Expert only")

    lead = await db.get(Lead, lead_id)
    if lead is None:
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
    await db.refresh(lead, ["stage"])
    return _lead_to_read(lead)


@router.post("/{lead_id}/cart/extra-services/add", response_model=DealRead)
async def add_extra_service_to_cart(
    lead_id: int,
    body: ExtraServiceAddBody,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentUser,
) -> DealRead:
    if current_user.role != UserRole.manager:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Manager only")

    lead = await db.get(Lead, lead_id)
    if lead is None:
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
    await db.refresh(deal)

    if is_protocol:
        await _notify_by_roles(
            db,
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
) -> LeadRead:
    if current_user.role != UserRole.expert:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Expert only")

    lead = await db.get(Lead, lead_id)
    if lead is None:
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
    await db.refresh(lead, ["stage"])

    await _notify_by_roles(
        db,
        lead_id=lead.id,
        title="Сделка завершена — проверьте этап в канбане",
        assigned_roles=[UserRole.manager, UserRole.admin],
    )

    return _lead_to_read(lead)
