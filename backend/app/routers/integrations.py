import secrets
import re
from typing import Annotated, Any

from fastapi import APIRouter, Depends, Header, HTTPException, Query, Request, status
from sqlalchemy import and_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import CurrentUser
from app.database import get_db
from app.models import Integration, IntegrationProvider, Lead, LeadSource, Pipeline, PipelineStage, UserRole
from app.schemas.integrations import IntegrationCreate, IntegrationRead, IntegrationUpdate
from app.schemas.lead import LeadRead

router = APIRouter(prefix="/integrations", tags=["integrations"])


def _lead_read(lead: Lead) -> LeadRead:
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


async def _assert_pipeline_stage(db: AsyncSession, pipeline_id: int, stage_id: int) -> None:
    pipe = await db.get(Pipeline, pipeline_id)
    if pipe is None:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Pipeline not found")
    st = await db.get(PipelineStage, stage_id)
    if st is None:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Stage not found")
    if st.pipeline_id != pipeline_id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Stage does not belong to pipeline")


def _provider_from_str(s: str) -> IntegrationProvider:
    try:
        return IntegrationProvider(s)
    except ValueError:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Unknown provider")


@router.get("", response_model=list[IntegrationRead])
async def list_integrations(
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentUser,
) -> list[IntegrationRead]:
    if current_user.role != UserRole.admin:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Admin only")
    r = await db.execute(select(Integration).order_by(Integration.id.desc()))
    return [IntegrationRead.model_validate(x) for x in r.scalars().all()]


@router.post("", response_model=IntegrationRead, status_code=status.HTTP_201_CREATED)
async def create_integration(
    body: IntegrationCreate,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentUser,
) -> IntegrationRead:
    if current_user.role != UserRole.admin:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Admin only")
    provider = _provider_from_str(body.provider)
    await _assert_pipeline_stage(db, body.pipeline_id, body.stage_id)

    row = Integration(
        name=body.name.strip(),
        provider=provider,
        is_active=True,
        pipeline_id=body.pipeline_id,
        stage_id=body.stage_id,
        secret=body.secret.strip(),
        config=body.config,
    )
    db.add(row)
    await db.flush()
    await db.refresh(row)
    return IntegrationRead.model_validate(row)


@router.patch("/{integration_id}", response_model=IntegrationRead)
async def patch_integration(
    integration_id: int,
    body: IntegrationUpdate,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentUser,
) -> IntegrationRead:
    if current_user.role != UserRole.admin:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Admin only")

    row = await db.get(Integration, integration_id)
    if row is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Integration not found")

    if body.pipeline_id is not None or body.stage_id is not None:
        await _assert_pipeline_stage(db, body.pipeline_id or row.pipeline_id, body.stage_id or row.stage_id)
        if body.pipeline_id is not None:
            row.pipeline_id = body.pipeline_id
        if body.stage_id is not None:
            row.stage_id = body.stage_id

    if body.name is not None:
        row.name = body.name.strip()
    if body.is_active is not None:
        row.is_active = body.is_active
    if body.secret is not None:
        row.secret = body.secret.strip()
    if body.config is not None:
        row.config = body.config

    await db.flush()
    await db.refresh(row)
    return IntegrationRead.model_validate(row)


@router.post("/generate-secret")
async def generate_secret(
    current_user: CurrentUser,
) -> dict[str, str]:
    if current_user.role != UserRole.admin:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Admin only")
    return {"secret": secrets.token_urlsafe(24)}


async def _ensure_source_exists(db: AsyncSession, name: str) -> None:
    existing = await db.scalar(select(LeadSource.id).where(LeadSource.name == name))
    if existing is None:
        db.add(LeadSource(name=name, is_active=True))
        await db.flush()


def _norm_phone(raw: str | None) -> str | None:
    if not raw:
        return None
    digits = re.sub(r"\D+", "", raw)
    return digits or None


async def _find_existing_lead(
    db: AsyncSession,
    *,
    phone: str | None,
    source_name: str,
    pipeline_id: int,
) -> Lead | None:
    if phone:
        # Дедуп: один и тот же номер + источник в той же воронке
        res = await db.execute(
            select(Lead)
            .join(PipelineStage, PipelineStage.id == Lead.status_id)
            .where(
                and_(
                    Lead.phone == phone,
                    Lead.source == source_name,
                    PipelineStage.pipeline_id == pipeline_id,
                )
            )
            .order_by(Lead.id.desc())
            .limit(1),
        )
        found = res.scalars().first()
        if found is not None:
            return found
    return None


async def _create_lead_from_integration(
    db: AsyncSession,
    *,
    integ: Integration,
    name: str,
    phone: str | None,
    email: str | None,
    source_name: str,
) -> Lead:
    await _ensure_source_exists(db, source_name)
    norm_phone = _norm_phone(phone)
    existing = await _find_existing_lead(
        db,
        phone=norm_phone,
        source_name=source_name,
        pipeline_id=integ.pipeline_id,
    )
    if existing is not None:
        existing.status_id = integ.stage_id
        if not existing.name and name.strip():
            existing.name = name.strip()
        if not existing.email and (email or "").strip():
            existing.email = (email or "").strip()
        await db.flush()
        await db.refresh(existing, ["stage"])
        return existing

    lead = Lead(
        name=name.strip() or "Лид",
        phone=norm_phone,
        email=(email or "").strip() or None,
        source=source_name,
        status_id=integ.stage_id,
        manager_id=None,
    )
    db.add(lead)
    await db.flush()
    await db.refresh(lead, ["stage"])
    return lead


@router.post("/webhook/{integration_id}", response_model=LeadRead)
async def integration_webhook(
    integration_id: int,
    request: Request,
    db: Annotated[AsyncSession, Depends(get_db)],
    token: str | None = Query(default=None),
    x_webhook_token: str | None = Header(default=None),
) -> LeadRead:
    integ = await db.get(Integration, integration_id)
    if integ is None or not integ.is_active:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Integration not found")

    provided = token or x_webhook_token
    if not provided or not secrets.compare_digest(provided, integ.secret):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Bad token")

    payload: Any = await request.json()

    # MVP парсеры под провайдеры
    if integ.provider == IntegrationProvider.telegram:
        msg = payload.get("message") or payload.get("edited_message") or {}
        frm = msg.get("from") or {}
        chat = msg.get("chat") or {}
        text = msg.get("text") or ""
        name = (frm.get("first_name") or "") + (" " + (frm.get("last_name") or "") if frm.get("last_name") else "")
        name = name.strip() or (chat.get("title") or "Telegram lead")
        username = frm.get("username")
        source_name = "TELEGRAM"
        phone = None
        contact = msg.get("contact") or {}
        if isinstance(contact, dict):
            phone = contact.get("phone_number")
        if username:
            text = f"@{username}: {text}".strip()
        lead = await _create_lead_from_integration(
            db,
            integ=integ,
            name=name,
            phone=phone,
            email=None,
            source_name=source_name,
        )
        # можно сохранить текст в refusal_reason/комментарий — пока не трогаем модель
        return _lead_read(lead)

    if integ.provider == IntegrationProvider.green_api:
        # Ожидаем типичный webhook GREEN API: { "typeWebhook": "...", "senderData": {...}, "messageData": {...} }
        sender = payload.get("senderData") or {}
        message_data = payload.get("messageData") or {}
        chat_id = sender.get("chatId") or payload.get("chatId") or ""
        sender_name = sender.get("senderName") or "WhatsApp lead"
        phone = None
        if isinstance(chat_id, str) and chat_id.endswith("@c.us"):
            phone = chat_id.replace("@c.us", "")
        elif isinstance(chat_id, str):
            phone = chat_id
        # Иногда номер в sender
        if not phone:
            phone = sender.get("sender") or sender.get("senderPhone")
        # Имя из сообщения может быть полезнее
        if not sender_name:
            sender_name = (
                message_data.get("fileMessageData", {}).get("caption")
                or message_data.get("extendedTextMessageData", {}).get("text")
                or "WhatsApp lead"
            )
        source_name = "GREEN API"
        lead = await _create_lead_from_integration(
            db,
            integ=integ,
            name=str(sender_name),
            phone=phone,
            email=None,
            source_name=source_name,
        )
        return _lead_read(lead)

    # instagram placeholder
    raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Provider webhook not implemented yet")

