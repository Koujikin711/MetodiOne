import json
from datetime import UTC, datetime
from typing import Annotated
from urllib import error as urlerror
from urllib import request as urlrequest

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import CurrentUser
from app.database import get_db
from app.models import ChatMessage, ChatThread, Integration, IntegrationProvider, Lead, PipelineStage, UserPipelineAssignment, UserRole
from app.services.green_api_settings import green_api_base_from_config

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


class ChatMessageRead(BaseModel):
    id: int
    thread_id: int
    author_user_id: int | None = None
    direction: str
    text: str
    delivery_status: str
    created_at: datetime


class SendMessageBody(BaseModel):
    text: str = Field(..., min_length=1, max_length=4000)


async def _manager_pipeline_ids(db: AsyncSession, user_id: int) -> set[int]:
    rows = await db.execute(select(UserPipelineAssignment.pipeline_id).where(UserPipelineAssignment.user_id == user_id))
    return {r[0] for r in rows.all()}


async def _assert_thread_access(db: AsyncSession, thread: ChatThread, current_user) -> None:
    if current_user.role == UserRole.admin:
        return
    if current_user.role != UserRole.manager:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Managers only")
    allowed = await _manager_pipeline_ids(db, current_user.id)
    if thread.pipeline_id not in allowed:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Thread is outside manager directions")


@router.get("/threads", response_model=list[ChatThreadRead])
async def list_threads(
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentUser,
) -> list[ChatThreadRead]:
    if current_user.role not in (UserRole.admin, UserRole.manager):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Managers only")
    q = select(ChatThread).order_by(ChatThread.updated_at.desc(), ChatThread.id.desc())
    if current_user.role == UserRole.manager:
        allowed = await _manager_pipeline_ids(db, current_user.id)
        if not allowed:
            return []
        q = q.where(ChatThread.pipeline_id.in_(allowed))
    rows = (await db.execute(q)).scalars().all()
    out: list[ChatThreadRead] = []
    for t in rows:
        lead_name = None
        if t.lead_id:
            lead = await db.get(Lead, t.lead_id)
            lead_name = lead.name if lead else None
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
    return [
        ChatMessageRead(
            id=m.id,
            thread_id=m.thread_id,
            author_user_id=m.author_user_id,
            direction=m.direction,
            text=m.text,
            delivery_status=m.delivery_status,
            created_at=m.created_at,
        )
        for m in rows
    ]


def _send_green_api(config: dict | None, chat_id: str, text: str) -> tuple[bool, str | None, str | None]:
    cfg = config or {}
    instance_id = cfg.get("instance_id") or cfg.get("instanceId")
    api_token = cfg.get("api_token") or cfg.get("apiToken") or cfg.get("apiTokenInstance")
    if not instance_id or not api_token:
        return False, "Missing GREEN API config: instance_id/api_token", None
    base = green_api_base_from_config(cfg)
    url = f"{base}/waInstance{instance_id}/sendMessage/{api_token}"
    body = json.dumps({"chatId": chat_id, "message": text}).encode("utf-8")
    req = urlrequest.Request(url, data=body, method="POST", headers={"Content-Type": "application/json"})
    try:
        with urlrequest.urlopen(req, timeout=20) as resp:
            raw = resp.read().decode("utf-8") if resp else ""
            data = json.loads(raw) if raw else {}
            return True, None, str(data.get("idMessage") or "")
    except urlerror.HTTPError as e:
        return False, f"GREEN API HTTP {e.code}", None
    except Exception as e:
        return False, str(e), None


@router.post("/threads/{thread_id}/messages", response_model=ChatMessageRead)
async def send_message(
    thread_id: int,
    body: SendMessageBody,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentUser,
) -> ChatMessageRead:
    thread = await db.get(ChatThread, thread_id)
    if thread is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Thread not found")
    await _assert_thread_access(db, thread, current_user)

    status_name = "sent"
    provider_msg_id = None
    if thread.provider == IntegrationProvider.green_api.value:
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
        ok, err, provider_msg_id = _send_green_api(integ.config, chat_id, body.text.strip())
        if not ok:
            status_name = "failed"
            msg = ChatMessage(
                thread_id=thread.id,
                author_user_id=current_user.id,
                direction="out",
                text=body.text.strip(),
                provider_message_id=provider_msg_id,
                delivery_status=status_name,
                created_at=datetime.now(UTC),
            )
            db.add(msg)
            thread.updated_at = datetime.now(UTC)
            await db.flush()
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"Send failed: {err}")
    else:
        # Telegram outgoing можно добавить позже
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Provider send is not implemented yet")

    msg = ChatMessage(
        thread_id=thread.id,
        author_user_id=current_user.id,
        direction="out",
        text=body.text.strip(),
        provider_message_id=provider_msg_id,
        delivery_status=status_name,
        created_at=datetime.now(UTC),
    )
    db.add(msg)
    thread.updated_at = datetime.now(UTC)
    await db.flush()
    await db.refresh(msg)
    return ChatMessageRead(
        id=msg.id,
        thread_id=msg.thread_id,
        author_user_id=msg.author_user_id,
        direction=msg.direction,
        text=msg.text,
        delivery_status=msg.delivery_status,
        created_at=msg.created_at,
    )

