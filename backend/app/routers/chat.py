import asyncio
import logging
import mimetypes
from datetime import UTC, datetime
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, Request, UploadFile, WebSocket, WebSocketDisconnect, status
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field
from sqlalchemy import and_, case, exists, func, or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import CurrentCompanyId, CurrentUser
from app.core.manager_scope import manager_lead_visibility
from app.core.security import decode_token
from app.database import get_db
from app.models import (
    BookingAppointment,
    BookingDirection,
    ChatMessage,
    ChatThread,
    ChatThreadUserRead,
    Deal,
    Integration,
    IntegrationProvider,
    Lead,
    LeadAuditEvent,
    Pipeline,
    User,
    UserPipelineAssignment,
    UserRole,
)

_INTEGRATION_CLOSE_DEAL_TYPE = "integration_close"
from app.services.audio_prepare import prepare_file_for_green_whatsapp
from app.services.chat_media_store import resolve_chat_media, save_outgoing_chat_media
from app.services.green_incoming_media import ensure_chat_message_media_local
from app.services.green_api_send import send_green_file_upload, send_green_text_async
from app.services.whatsapp_phone_fallback import resolve_outbound_green_chat_id
from app.services.patient_phone_visibility import (
    can_view_full_patient_phone,
    mask_patient_phone,
    resolve_phone_fields,
)
from app.services.phone_match import parse_allowed_phones_json, phone_digits

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/chat", tags=["chat"])


class ChatThreadRead(BaseModel):
    id: int
    lead_id: int | None = None
    lead_name: str | None = None
    lead_phone: str | None = None
    lead_phone_display: str | None = None
    lead_phone_can_view_full: bool = False
    manager_id: int | None = None
    manager_name: str | None = None
    provider: str
    external_chat_id: str | None = None
    title: str | None = None
    pipeline_id: int | None = None
    updated_at: datetime
    unread_count: int = Field(
        default=0,
        description="Входящие от клиента после последнего просмотра диалога этим пользователем.",
    )
    first_message_at: datetime | None = Field(
        default=None,
        description="Время самого раннего сообщения в потоке (для подсветки свежих диалогов).",
    )
    last_message_direction: str | None = Field(
        default=None,
        description="Направление последнего сообщения: in — от клиента, out — от менеджера.",
    )
    is_transferred: bool = Field(
        default=False,
        description="Лид передан этому менеджеру при перераспределении (не изначально его).",
    )
    sale_service_title: str | None = Field(
        default=None,
        description="Услуга по закрытой продаже (последняя запись или сделка).",
    )
    sale_amount: str | None = Field(default=None, description="Сумма сделки")
    sale_paid_amount: str | None = Field(default=None, description="Оплачено по сделке")


ChatThreadBucket = Literal["transferred", "own", "awaiting_reply", "sold"]


class ChatThreadBucketCounts(BaseModel):
    transferred: int = 0
    own: int = 0
    awaiting_reply: int = 0
    sold: int = 0


class ChatMessageRead(BaseModel):
    id: int
    thread_id: int
    author_user_id: int | None = None
    direction: str
    text: str
    message_type: str = "text"
    media_url: str | None = None
    media_mime: str | None = None
    file_name: str | None = None
    delivery_status: str
    created_at: datetime


class SendMessageBody(BaseModel):
    text: str = Field(..., min_length=1, max_length=4000)


def _phone_from_external_chat_id(external_chat_id: str | None) -> str | None:
    if not external_chat_id or not str(external_chat_id).strip():
        return None
    local = str(external_chat_id).split("@", 1)[0].strip()
    digits = phone_digits(local)
    return digits or local or None


async def _thread_allowed_outbound_phones(db: AsyncSession, thread: ChatThread) -> list[str]:
    pipeline_id = thread.pipeline_id
    if pipeline_id is None and thread.lead_id is not None:
        lead = await db.get(Lead, thread.lead_id)
        if lead is not None:
            await db.refresh(lead, ["stage"])
            if lead.stage is not None:
                pipeline_id = lead.stage.pipeline_id
    if pipeline_id is None:
        return []
    pipe = await db.get(Pipeline, int(pipeline_id))
    if pipe is None:
        return []
    return parse_allowed_phones_json(pipe.manager_allowed_outbound_phones)


async def _manager_pipeline_ids(db: AsyncSession, user_id: int) -> set[int]:
    user = await db.get(User, user_id)
    if user is None or user.company_id is None:
        return set()
    rows = await db.execute(
        select(UserPipelineAssignment.pipeline_id).where(
            UserPipelineAssignment.user_id == user_id,
            UserPipelineAssignment.company_id == user.company_id,
        )
    )
    return {r[0] for r in rows.all()}


def _lead_closed_sale_exists(lead_id_col, *, company_id: int):
    return exists(
        select(1)
        .select_from(Deal)
        .where(
            Deal.lead_id == lead_id_col,
            Deal.company_id == company_id,
            Deal.deal_type == _INTEGRATION_CLOSE_DEAL_TYPE,
        ),
    )


async def _sale_info_by_lead_ids(
    db: AsyncSession,
    *,
    company_id: int,
    lead_ids: list[int],
) -> dict[int, dict[str, str | None]]:
    if not lead_ids:
        return {}
    uniq = sorted({int(x) for x in lead_ids if x is not None})
    deal_rows = (
        await db.execute(
            select(Deal.lead_id, Deal.amount, Deal.paid_amount, Deal.title).where(
                Deal.company_id == company_id,
                Deal.lead_id.in_(uniq),
                Deal.deal_type == _INTEGRATION_CLOSE_DEAL_TYPE,
            ),
        )
    ).all()
    out: dict[int, dict[str, str | None]] = {}
    for lead_id, amount, paid, title in deal_rows:
        lid = int(lead_id)
        out[lid] = {
            "service": (str(title or "").strip() or None),
            "amount": str(amount) if amount is not None else None,
            "paid": str(paid) if paid is not None else None,
        }
    appt_rows = (
        await db.execute(
            select(
                BookingAppointment.lead_id,
                func.coalesce(BookingAppointment.service_title, BookingDirection.name),
            )
            .outerjoin(BookingDirection, BookingDirection.id == BookingAppointment.direction_id)
            .where(
                BookingAppointment.company_id == company_id,
                BookingAppointment.lead_id.in_(uniq),
            )
            .order_by(BookingAppointment.start_at.desc(), BookingAppointment.id.desc()),
        )
    ).all()
    service_by_lead: dict[int, str] = {}
    for lead_id, svc in appt_rows:
        if lead_id is None:
            continue
        lid = int(lead_id)
        if lid in service_by_lead:
            continue
        label = str(svc or "").strip()
        if label:
            service_by_lead[lid] = label
    for lid, info in out.items():
        svc = service_by_lead.get(lid) or info.get("service")
        info["service"] = svc or "Закрытая сделка"
    return out


def _lead_transferred_to_manager_exists(lead_id_col, *, manager_id: int, company_id: int):
    return exists(
        select(1)
        .select_from(LeadAuditEvent)
        .where(
            LeadAuditEvent.lead_id == lead_id_col,
            LeadAuditEvent.company_id == company_id,
            LeadAuditEvent.action == "manager_reassigned",
            LeadAuditEvent.details.like(f"%to_manager_id={manager_id}%"),
        ),
    )


async def _expert_pipeline_ids(db: AsyncSession, *, user_id: int, company_id: int) -> set[int]:
    rows = await db.execute(
        select(Pipeline.id).where(
            Pipeline.company_id == company_id,
            Pipeline.expert_user_id == user_id,
        )
    )
    return {int(r[0]) for r in rows.all()}


async def _assert_thread_access(db: AsyncSession, thread: ChatThread, current_user) -> None:
    if current_user.role == UserRole.owner:
        return
    if current_user.role == UserRole.expert:
        if thread.pipeline_id is None:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Thread is outside expert pipelines")
        allowed = await _expert_pipeline_ids(
            db,
            user_id=current_user.id,
            company_id=int(thread.company_id or 0),
        )
        if thread.pipeline_id not in allowed:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Thread is outside expert pipelines")
        return
    if current_user.role not in (UserRole.manager, UserRole.admin):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Managers only")
    allowed = await _manager_pipeline_ids(db, current_user.id)
    if thread.pipeline_id not in allowed:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Thread is outside manager directions")
    if thread.lead_id:
        lead = await db.get(Lead, thread.lead_id)
        if lead and lead.manager_id is not None and lead.manager_id != current_user.id:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Клиент закреплён за другим менеджером",
            )


async def _ensure_thread_read_baseline(db: AsyncSession, *, user_id: int, thread_id: int) -> ChatThreadUserRead:
    """Первая строка чтения: считаем историю уже просмотренной (как в WhatsApp после обновления)."""
    r = await db.execute(
        select(ChatThreadUserRead).where(
            ChatThreadUserRead.user_id == user_id,
            ChatThreadUserRead.thread_id == thread_id,
        )
    )
    row = r.scalars().first()
    if row is not None:
        return row
    mx = await db.scalar(select(func.max(ChatMessage.id)).where(ChatMessage.thread_id == thread_id))
    last_id = int(mx or 0)
    try:
        # Защита от гонки: параллельные запросы могут пытаться создать baseline одновременно.
        async with db.begin_nested():
            row = ChatThreadUserRead(user_id=user_id, thread_id=thread_id, last_read_message_id=last_id)
            db.add(row)
            await db.flush()
            return row
    except IntegrityError:
        r2 = await db.execute(
            select(ChatThreadUserRead).where(
                ChatThreadUserRead.user_id == user_id,
                ChatThreadUserRead.thread_id == thread_id,
            )
        )
        existing = r2.scalars().first()
        if existing is not None:
            return existing
        raise


async def _unread_incoming_count(db: AsyncSession, *, user_id: int, thread_id: int) -> int:
    read_row = await _ensure_thread_read_baseline(db, user_id=user_id, thread_id=thread_id)
    last_id = read_row.last_read_message_id
    n = await db.scalar(
        select(func.count())
        .select_from(ChatMessage)
        .where(
            ChatMessage.thread_id == thread_id,
            ChatMessage.direction == "in",
            ChatMessage.id > last_id,
        )
    )
    return int(n or 0)


async def _mark_thread_read_up_to_latest(db: AsyncSession, *, user_id: int, thread_id: int) -> None:
    mx = await db.scalar(select(func.max(ChatMessage.id)).where(ChatMessage.thread_id == thread_id))
    last_id = int(mx or 0)
    r = await db.execute(
        select(ChatThreadUserRead).where(
            ChatThreadUserRead.user_id == user_id,
            ChatThreadUserRead.thread_id == thread_id,
        )
    )
    row = r.scalars().first()
    if row is None:
        try:
            async with db.begin_nested():
                db.add(ChatThreadUserRead(user_id=user_id, thread_id=thread_id, last_read_message_id=last_id))
                await db.flush()
        except IntegrityError:
            r2 = await db.execute(
                select(ChatThreadUserRead).where(
                    ChatThreadUserRead.user_id == user_id,
                    ChatThreadUserRead.thread_id == thread_id,
                )
            )
            existing = r2.scalars().first()
            if existing is not None:
                existing.last_read_message_id = max(existing.last_read_message_id, last_id)
    else:
        row.last_read_message_id = max(row.last_read_message_id, last_id)
    await db.flush()


def _msg_read(m: ChatMessage) -> ChatMessageRead:
    return ChatMessageRead(
        id=m.id,
        thread_id=m.thread_id,
        author_user_id=m.author_user_id,
        direction=m.direction,
        text=m.text,
        message_type=getattr(m, "message_type", None) or "text",
        media_url=getattr(m, "media_url", None),
        media_mime=getattr(m, "media_mime", None),
        file_name=getattr(m, "file_name", None),
        delivery_status=m.delivery_status,
        created_at=m.created_at,
    )


async def _resolve_green_send(
    db: AsyncSession,
    thread_id: int,
    company_id: int,
    current_user,
) -> tuple[ChatThread, dict, str]:
    thread = await db.get(ChatThread, thread_id)
    if thread is None or thread.company_id != company_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Thread not found")
    await _assert_thread_access(db, thread, current_user)
    if thread.provider != IntegrationProvider.green_api.value:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Provider send is not implemented yet")

    chat_id, _used_extra = await resolve_outbound_green_chat_id(db, thread=thread)
    if not chat_id:
        lead = await db.get(Lead, thread.lead_id) if thread.lead_id else None
        if lead and lead.phone:
            chat_id = f"{lead.phone}@c.us"
    if not chat_id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="No chat id / lead phone for WhatsApp")
    integ = (
        await db.execute(
            select(Integration)
            .where(
                Integration.provider == IntegrationProvider.green_api,
                Integration.is_active.is_(True),
                Integration.company_id == company_id,
                Integration.pipeline_id == (thread.pipeline_id or 0),
            )
            .limit(1),
        )
    ).scalars().first()
    if integ is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="No active GREEN API integration for thread pipeline",
        )
    return thread, integ.config or {}, chat_id


async def _send_green_file_message(
    db: AsyncSession,
    *,
    thread: ChatThread,
    cfg: dict,
    chat_id: str,
    current_user,
    file_bytes: bytes,
    filename: str,
    file_content_type: str | None,
    caption: str,
) -> ChatMessageRead:
    from app.services.chat_outbound_policy import outbound_message_allowed

    allowed_phones = await _thread_allowed_outbound_phones(db, thread)
    if caption.strip():
        allowed, policy_err = outbound_message_allowed(
            current_user,
            caption,
            allowed_outbound_phones=allowed_phones,
        )
        if not allowed:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=policy_err or "Сообщение запрещено")
    status_name = "sent"
    provider_msg_id = None
    try:
        file_bytes, filename = await prepare_file_for_green_whatsapp(
            file_bytes,
            filename or "file",
            file_content_type,
        )
    except RuntimeError as e:
        d = str(e)
        logger.warning("chat voice prepare failed thread=%s detail=%s", thread.id, d[:500])
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=d) from e
    ok, err, provider_msg_id = await send_green_file_upload(
        cfg,
        chat_id,
        file_bytes,
        filename or "file",
        caption or "",
    )
    if not ok:
        msg = ChatMessage(
            company_id=thread.company_id,
            thread_id=thread.id,
            author_user_id=current_user.id,
            direction="out",
            text=caption or " ",
            message_type="document",
            delivery_status="failed",
            created_at=datetime.now(UTC),
        )
        db.add(msg)
        thread.updated_at = datetime.now(UTC)
        await db.flush()
        d = f"Send failed: {err}"
        logger.warning("chat green upload failed thread=%s detail=%s", thread.id, d[:800])
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=d)
    mtype = "document"
    low = (filename or "").lower()
    if any(low.endswith(x) for x in (".jpg", ".jpeg", ".png", ".gif", ".webp")):
        mtype = "image"
    elif any(low.endswith(x) for x in (".mp4", ".webm", ".mov")):
        mtype = "video"
    elif any(low.endswith(x) for x in (".ogg", ".mp3", ".m4a", ".opus", ".wav", ".aac", ".amr")):
        mtype = "audio"
    msg = ChatMessage(
        company_id=thread.company_id,
        thread_id=thread.id,
        author_user_id=current_user.id,
        direction="out",
        text=caption or "📎 Файл",
        message_type=mtype,
        delivery_status=status_name,
        provider_message_id=provider_msg_id,
        file_name=filename,
        media_mime=file_content_type or mimetypes.guess_type(filename or "file")[0],
        created_at=datetime.now(UTC),
    )
    db.add(msg)
    thread.updated_at = datetime.now(UTC)
    await db.flush()
    msg.media_url = save_outgoing_chat_media(msg.id, filename, file_bytes)
    await db.refresh(msg)
    await _mark_thread_read_up_to_latest(db, user_id=current_user.id, thread_id=thread.id)
    return _msg_read(msg)


def _apply_thread_search(query, *, term: str):
    like = f"%{term}%"
    conds = [
        Lead.name.ilike(like),
        Lead.phone.ilike(like),
        ChatThread.title.ilike(like),
        ChatThread.external_chat_id.ilike(like),
        exists(
            select(ChatMessage.id)
            .where(
                ChatMessage.thread_id == ChatThread.id,
                ChatMessage.text.ilike(like),
            )
            .limit(1),
        ),
    ]
    digits = "".join(ch for ch in term if ch.isdigit())
    if digits:
        dlike = f"%{digits}%"
        conds.extend(
            [
                Lead.phone.ilike(dlike),
                ChatThread.external_chat_id.ilike(dlike),
            ],
        )
    return query.where(or_(*conds))


def _apply_manager_thread_bucket(
    query,
    *,
    bucket: ChatThreadBucket | None,
    manager_id: int,
    company_id: int,
    last_direction_sq,
):
    if bucket is None:
        return query
    transferred = _lead_transferred_to_manager_exists(
        Lead.id,
        manager_id=manager_id,
        company_id=company_id,
    )
    if bucket == "transferred":
        return query.where(transferred)
    if bucket == "own":
        return query.where(~transferred)
    if bucket == "awaiting_reply":
        return query.where(last_direction_sq == "in")
    if bucket == "sold":
        return query.where(_lead_closed_sale_exists(Lead.id, company_id=company_id))
    return query


@router.websocket("/ws")
async def chat_websocket(websocket: WebSocket, token: str = Query(..., min_length=10)) -> None:
    """WebSocket ping/push для обновления чата без polling."""
    await websocket.accept()
    try:
        payload = decode_token(token)
        sub = payload.get("sub")
        if sub is None:
            await websocket.close(code=4401)
            return
    except Exception:
        await websocket.close(code=4401)
        return
    try:
        while True:
            try:
                await asyncio.wait_for(websocket.receive_text(), timeout=30.0)
            except TimeoutError:
                pass
            await websocket.send_json({"type": "chat_refresh", "at": datetime.now(UTC).isoformat()})
    except WebSocketDisconnect:
        return


@router.get("/threads/bucket-counts", response_model=ChatThreadBucketCounts)
async def thread_bucket_counts(
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentUser,
    company_id: CurrentCompanyId,
    q: str | None = Query(default=None, max_length=120),
) -> ChatThreadBucketCounts:
    """Счётчики для вкладок чата менеджера."""
    if current_user.role not in (UserRole.manager, UserRole.admin):
        return ChatThreadBucketCounts()
    allowed = await _manager_pipeline_ids(db, current_user.id)
    if not allowed:
        return ChatThreadBucketCounts()
    term = (q or "").strip()
    last_direction_sq = (
        select(ChatMessage.direction)
        .where(ChatMessage.thread_id == ChatThread.id)
        .order_by(ChatMessage.id.desc())
        .limit(1)
        .correlate(ChatThread)
        .scalar_subquery()
    )
    base = (
        select(func.count(ChatThread.id))
        .select_from(ChatThread)
        .outerjoin(Lead, Lead.id == ChatThread.lead_id)
        .where(
            ChatThread.company_id == company_id,
            ChatThread.provider != "internal",
            ChatThread.pipeline_id.in_(allowed),
            manager_lead_visibility(current_user.id),
        )
    )
    if term:
        base = _apply_thread_search(base, term=term)
    out = ChatThreadBucketCounts()
    for bucket in ("transferred", "own", "awaiting_reply", "sold"):
        qcnt = _apply_manager_thread_bucket(
            base,
            bucket=bucket,  # type: ignore[arg-type]
            manager_id=current_user.id,
            company_id=company_id,
            last_direction_sq=last_direction_sq,
        )
        cnt = int((await db.execute(qcnt)).scalar_one() or 0)
        setattr(out, bucket, cnt)
    return out


@router.get("/threads", response_model=list[ChatThreadRead])
async def list_threads(
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentUser,
    company_id: CurrentCompanyId,
    q: str | None = Query(default=None, max_length=120),
    bucket: ChatThreadBucket | None = Query(
        default=None,
        description="Вкладка для менеджера: transferred | own | awaiting_reply | sold",
    ),
    limit: int | None = Query(default=None, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
) -> list[ChatThreadRead]:
    if current_user.role not in (UserRole.owner, UserRole.manager, UserRole.admin, UserRole.expert):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Managers only")
    term = (q or "").strip()
    first_message_at_sq = (
        select(func.min(ChatMessage.created_at))
        .where(ChatMessage.thread_id == ChatThread.id)
        .correlate(ChatThread)
        .scalar_subquery()
    )
    last_direction_sq = (
        select(ChatMessage.direction)
        .where(ChatMessage.thread_id == ChatThread.id)
        .order_by(ChatMessage.id.desc())
        .limit(1)
        .correlate(ChatThread)
        .scalar_subquery()
    )
    unread_count_sq = (
        select(func.count(ChatMessage.id))
        .select_from(ChatMessage)
        .outerjoin(
            ChatThreadUserRead,
            and_(
                ChatThreadUserRead.thread_id == ChatThread.id,
                ChatThreadUserRead.user_id == current_user.id,
            ),
        )
        .where(
            ChatMessage.thread_id == ChatThread.id,
            ChatMessage.direction == "in",
            ChatMessage.id > func.coalesce(ChatThreadUserRead.last_read_message_id, 0),
        )
        .correlate(ChatThread)
        .scalar_subquery()
    )
    is_manager_view = current_user.role in (UserRole.manager, UserRole.admin)
    transferred_sq = None
    if is_manager_view:
        transferred_sq = _lead_transferred_to_manager_exists(
            Lead.id,
            manager_id=current_user.id,
            company_id=company_id,
        )
    select_cols = [
        ChatThread.id,
        ChatThread.lead_id,
        Lead.name,
        Lead.phone,
        Lead.manager_id.label("manager_id"),
        func.coalesce(User.full_name, User.email).label("manager_name"),
        ChatThread.provider,
        ChatThread.external_chat_id,
        ChatThread.title,
        ChatThread.pipeline_id,
        ChatThread.updated_at,
        first_message_at_sq.label("first_message_at"),
        last_direction_sq.label("last_message_direction"),
        unread_count_sq.label("unread_count"),
    ]
    if transferred_sq is not None:
        select_cols.append(case((transferred_sq, True), else_=False).label("is_transferred"))
    query = (
        select(*select_cols)
        .outerjoin(Lead, Lead.id == ChatThread.lead_id)
        .outerjoin(User, User.id == Lead.manager_id)
        .where(ChatThread.company_id == company_id, ChatThread.provider != "internal")
    )
    if is_manager_view:
        allowed = await _manager_pipeline_ids(db, current_user.id)
        if not allowed:
            return []
        query = query.where(
            ChatThread.pipeline_id.in_(allowed),
            manager_lead_visibility(current_user.id),
        )
        query = _apply_manager_thread_bucket(
            query,
            bucket=bucket,
            manager_id=current_user.id,
            company_id=company_id,
            last_direction_sq=last_direction_sq,
        )
    if current_user.role == UserRole.expert:
        allowed = await _expert_pipeline_ids(db, user_id=current_user.id, company_id=company_id)
        if not allowed:
            return []
        query = query.where(ChatThread.pipeline_id.in_(allowed))
    if term:
        query = _apply_thread_search(query, term=term)
    # Сначала диалоги, где последнее сообщение от клиента (ждём ответ), затем по свежести.
    needs_reply = case((last_direction_sq == "in", 1), else_=0)
    query = query.order_by(needs_reply.desc(), ChatThread.updated_at.desc(), ChatThread.id.desc())
    if offset > 0:
        query = query.offset(offset)
    if limit is not None:
        query = query.limit(limit)
    rows = (await db.execute(query)).all()
    lead_ids = [int(row.lead_id) for row in rows if getattr(row, "lead_id", None) is not None]
    sale_info = await _sale_info_by_lead_ids(db, company_id=company_id, lead_ids=lead_ids)

    out: list[ChatThreadRead] = []
    for row in rows:
        ext_chat = row.external_chat_id
        raw_phone = (row.phone if getattr(row, "phone", None) else None) or _phone_from_external_chat_id(ext_chat)
        phone_val, phone_display, can_view_phone = await resolve_phone_fields(
            db,
            current_user,
            row.pipeline_id,
            raw_phone,
        )
        if current_user.role == UserRole.manager and ext_chat and not can_view_phone:
            ext_chat = mask_patient_phone(ext_chat.split("@")[0] if "@" in ext_chat else ext_chat)
        sale = sale_info.get(int(row.lead_id)) if row.lead_id is not None else None
        out.append(
            ChatThreadRead(
                id=int(row.id),
                lead_id=row.lead_id,
                lead_name=row.name,
                lead_phone=phone_val if phone_val is not None else (phone_display if phone_display != "—" else None),
                lead_phone_display=phone_display,
                lead_phone_can_view_full=can_view_phone,
                manager_id=getattr(row, "manager_id", None),
                manager_name=getattr(row, "manager_name", None),
                provider=row.provider,
                external_chat_id=ext_chat,
                title=row.title,
                pipeline_id=row.pipeline_id,
                updated_at=row.updated_at,
                unread_count=int(row.unread_count or 0),
                first_message_at=row.first_message_at,
                last_message_direction=row.last_message_direction,
                is_transferred=bool(getattr(row, "is_transferred", False)),
                sale_service_title=sale.get("service") if sale else None,
                sale_amount=sale.get("amount") if sale else None,
                sale_paid_amount=sale.get("paid") if sale else None,
            )
        )
    return out


@router.get("/threads/by-lead/{lead_id}", response_model=ChatThreadRead)
async def get_thread_by_lead(
    lead_id: int,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentUser,
    company_id: CurrentCompanyId,
) -> ChatThreadRead:
    """Открытие чата из карточки лида — не зависит от вкладки и пагинации списка."""
    if current_user.role not in (UserRole.owner, UserRole.manager, UserRole.admin, UserRole.expert):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Managers only")

    lead = await db.get(Lead, lead_id)
    if lead is None or lead.company_id != company_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Лид не найден")

    thread = (
        await db.execute(
            select(ChatThread)
            .where(
                ChatThread.company_id == company_id,
                ChatThread.lead_id == lead_id,
                ChatThread.provider != "internal",
            )
            .order_by(ChatThread.updated_at.desc(), ChatThread.id.desc())
            .limit(1),
        )
    ).scalars().first()
    if thread is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="У этого клиента пока нет переписки в «Чатах» (WhatsApp / мессенджеры)",
        )

    await _assert_thread_access(db, thread, current_user)

    first_message_at_sq = (
        select(func.min(ChatMessage.created_at))
        .where(ChatMessage.thread_id == ChatThread.id)
        .correlate(ChatThread)
        .scalar_subquery()
    )
    last_direction_sq = (
        select(ChatMessage.direction)
        .where(ChatMessage.thread_id == ChatThread.id)
        .order_by(ChatMessage.id.desc())
        .limit(1)
        .correlate(ChatThread)
        .scalar_subquery()
    )
    unread_count_sq = (
        select(func.count(ChatMessage.id))
        .select_from(ChatMessage)
        .outerjoin(
            ChatThreadUserRead,
            and_(
                ChatThreadUserRead.thread_id == ChatThread.id,
                ChatThreadUserRead.user_id == current_user.id,
            ),
        )
        .where(
            ChatMessage.thread_id == ChatThread.id,
            ChatMessage.direction == "in",
            ChatMessage.id > func.coalesce(ChatThreadUserRead.last_read_message_id, 0),
        )
        .correlate(ChatThread)
        .scalar_subquery()
    )
    transferred_sq = None
    if current_user.role in (UserRole.manager, UserRole.admin):
        transferred_sq = _lead_transferred_to_manager_exists(
            Lead.id,
            manager_id=current_user.id,
            company_id=company_id,
        )

    select_cols = [
        ChatThread.id,
        ChatThread.lead_id,
        Lead.name,
        Lead.phone,
        Lead.manager_id.label("manager_id"),
        func.coalesce(User.full_name, User.email).label("manager_name"),
        ChatThread.provider,
        ChatThread.external_chat_id,
        ChatThread.title,
        ChatThread.pipeline_id,
        ChatThread.updated_at,
        first_message_at_sq.label("first_message_at"),
        last_direction_sq.label("last_message_direction"),
        unread_count_sq.label("unread_count"),
    ]
    if transferred_sq is not None:
        select_cols.append(case((transferred_sq, True), else_=False).label("is_transferred"))

    row = (
        await db.execute(
            select(*select_cols)
            .select_from(ChatThread)
            .outerjoin(Lead, Lead.id == ChatThread.lead_id)
            .outerjoin(User, User.id == Lead.manager_id)
            .where(ChatThread.id == thread.id, ChatThread.company_id == company_id),
        )
    ).one()

    sale_info = await _sale_info_by_lead_ids(db, company_id=company_id, lead_ids=[lead_id])
    ext_chat = row.external_chat_id
    raw_phone = (row.phone if getattr(row, "phone", None) else None) or _phone_from_external_chat_id(ext_chat)
    phone_val, phone_display, can_view_phone = await resolve_phone_fields(
        db,
        current_user,
        row.pipeline_id,
        raw_phone,
    )
    if current_user.role == UserRole.manager and ext_chat and not can_view_phone:
        ext_chat = mask_patient_phone(ext_chat.split("@")[0] if "@" in ext_chat else ext_chat)
    sale = sale_info.get(lead_id)
    return ChatThreadRead(
        id=int(row.id),
        lead_id=row.lead_id,
        lead_name=row.name,
        lead_phone=phone_val if phone_val is not None else (phone_display if phone_display != "—" else None),
        lead_phone_display=phone_display,
        lead_phone_can_view_full=can_view_phone,
        manager_id=getattr(row, "manager_id", None),
        manager_name=getattr(row, "manager_name", None),
        provider=row.provider,
        external_chat_id=ext_chat,
        title=row.title,
        pipeline_id=row.pipeline_id,
        updated_at=row.updated_at,
        unread_count=int(row.unread_count or 0),
        first_message_at=row.first_message_at,
        last_message_direction=row.last_message_direction,
        is_transferred=bool(getattr(row, "is_transferred", False)),
        sale_service_title=sale.get("service") if sale else None,
        sale_amount=sale.get("amount") if sale else None,
        sale_paid_amount=sale.get("paid") if sale else None,
    )


@router.get("/threads/{thread_id}/messages", response_model=list[ChatMessageRead])
async def list_messages(
    thread_id: int,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentUser,
    company_id: CurrentCompanyId,
    limit: int = Query(default=120, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
) -> list[ChatMessageRead]:
    thread = await db.get(ChatThread, thread_id)
    if thread is None or thread.company_id != company_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Thread not found")
    await _assert_thread_access(db, thread, current_user)
    # Последние `limit` сообщений (offset от самых новых), в ответе — по возрастанию id для UI.
    # Раньше брались самые старые записи: при >limit сообщений в чате новые не попадали в выборку.
    rows = (
        await db.execute(
            select(ChatMessage)
            .where(
                ChatMessage.thread_id == thread_id,
                or_(ChatMessage.company_id == company_id, ChatMessage.company_id.is_(None)),
            )
            .order_by(ChatMessage.id.desc())
            .offset(offset)
            .limit(limit)
        )
    ).scalars().all()
    rows_chronological = list(reversed(rows))
    await _mark_thread_read_up_to_latest(db, user_id=current_user.id, thread_id=thread_id)
    return [_msg_read(m) for m in rows_chronological]


@router.get("/messages/{message_id}/media")
async def get_message_media(
    message_id: int,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentUser,
    company_id: CurrentCompanyId,
):
    msg = await db.get(ChatMessage, message_id)
    if msg is None or msg.company_id != company_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Message not found")
    thread = await db.get(ChatThread, msg.thread_id)
    if thread is None or thread.company_id != company_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Thread not found")
    await _assert_thread_access(db, thread, current_user)
    fpath = resolve_chat_media(message_id)
    if fpath is None or not fpath.exists():
        await ensure_chat_message_media_local(db, msg=msg, thread=thread)
        fpath = resolve_chat_media(message_id)
    if fpath is None or not fpath.exists():
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Media not found")
    media_type = (msg.media_mime or "").strip() or mimetypes.guess_type(fpath.name)[0] or "application/octet-stream"
    return FileResponse(path=fpath, media_type=media_type, filename=msg.file_name or fpath.name)


@router.post("/threads/{thread_id}/messages/attachment", response_model=ChatMessageRead)
async def send_message_attachment(
    thread_id: int,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentUser,
    company_id: CurrentCompanyId,
    file: UploadFile = File(...),
    text: str = Form(""),
) -> ChatMessageRead:
    """Файл/голос через стандартный multipart (File/Form) — надёжнее, чем ручной request.form()."""
    file_bytes = await file.read()
    if not file_bytes:
        logger.warning(
            "chat attachment empty read thread=%s filename=%s content_type=%s",
            thread_id,
            file.filename,
            file.content_type,
        )
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Голосовое не дошло или файл пустой. Запишите подольше или обновите страницу.",
        )
    thread, cfg, chat_id = await _resolve_green_send(db, thread_id, company_id, current_user)
    caption = (text or "").strip()
    return await _send_green_file_message(
        db,
        thread=thread,
        cfg=cfg,
        chat_id=chat_id,
        current_user=current_user,
        file_bytes=file_bytes,
        filename=file.filename or "file",
        file_content_type=file.content_type,
        caption=caption,
    )


@router.post("/threads/{thread_id}/messages", response_model=ChatMessageRead)
async def send_message(
    thread_id: int,
    request: Request,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentUser,
    company_id: CurrentCompanyId,
) -> ChatMessageRead:
    ct_raw = request.headers.get("content-type") or ""
    ct_lower = ct_raw.lower()
    file_bytes: bytes | None = None
    filename: str | None = None
    file_content_type: str | None = None
    caption: str = ""
    plain_text: str = ""
    file_attempted = False
    up: object | None = None

    if ct_lower.startswith("application/json"):
        body = SendMessageBody.model_validate(await request.json())
        plain_text = body.text.strip()
    elif ct_lower.startswith("multipart/form-data"):
        form = await request.form()
        caption = str(form.get("text") or form.get("caption") or "").strip()
        up = form.get("file")
        if up is not None:
            file_attempted = True
        if isinstance(up, UploadFile):
            file_bytes = await up.read()
            filename = up.filename or "file"
            file_content_type = up.content_type
        plain_text = caption
    else:
        raise HTTPException(
            status_code=status.HTTP_415_UNSUPPORTED_MEDIA_TYPE,
            detail="Ожидается application/json или multipart/form-data",
        )

    thread, cfg, chat_id = await _resolve_green_send(db, thread_id, company_id, current_user)

    if file_bytes and len(file_bytes) > 0:
        return await _send_green_file_message(
            db,
            thread=thread,
            cfg=cfg,
            chat_id=chat_id,
            current_user=current_user,
            file_bytes=file_bytes,
            filename=filename or "file",
            file_content_type=file_content_type,
            caption=caption,
        )
    if file_attempted:
        logger.warning(
            "chat multipart file empty or not parsed thread=%s content_type=%r up_type=%s",
            thread_id,
            ct_raw,
            type(up).__name__ if up is not None else "none",
        )
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Голосовое не дошло или файл пустой. Для вложений используйте обновлённый клиент или запишите ещё раз.",
        )
    if not plain_text:
        logger.warning("chat empty text thread=%s", thread_id)
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Пустое сообщение")
    from app.services.chat_outbound_policy import outbound_message_allowed

    allowed_phones = await _thread_allowed_outbound_phones(db, thread)
    allowed, policy_err = outbound_message_allowed(
        current_user,
        plain_text,
        allowed_outbound_phones=allowed_phones,
    )
    if not allowed:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=policy_err or "Сообщение запрещено")
    ok, err, provider_msg_id = await send_green_text_async(cfg, chat_id, plain_text)
    if not ok:
        msg = ChatMessage(
            company_id=thread.company_id,
            thread_id=thread.id,
            author_user_id=current_user.id,
            direction="out",
            text=plain_text,
            message_type="text",
            delivery_status="failed",
            created_at=datetime.now(UTC),
        )
        db.add(msg)
        thread.updated_at = datetime.now(UTC)
        await db.flush()
        d = f"Send failed: {err}"
        logger.warning("chat green text failed thread=%s detail=%s", thread_id, d[:800])
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=d)
    msg = ChatMessage(
        company_id=thread.company_id,
        thread_id=thread.id,
        author_user_id=current_user.id,
        direction="out",
        text=plain_text,
        message_type="text",
        delivery_status="sent",
        provider_message_id=provider_msg_id,
        created_at=datetime.now(UTC),
    )
    db.add(msg)
    thread.updated_at = datetime.now(UTC)
    await db.flush()
    await db.refresh(msg)
    await _mark_thread_read_up_to_latest(db, user_id=current_user.id, thread_id=thread.id)
    return _msg_read(msg)
