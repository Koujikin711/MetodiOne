from datetime import UTC, datetime
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Request, UploadFile, status
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import CurrentUser
from app.database import get_db
from app.models import (
    ChatMessage,
    ChatThread,
    ChatThreadUserRead,
    Integration,
    IntegrationProvider,
    Lead,
    UserPipelineAssignment,
    UserRole,
)
from app.services.audio_prepare import prepare_file_for_green_whatsapp
from app.services.green_api_send import send_green_file_upload, send_green_text

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
    rows = await db.execute(select(UserPipelineAssignment.pipeline_id).where(UserPipelineAssignment.user_id == user_id))
    return {r[0] for r in rows.all()}


async def _assert_thread_access(db: AsyncSession, thread: ChatThread, current_user) -> None:
    if current_user.role == UserRole.owner:
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


@router.get("/threads", response_model=list[ChatThreadRead])
async def list_threads(
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentUser,
) -> list[ChatThreadRead]:
    if current_user.role not in (UserRole.owner, UserRole.manager, UserRole.admin):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Managers only")
    if current_user.role in (UserRole.manager, UserRole.admin):
        allowed = await _manager_pipeline_ids(db, current_user.id)
        if not allowed:
            return []
        q = (
            select(ChatThread)
            .join(Lead, Lead.id == ChatThread.lead_id)
            .where(
                ChatThread.pipeline_id.in_(allowed),
                Lead.manager_id == current_user.id,
            )
            .order_by(ChatThread.updated_at.desc(), ChatThread.id.desc())
        )
    else:
        q = select(ChatThread).order_by(ChatThread.updated_at.desc(), ChatThread.id.desc())
    rows = (await db.execute(q)).scalars().all()
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
            )
        )
    return out


@router.get("/threads/{thread_id}/messages", response_model=list[ChatMessageRead])
async def list_messages(
    thread_id: int,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentUser,
) -> list[ChatMessageRead]:
    thread = await db.get(ChatThread, thread_id)
    if thread is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Thread not found")
    await _assert_thread_access(db, thread, current_user)
    rows = (await db.execute(select(ChatMessage).where(ChatMessage.thread_id == thread_id).order_by(ChatMessage.id.asc()))).scalars().all()
    await _mark_thread_read_up_to_latest(db, user_id=current_user.id, thread_id=thread_id)
    return [_msg_read(m) for m in rows]


@router.post("/threads/{thread_id}/messages", response_model=ChatMessageRead)
async def send_message(
    thread_id: int,
    request: Request,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentUser,
) -> ChatMessageRead:
    thread = await db.get(ChatThread, thread_id)
    if thread is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Thread not found")
    await _assert_thread_access(db, thread, current_user)

    status_name = "sent"
    provider_msg_id = None
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
                Integration.pipeline_id == (thread.pipeline_id or 0),
            )
            .limit(1),
        )
    ).scalars().first()
    if integ is None:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="No active GREEN API integration for thread pipeline")

    cfg = integ.config or {}
    ct = request.headers.get("content-type", "")
    file_bytes: bytes | None = None
    filename: str | None = None
    file_content_type: str | None = None
    caption: str = ""
    plain_text: str = ""
    file_attempted = False

    if "application/json" in ct:
        body = SendMessageBody.model_validate(await request.json())
        plain_text = body.text.strip()
        file_bytes = None
    else:
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

    if file_bytes and len(file_bytes) > 0:
        try:
            file_bytes, filename = await prepare_file_for_green_whatsapp(
                file_bytes,
                filename or "file",
                file_content_type,
            )
        except RuntimeError as e:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e)) from e
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
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"Send failed: {err}")
        mtype = "document"
        if filename:
            low = filename.lower()
            if any(low.endswith(x) for x in (".jpg", ".jpeg", ".png", ".gif", ".webp")):
                mtype = "image"
            elif any(low.endswith(x) for x in (".mp4", ".webm", ".mov")):
                mtype = "video"
            elif any(low.endswith(x) for x in (".ogg", ".mp3", ".m4a", ".opus", ".wav", ".aac", ".amr")):
                mtype = "audio"
        msg = ChatMessage(
            thread_id=thread.id,
            author_user_id=current_user.id,
            direction="out",
            text=caption or "📎 Файл",
            message_type=mtype,
            delivery_status=status_name,
            provider_message_id=provider_msg_id,
            file_name=filename,
            created_at=datetime.now(UTC),
        )
    elif file_attempted:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Голосовое не дошло или файл пустой. Запишите подольше или обновите страницу.",
        )
    else:
        if not plain_text:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Пустое сообщение")
        ok, err, provider_msg_id = send_green_text(cfg, chat_id, plain_text)
        if not ok:
            msg = ChatMessage(
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
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"Send failed: {err}")
        msg = ChatMessage(
            thread_id=thread.id,
            author_user_id=current_user.id,
            direction="out",
            text=plain_text,
            message_type="text",
            delivery_status=status_name,
            provider_message_id=provider_msg_id,
            created_at=datetime.now(UTC),
        )
    db.add(msg)
    thread.updated_at = datetime.now(UTC)
    await db.flush()
    await db.refresh(msg)
    await _mark_thread_read_up_to_latest(db, user_id=current_user.id, thread_id=thread.id)
    return _msg_read(msg)
