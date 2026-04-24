import asyncio
import json
import logging
import re
import secrets
from typing import Annotated, Any

from fastapi import APIRouter, Depends, Header, HTTPException, Query, Request, status
from starlette.responses import Response
from sqlalchemy import and_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.services.tariff import count_company_integrations
from app.core.deps import CurrentCompanyId, CurrentUser
from app.database import get_db
from app.services.green_incoming import parse_green_message_data
from app.services.lead_assignment import assign_manager_for_new_lead
from app.services.whatsapp_automation import send_welcome_if_first_incoming
from app.services.green_api_settings import (
    green_api_base_from_config,
    push_green_incoming_webhook,
    resolve_public_api_base,
)
from app.services.google_sheets_sync import sync_google_sheet_integration
from app.services.instagram_webhook import handle_instagram_webhook, meta_hub_challenge_response
from datetime import UTC, datetime

from app.models import (
    ChatMessage,
    ChatThread,
    Integration,
    IntegrationProvider,
    Lead,
    LeadSource,
    Pipeline,
    PipelineStage,
    UserRole,
)
from app.schemas.integrations import IntegrationCreate, IntegrationRead, IntegrationUpdate
from app.schemas.lead import LeadRead

router = APIRouter(prefix="/integrations", tags=["integrations"])
logger = logging.getLogger(__name__)

_SECRET_CFG_KEYS = frozenset(
    {
        "api_token",
        "apiToken",
        "apiTokenInstance",
        "page_access_token",
        "pageAccessToken",
        "app_secret",
        "appSecret",
    },
)


def _webhook_token_matches(provided: str | None, expected: str) -> bool:
    """compare_digest падает ValueError при разной длине строк — для вебхука это 400/500 вместо 403."""
    if not provided or not expected:
        return False
    if len(provided) != len(expected):
        return False
    return secrets.compare_digest(provided, expected)


def _token_from_authorization_header(raw: str | None) -> str | None:
    """Green API шлёт webhookUrlToken в заголовке Authorization: Bearer <token>."""
    if not raw or not str(raw).strip():
        return None
    s = str(raw).strip()
    low = s.lower()
    if low.startswith("bearer "):
        return s[7:].strip() or None
    return s


def _integration_read(row: Integration, *, setup_note: str | None = None) -> IntegrationRead:
    cfg = row.config
    has_token = False
    safe_cfg: dict | None = None
    if cfg and isinstance(cfg, dict):
        t = (
            cfg.get("api_token")
            or cfg.get("apiToken")
            or cfg.get("apiTokenInstance")
            or cfg.get("page_access_token")
            or cfg.get("pageAccessToken")
        )
        has_token = bool(t)
        safe_cfg = {k: v for k, v in cfg.items() if k not in _SECRET_CFG_KEYS}
        if not safe_cfg and not has_token:
            safe_cfg = None
        elif not safe_cfg:
            safe_cfg = {}
    pv = row.provider.value if hasattr(row.provider, "value") else str(row.provider)
    return IntegrationRead(
        id=row.id,
        name=row.name,
        provider=pv,
        is_active=row.is_active,
        pipeline_id=row.pipeline_id,
        stage_id=row.stage_id,
        manager_close_deal_enabled=bool(getattr(row, "manager_close_deal_enabled", False)),
        config=safe_cfg,
        has_api_token=has_token,
        setup_note=setup_note,
    )


def _merge_instagram_config(old: dict | None, new: dict | None) -> dict:
    merged = dict(old or {})
    if not new:
        return merged
    skip_empty = ("page_access_token", "pageAccessToken", "app_secret", "appSecret")
    for k, v in new.items():
        if k in skip_empty and (v is None or str(v).strip() == ""):
            continue
        merged[k] = v
    return merged


def _merge_green_api_config(old: dict | None, new: dict | None) -> dict:
    merged = dict(old or {})
    if not new:
        return merged
    for k, v in new.items():
        if k in _SECRET_CFG_KEYS and (v is None or str(v).strip() == ""):
            continue
        merged[k] = v
    return merged


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
        created_at=lead.created_at,
    )


async def _assert_pipeline_stage(db: AsyncSession, pipeline_id: int, stage_id: int, company_id: int) -> None:
    pipe = await db.get(Pipeline, pipeline_id)
    if pipe is None or pipe.company_id != company_id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Pipeline not found")
    st = await db.get(PipelineStage, stage_id)
    if st is None or st.company_id != company_id:
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
    company_id: CurrentCompanyId,
) -> list[IntegrationRead]:
    if current_user.role != UserRole.owner:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Только владелец")
    r = await db.execute(select(Integration).where(Integration.company_id == company_id).order_by(Integration.id.desc()))
    return [_integration_read(x) for x in r.scalars().all()]


@router.post("", response_model=IntegrationRead, status_code=status.HTTP_201_CREATED)
async def create_integration(
    body: IntegrationCreate,
    request: Request,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentUser,
    company_id: CurrentCompanyId,
) -> IntegrationRead:
    if current_user.role != UserRole.owner:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Только владелец")
    provider = _provider_from_str(body.provider)
    await _assert_pipeline_stage(db, body.pipeline_id, body.stage_id, company_id)
    cfg = dict(body.config or {})
    sec = (body.secret or "").strip() if body.secret else ""
    if provider == IntegrationProvider.green_api:
        if not sec:
            sec = secrets.token_urlsafe(24)
        instance_id = cfg.get("instance_id") or cfg.get("instanceId")
        api_token = cfg.get("api_token") or cfg.get("apiToken") or cfg.get("apiTokenInstance")
        if not instance_id or not api_token:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Укажите idInstance и apiTokenInstance из личного кабинета Green API",
            )
    elif provider == IntegrationProvider.google_sheets:
        if not sec:
            sec = secrets.token_urlsafe(24)
        sheet_url = str(cfg.get("sheet_url") or cfg.get("spreadsheet_id") or "").strip()
        if not sheet_url:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Для Google Sheets укажите config.sheet_url (или spreadsheet_id)",
            )
    elif provider == IntegrationProvider.instagram:
        if len(sec) < 8:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Verify token (webhook-секрет) не короче 8 символов — сгенерируйте в форме или введите свой",
            )
        page_token = str(cfg.get("page_access_token") or cfg.get("pageAccessToken") or "").strip()
        if not page_token:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Укажите Page Access Token (Meta → инструменты Graph API или настройки Lead Ads)",
            )
    else:
        if len(sec) < 8:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Webhook-секрет не короче 8 символов",
            )

    mx_int = settings.tariff_max_integrations
    if mx_int > 0:
        n_int = await count_company_integrations(db, company_id)
        if n_int >= mx_int:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Достигнут лимит интеграций по тарифу ({mx_int}).",
            )

    row = Integration(
        name=body.name.strip(),
        provider=provider,
        is_active=True,
        company_id=company_id,
        pipeline_id=body.pipeline_id,
        stage_id=body.stage_id,
        secret=sec,
        config=cfg,
        manager_close_deal_enabled=body.manager_close_deal_enabled,
    )
    db.add(row)
    await db.flush()
    await db.refresh(row)

    if provider == IntegrationProvider.green_api:
        instance_id = cfg.get("instance_id") or cfg.get("instanceId")
        api_token = cfg.get("api_token") or cfg.get("apiToken") or cfg.get("apiTokenInstance")
        pub = resolve_public_api_base(request, settings.public_api_base_url)
        if not pub:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=(
                    "Не удалось определить адрес API для автоподключения WhatsApp. "
                    "На сервере задайте public_api_base_url (например https://ваш-проект.amvera.io) "
                    "или откройте CRM с того же домена, что и бэкенд."
                ),
            )
        webhook_url = f"{pub}/api/integrations/webhook/{row.id}"
        api_base = green_api_base_from_config(cfg)
        ok, err = await asyncio.to_thread(
            push_green_incoming_webhook,
            instance_id=str(instance_id).strip(),
            api_token_instance=str(api_token).strip(),
            api_base=api_base,
            webhook_url=webhook_url,
            webhook_token=sec,
        )
        if not ok:
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY,
                detail=f"Green API не принял настройки (проверьте Instance ID, токен и адрес API в кабинете): {err}",
            )
        note = (
            "WhatsApp подключён: входящие сообщения будут попадать в выбранную воронку. "
            "Green API применяет настройки до 5 минут."
        )
        return _integration_read(row, setup_note=note)

    if provider == IntegrationProvider.instagram:
        pub = resolve_public_api_base(request, settings.public_api_base_url)
        hook = f"{pub}/api/integrations/webhook/{row.id}" if pub else f"/api/integrations/webhook/{row.id}"
        note = (
            f"Callback URL в Meta: {hook}. "
            "Verify token: тот же секрет, что в форме. Подписки: leadgen (страница), instagram, при необходимости messages. "
            "App Secret в config — для проверки подписи X-Hub-Signature-256 (рекомендуется)."
        )
        return _integration_read(row, setup_note=note)

    return _integration_read(row)


@router.patch("/{integration_id}", response_model=IntegrationRead)
async def patch_integration(
    integration_id: int,
    body: IntegrationUpdate,
    request: Request,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentUser,
    company_id: CurrentCompanyId,
) -> IntegrationRead:
    if current_user.role != UserRole.owner:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Только владелец")

    row = await db.get(Integration, integration_id)
    if row is None or row.company_id != company_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Integration not found")

    if body.pipeline_id is not None or body.stage_id is not None:
        await _assert_pipeline_stage(db, body.pipeline_id or row.pipeline_id, body.stage_id or row.stage_id, company_id)
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
    if body.manager_close_deal_enabled is not None:
        row.manager_close_deal_enabled = body.manager_close_deal_enabled
    if body.config is not None:
        if row.provider == IntegrationProvider.green_api:
            merged = _merge_green_api_config(row.config, body.config)
            instance_id = merged.get("instance_id") or merged.get("instanceId")
            api_token = merged.get("api_token") or merged.get("apiToken") or merged.get("apiTokenInstance")
            if not instance_id or not api_token:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="For green_api set config.instance_id and config.api_token (или оставьте токен пустым при смене только instance)",
                )
            row.config = merged
        elif row.provider == IntegrationProvider.google_sheets:
            merged = dict(row.config or {})
            merged.update(body.config)
            sheet_url = str(merged.get("sheet_url") or merged.get("spreadsheet_id") or "").strip()
            if not sheet_url:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="Для Google Sheets укажите config.sheet_url (или spreadsheet_id)",
                )
            row.config = merged
        elif row.provider == IntegrationProvider.instagram:
            merged = _merge_instagram_config(row.config, body.config)
            page_token = str(merged.get("page_access_token") or merged.get("pageAccessToken") or "").strip()
            if not page_token:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="Нужен page_access_token в config (или оставьте прежний, не отправляя пустое поле)",
                )
            row.config = merged
        else:
            row.config = body.config

    await db.flush()
    await db.refresh(row)

    if row.provider == IntegrationProvider.green_api:
        cfg = row.config or {}
        instance_id = cfg.get("instance_id") or cfg.get("instanceId")
        api_token = cfg.get("api_token") or cfg.get("apiToken") or cfg.get("apiTokenInstance")
        if instance_id and api_token:
            pub = resolve_public_api_base(request, settings.public_api_base_url)
            if not pub:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail=(
                        "Не удалось определить адрес API. Задайте public_api_base_url на сервере "
                        "(например https://ваш-проект.amvera.io)."
                    ),
                )
            webhook_url = f"{pub}/api/integrations/webhook/{row.id}"
            api_base = green_api_base_from_config(cfg)
            ok, err = await asyncio.to_thread(
                push_green_incoming_webhook,
                instance_id=str(instance_id).strip(),
                api_token_instance=str(api_token).strip(),
                api_base=api_base,
                webhook_url=webhook_url,
                webhook_token=row.secret,
            )
            if not ok:
                raise HTTPException(
                    status_code=status.HTTP_502_BAD_GATEWAY,
                    detail=f"Green API не принял настройки: {err}",
                )
            return _integration_read(
                row,
                setup_note="Настройки WhatsApp отправлены в Green API (применение до 5 минут).",
            )

    return _integration_read(row)


@router.post("/{integration_id}/sync")
async def sync_integration_now(
    integration_id: int,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentUser,
    company_id: CurrentCompanyId,
) -> dict[str, int]:
    if current_user.role != UserRole.owner:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Только владелец")
    row = await db.get(Integration, integration_id)
    if row is None or row.company_id != company_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Integration not found")
    if row.provider != IntegrationProvider.google_sheets:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Sync supported only for Google Sheets")
    try:
        stats = await sync_google_sheet_integration(db, integ=row, max_rows=1000)
    except RuntimeError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))
    await db.commit()
    return stats


@router.post("/generate-secret")
async def generate_secret(
    current_user: CurrentUser,
) -> dict[str, str]:
    if current_user.role != UserRole.owner:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Только владелец")
    return {"secret": secrets.token_urlsafe(24)}


async def _ensure_source_exists(db: AsyncSession, company_id: int, name: str) -> None:
    existing = await db.scalar(select(LeadSource.id).where(LeadSource.company_id == company_id, LeadSource.name == name))
    if existing is None:
        db.add(LeadSource(name=name, is_active=True, company_id=company_id))
        await db.flush()


def _norm_phone(raw: str | None) -> str | None:
    if not raw:
        return None
    digits = re.sub(r"\D+", "", raw)
    return digits or None


async def _find_existing_lead(
    db: AsyncSession,
    *,
    company_id: int,
    phone: str | None,
    source_name: str,
    pipeline_id: int,
    external_chat_id: str | None = None,
    thread_provider: str | None = None,
) -> Lead | None:
    if phone:
        # Дедуп: один и тот же номер + источник в той же воронке
        res = await db.execute(
            select(Lead)
            .join(PipelineStage, PipelineStage.id == Lead.status_id)
            .where(
                and_(
                    Lead.phone == phone,
                    Lead.company_id == company_id,
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
    # Без телефона (или не распарсился): тот же WhatsApp/Telegram chat → один лид
    if external_chat_id and thread_provider:
        res = await db.execute(
            select(Lead)
            .join(ChatThread, ChatThread.lead_id == Lead.id)
            .join(PipelineStage, PipelineStage.id == Lead.status_id)
            .where(
                and_(
                    Lead.source == source_name,
                    Lead.company_id == company_id,
                    PipelineStage.pipeline_id == pipeline_id,
                    ChatThread.provider == thread_provider,
                    ChatThread.external_chat_id == external_chat_id,
                ),
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
    company_id: int,
    name: str,
    phone: str | None,
    email: str | None,
    source_name: str,
    external_chat_id: str | None = None,
    thread_provider: str | None = None,
) -> Lead:
    await _ensure_source_exists(db, company_id, source_name)
    norm_phone = _norm_phone(phone)
    existing = await _find_existing_lead(
        db,
        company_id=company_id,
        phone=norm_phone,
        source_name=source_name,
        pipeline_id=integ.pipeline_id,
        external_chat_id=(external_chat_id or "").strip() or None,
        thread_provider=thread_provider,
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
        company_id=company_id,
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
    pipe = await db.get(Pipeline, int(integ.pipeline_id))
    exclude_id = int(pipe.intake_manager_user_id) if pipe and pipe.intake_manager_user_id is not None else None
    mid = await assign_manager_for_new_lead(db, pipeline_id=integ.pipeline_id, exclude_user_id=exclude_id)
    if mid is not None:
        lead.manager_id = mid
        await db.flush()
    return lead


async def _upsert_thread(
    db: AsyncSession,
    *,
    company_id: int,
    lead: Lead,
    provider: str,
    external_chat_id: str | None,
    title: str | None = None,
) -> ChatThread:
    q = select(ChatThread).where(
        ChatThread.company_id == company_id,
        ChatThread.lead_id == lead.id,
        ChatThread.provider == provider,
    )
    if external_chat_id:
        q = q.where(ChatThread.external_chat_id == external_chat_id)
    found = (await db.execute(q.limit(1))).scalars().first()
    if found is not None:
        found.updated_at = datetime.now(UTC)
        if title and not found.title:
            found.title = title
        if external_chat_id and not found.external_chat_id:
            found.external_chat_id = external_chat_id
        await db.flush()
        return found
    t = ChatThread(
        company_id=company_id,
        lead_id=lead.id,
        pipeline_id=lead.stage.pipeline_id if lead.stage else None,
        provider=provider,
        external_chat_id=external_chat_id,
        title=title,
        created_at=datetime.now(UTC),
        updated_at=datetime.now(UTC),
    )
    db.add(t)
    await db.flush()
    return t


async def _add_incoming_message(
    db: AsyncSession,
    company_id: int,
    thread_id: int,
    text: str,
    *,
    message_type: str = "text",
    media_url: str | None = None,
    media_mime: str | None = None,
    file_name: str | None = None,
) -> None:
    body = (text or "").strip()
    if not body and not media_url:
        return
    if not body:
        body = " "
    db.add(
        ChatMessage(
            company_id=company_id,
            thread_id=thread_id,
            author_user_id=None,
            direction="in",
            text=body,
            message_type=message_type,
            media_url=media_url,
            media_mime=media_mime,
            file_name=file_name,
            delivery_status="sent",
            created_at=datetime.now(UTC),
        )
    )
    await db.flush()


@router.get("/webhook/{integration_id}")
async def integration_webhook_verify(
    integration_id: int,
    request: Request,
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """Meta при подписке webhook шлёт GET с hub.mode / hub.verify_token / hub.challenge."""
    integ = await db.get(Integration, integration_id)
    if integ is None or not integ.is_active:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Integration not found")
    if integ.provider != IntegrationProvider.instagram:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Use this URL only for Instagram / Meta")
    qp = request.query_params
    challenge = meta_hub_challenge_response(
        verify_token=integ.secret,
        hub_mode=qp.get("hub.mode"),
        hub_verify_token=qp.get("hub.verify_token"),
        hub_challenge=qp.get("hub.challenge"),
    )
    if challenge is None:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Verification failed")
    return challenge


@router.post("/webhook/{integration_id}")
async def integration_webhook(
    integration_id: int,
    request: Request,
    db: Annotated[AsyncSession, Depends(get_db)],
    token: str | None = Query(default=None),
    x_webhook_token: str | None = Header(default=None),
    authorization: Annotated[str | None, Header()] = None,
) -> LeadRead | Response:
    raw_body = await request.body()
    integ = await db.get(Integration, integration_id)
    if integ is None or not integ.is_active:
        logger.warning("integration webhook: integration_id=%s not found or inactive", integration_id)
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Integration not found")
    if integ.company_id is None:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Integration has no company scope")
    company_id = int(integ.company_id)

    if integ.provider == IntegrationProvider.instagram:
        sig = request.headers.get("X-Hub-Signature-256")
        try:
            payload: Any = json.loads(raw_body.decode("utf-8") or "{}") if raw_body else {}
        except Exception:
            logger.exception("integration webhook: integration_id=%s invalid JSON body (instagram)", integration_id)
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Expected JSON body")
        if not isinstance(payload, dict):
            payload = {}
        return await handle_instagram_webhook(
            db,
            integ=integ,
            company_id=company_id,
            raw_body=raw_body,
            payload=payload,
            signature_header=sig,
            create_lead_fn=_create_lead_from_integration,
            upsert_thread_fn=_upsert_thread,
            add_message_fn=_add_incoming_message,
            lead_read_fn=_lead_read,
        )

    provided = token or x_webhook_token or _token_from_authorization_header(authorization)
    if not _webhook_token_matches(provided, integ.secret):
        logger.warning(
            "integration webhook: integration_id=%s rejected (missing/wrong token, len_provided=%s)",
            integration_id,
            len(provided or ""),
        )
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Bad token")

    try:
        payload = json.loads(raw_body.decode("utf-8") or "{}") if raw_body else {}
    except Exception:
        logger.exception("integration webhook: integration_id=%s invalid JSON body", integration_id)
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Expected JSON body")

    logger.info(
        "integration webhook: integration_id=%s provider=%s typeWebhook=%s",
        integration_id,
        integ.provider.value if hasattr(integ.provider, "value") else integ.provider,
        payload.get("typeWebhook") if isinstance(payload, dict) else None,
    )

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
        ext_chat = str(chat.get("id") or "").strip()
        lead = await _create_lead_from_integration(
            db,
            integ=integ,
            company_id=company_id,
            name=name,
            phone=phone,
            email=None,
            source_name=source_name,
            external_chat_id=ext_chat or None,
            thread_provider=IntegrationProvider.telegram.value,
        )
        thread = await _upsert_thread(
            db,
            company_id=company_id,
            lead=lead,
            provider=IntegrationProvider.telegram.value,
            external_chat_id=ext_chat or None,
            title=name,
        )
        await _add_incoming_message(db, company_id, thread.id, text)
        logger.info("integration webhook: ok lead_id=%s thread_id=%s", lead.id, thread.id)
        return _lead_read(lead)

    if integ.provider == IntegrationProvider.green_api:
        # Иначе на каждый stateInstance/outgoingStatus и т.д. создавались бы новые лиды
        tw = str(payload.get("typeWebhook") or "").strip()
        if tw != "incomingMessageReceived":
            logger.info(
                "integration webhook: integration_id=%s green_api skip typeWebhook=%s",
                integration_id,
                tw or "(empty)",
            )
            return Response(status_code=204)
        # Ожидаем типичный webhook GREEN API: { "typeWebhook": "...", "senderData": {...}, "messageData": {...} }
        sender = payload.get("senderData") or {}
        message_data = payload.get("messageData") or {}
        raw_chat = sender.get("chatId") or payload.get("chatId")
        chat_id = str(raw_chat).strip() if raw_chat not in (None, "") else ""
        sender_name = sender.get("senderName") or "WhatsApp lead"
        phone = None
        if chat_id.endswith("@c.us"):
            phone = chat_id.replace("@c.us", "")
        elif chat_id:
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
        text, mtype, murl, mmime, mfn = parse_green_message_data(message_data)
        ext_chat = chat_id or None
        lead = await _create_lead_from_integration(
            db,
            integ=integ,
            company_id=company_id,
            name=str(sender_name),
            phone=phone,
            email=None,
            source_name=source_name,
            external_chat_id=ext_chat,
            thread_provider=IntegrationProvider.green_api.value,
        )
        thread = await _upsert_thread(
            db,
            company_id=company_id,
            lead=lead,
            provider=IntegrationProvider.green_api.value,
            external_chat_id=ext_chat,
            title=str(sender_name),
        )
        await _add_incoming_message(
            db,
            company_id,
            thread.id,
            text,
            message_type=mtype,
            media_url=murl,
            media_mime=mmime,
            file_name=mfn,
        )
        await send_welcome_if_first_incoming(
            db,
            lead=lead,
            thread=thread,
            integration=integ,
        )
        logger.info("integration webhook: ok lead_id=%s thread_id=%s", lead.id, thread.id)
        return _lead_read(lead)

    if integ.provider == IntegrationProvider.google_sheets:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Google Sheets: используйте синхронизацию из панели интеграций, webhook не применяется",
        )

    raise HTTPException(
        status_code=status.HTTP_400_BAD_REQUEST,
        detail=f"Webhook для провайдера не поддерживается: {integ.provider}",
    )

