import logging
import mimetypes
from datetime import UTC, datetime
from typing import Annotated

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, Request, UploadFile, status
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field
from sqlalchemy import exists, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import CurrentCompanyId, CurrentUser
from app.database import get_db
from app.models import (
    ChatMessage,
    ChatThread,
    ChatThreadUserRead,
    Integration,
    IntegrationProvider,
    Lead,
    Pipeline,
    User,
    UserPipelineAssignment,
    UserRole,
)
from app.services.audio_prepare import prepare_file_for_green_whatsapp
from app.services.chat_media_store import resolve_outgoing_chat_media, save_outgoing_chat_media
from app.services.green_api_send import send_green_file_upload, send_green_text

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/chat", tags=["chat"])


class ChatThreadRead(BaseModel):
    id: int
    lead_id: int | None = None
    lead_name: str | None = None
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
    row = ChatThreadUserRead(user_id=user_id, thread_id=thread_id, last_read_message_id=last_id)
    db.add(row)
    await db.flush()
    return row


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
        db.add(ChatThreadUserRead(user_id=user_id, thread_id=thread_id, last_read_message_id=last_id))
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

    chat_id = thread.external_chat_id or ""
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


@router.get("/threads", response_model=list[ChatThreadRead])
async def list_threads(
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentUser,
    company_id: CurrentCompanyId,
    q: str | None = Query(default=None, max_length=120),
    limit: int | None = Query(default=None, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
) -> list[ChatThreadRead]:
    if current_user.role not in (UserRole.owner, UserRole.manager, UserRole.admin, UserRole.expert):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Managers only")
    term = (q or "").strip()
    query = select(ChatThread).outerjoin(Lead, Lead.id == ChatThread.lead_id).where(ChatThread.company_id == company_id)
    if current_user.role in (UserRole.manager, UserRole.admin):
        allowed = await _manager_pipeline_ids(db, current_user.id)
        if not allowed:
            return []
        query = query.where(
            ChatThread.pipeline_id.in_(allowed),
            Lead.manager_id == current_user.id,
        )
    if current_user.role == UserRole.expert:
        allowed = await _expert_pipeline_ids(db, user_id=current_user.id, company_id=company_id)
        if not allowed:
            return []
        query = query.where(ChatThread.pipeline_id.in_(allowed))
    if term:
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
                ]
            )
        query = query.where(or_(*conds))
    query = query.order_by(ChatThread.updated_at.desc(), ChatThread.id.desc())
    if offset > 0:
        query = query.offset(offset)
    if limit is not None:
        query = query.limit(limit)
    rows = (await db.execute(query)).scalars().unique().all()
    thread_ids = [t.id for t in rows]
    first_map: dict[int, datetime] = {}
    last_dir_map: dict[int, str | None] = {}
    if thread_ids:
        fr = await db.execute(
            select(ChatMessage.thread_id, func.min(ChatMessage.created_at))
            .where(ChatMessage.thread_id.in_(thread_ids))
            .group_by(ChatMessage.thread_id)
        )
        first_map = {int(tid): ts for tid, ts in fr.all() if tid is not None and ts is not None}
        mx_rows = (
            await db.execute(
                select(ChatMessage.thread_id, func.max(ChatMessage.id))
                .where(ChatMessage.thread_id.in_(thread_ids))
                .group_by(ChatMessage.thread_id)
            )
        ).all()
        max_ids = [mid for _tid, mid in mx_rows if mid is not None]
        if max_ids:
            dir_rows = (
                await db.execute(select(ChatMessage.id, ChatMessage.direction).where(ChatMessage.id.in_(max_ids)))
            ).all()
            id_to_dir = {int(mid): d for mid, d in dir_rows}
            for tid, mid in mx_rows:
                if tid is None or mid is None:
                    continue
                last_dir_map[int(tid)] = id_to_dir.get(int(mid))

    out: list[ChatThreadRead] = []
    for t in rows:
        lead_name = None
        if t.lead_id:
            lead = await db.get(Lead, t.lead_id)
            lead_name = lead.name if lead else None
        unread = await _unread_incoming_count(db, user_id=current_user.id, thread_id=t.id)
        out.append(
            ChatThreadRead(
                id=t.id,
                lead_id=t.lead_id,
                lead_name=lead_name,
                provider=t.provider,
                external_chat_id=t.external_chat_id,
                title=t.title,
                pipeline_id=t.pipeline_id,
                updated_at=t.updated_at,
                unread_count=unread,
                first_message_at=first_map.get(t.id),
                last_message_direction=last_dir_map.get(t.id),
            )
        )
    return out


@router.get("/threads/{thread_id}/messages", response_model=list[ChatMessageRead])
async def list_messages(
    thread_id: int,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentUser,
    company_id: CurrentCompanyId,
) -> list[ChatMessageRead]:
    thread = await db.get(ChatThread, thread_id)
    if thread is None or thread.company_id != company_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Thread not found")
    await _assert_thread_access(db, thread, current_user)
    rows = (
        await db.execute(
            select(ChatMessage)
            .where(ChatMessage.company_id == company_id, ChatMessage.thread_id == thread_id)
            .order_by(ChatMessage.id.asc())
        )
    ).scalars().all()
    await _mark_thread_read_up_to_latest(db, user_id=current_user.id, thread_id=thread_id)
    return [_msg_read(m) for m in rows]


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
    fpath = resolve_outgoing_chat_media(message_id)
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
    ok, err, provider_msg_id = send_green_text(cfg, chat_id, plain_text)
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
