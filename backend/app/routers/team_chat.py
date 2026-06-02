"""Внутренний мессенджер сотрудников компании (1:1 диалоги)."""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field
from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import CurrentCompanyId, CurrentUser
from app.database import get_db
from app.models import ChatMessage, ChatThread, ChatThreadUserRead, User, UserRole
from app.routers.chat import ChatMessageRead

router = APIRouter(prefix="/team-chat", tags=["team-chat"])

INTERNAL_PROVIDER = "internal"


class TeamContactRead(BaseModel):
    id: int
    full_name: str | None = None
    email: str
    role: str
    display_name: str


class TeamThreadRead(BaseModel):
    id: int
    peer_user_id: int
    peer_name: str
    peer_role: str
    title: str | None = None
    updated_at: datetime
    unread_count: int = 0
    last_message_text: str | None = None
    last_message_at: datetime | None = None


class TeamThreadCreate(BaseModel):
    peer_user_id: int = Field(..., ge=1)


class TeamMessageCreate(BaseModel):
    text: str = Field(..., min_length=1, max_length=8000)


def _display_name(user: User) -> str:
    return ((user.full_name or "").strip() or user.email).strip()


def _dm_external_id(user_a: int, user_b: int) -> str:
    a, b = sorted((user_a, user_b))
    return f"internal:dm:{a}:{b}"


def _peer_user_id_from_thread(thread: ChatThread, current_user_id: int) -> int | None:
    key = (thread.external_chat_id or "").strip()
    if not key.startswith("internal:dm:"):
        return None
    parts = key.split(":")
    if len(parts) != 4:
        return None
    try:
        u1, u2 = int(parts[2]), int(parts[3])
    except ValueError:
        return None
    if current_user_id == u1:
        return u2
    if current_user_id == u2:
        return u1
    return None


async def _get_active_company_user(db: AsyncSession, user_id: int, company_id: int) -> User:
    user = await db.get(User, user_id)
    if user is None or user.company_id != company_id or not user.is_active:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")
    if user.role == UserRole.super_owner:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Cannot chat with platform admin")
    return user


async def _assert_internal_thread_access(thread: ChatThread, current_user: User) -> None:
    if thread.provider != INTERNAL_PROVIDER:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not an internal thread")
    peer = _peer_user_id_from_thread(thread, current_user.id)
    if peer is None:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Thread access denied")


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
    elif last_id > row.last_read_message_id:
        row.last_read_message_id = last_id


async def _unread_from_others(
    db: AsyncSession,
    *,
    user_id: int,
    thread_id: int,
) -> int:
    r = await db.execute(
        select(ChatThreadUserRead).where(
            ChatThreadUserRead.user_id == user_id,
            ChatThreadUserRead.thread_id == thread_id,
        )
    )
    read_row = r.scalars().first()
    last_id = int(read_row.last_read_message_id) if read_row else 0
    n = await db.scalar(
        select(func.count())
        .select_from(ChatMessage)
        .where(
            ChatMessage.thread_id == thread_id,
            ChatMessage.author_user_id.isnot(None),
            ChatMessage.author_user_id != user_id,
            ChatMessage.id > last_id,
        )
    )
    return int(n or 0)


@router.get("/contacts", response_model=list[TeamContactRead])
async def list_contacts(
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentUser,
    company_id: CurrentCompanyId,
    q: str | None = Query(default=None, max_length=120),
) -> list[TeamContactRead]:
    if current_user.role == UserRole.super_owner:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Company context required")
    term = (q or "").strip().lower()
    query = (
        select(User)
        .where(
            User.company_id == company_id,
            User.is_active.is_(True),
            User.id != current_user.id,
            User.role != UserRole.super_owner,
        )
        .order_by(User.full_name.asc().nulls_last(), User.email.asc())
    )
    users = (await db.execute(query)).scalars().all()
    out: list[TeamContactRead] = []
    for u in users:
        dn = _display_name(u)
        if term and term not in dn.lower() and term not in u.email.lower():
            continue
        out.append(
            TeamContactRead(
                id=u.id,
                full_name=u.full_name,
                email=u.email,
                role=u.role.value if hasattr(u.role, "value") else str(u.role),
                display_name=dn,
            )
        )
    return out


@router.get("/threads", response_model=list[TeamThreadRead])
async def list_threads(
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentUser,
    company_id: CurrentCompanyId,
) -> list[TeamThreadRead]:
    if current_user.role == UserRole.super_owner:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Company context required")
    uid = current_user.id
    pattern_a = f"internal:dm:{uid}:%"
    pattern_b = f"internal:dm:%:{uid}"
    threads = (
        await db.execute(
            select(ChatThread)
            .where(
                ChatThread.company_id == company_id,
                ChatThread.provider == INTERNAL_PROVIDER,
                or_(
                    ChatThread.external_chat_id.like(pattern_a),
                    ChatThread.external_chat_id.like(pattern_b),
                ),
            )
            .order_by(ChatThread.updated_at.desc(), ChatThread.id.desc())
        )
    ).scalars().all()

    out: list[TeamThreadRead] = []
    for thread in threads:
        peer_id = _peer_user_id_from_thread(thread, uid)
        if peer_id is None:
            continue
        peer = await db.get(User, peer_id)
        if peer is None or not peer.is_active:
            continue
        last_msg = (
            await db.execute(
                select(ChatMessage)
                .where(ChatMessage.thread_id == thread.id)
                .order_by(ChatMessage.id.desc())
                .limit(1)
            )
        ).scalars().first()
        unread = await _unread_from_others(db, user_id=uid, thread_id=thread.id)
        out.append(
            TeamThreadRead(
                id=thread.id,
                peer_user_id=peer_id,
                peer_name=_display_name(peer),
                peer_role=peer.role.value if hasattr(peer.role, "value") else str(peer.role),
                title=thread.title,
                updated_at=thread.updated_at,
                unread_count=unread,
                last_message_text=(last_msg.text[:120] if last_msg else None),
                last_message_at=(last_msg.created_at if last_msg else None),
            )
        )
    return out


@router.post("/threads", response_model=TeamThreadRead)
async def get_or_create_thread(
    body: TeamThreadCreate,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentUser,
    company_id: CurrentCompanyId,
) -> TeamThreadRead:
    if current_user.role == UserRole.super_owner:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Company context required")
    if body.peer_user_id == current_user.id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Cannot chat with yourself")
    peer = await _get_active_company_user(db, body.peer_user_id, company_id)
    key = _dm_external_id(current_user.id, peer.id)
    thread = (
        await db.execute(
            select(ChatThread).where(
                ChatThread.company_id == company_id,
                ChatThread.provider == INTERNAL_PROVIDER,
                ChatThread.external_chat_id == key,
            )
        )
    ).scalars().first()
    if thread is None:
        thread = ChatThread(
            company_id=company_id,
            lead_id=None,
            pipeline_id=None,
            provider=INTERNAL_PROVIDER,
            external_chat_id=key,
            title=_display_name(peer),
            updated_at=datetime.now(UTC),
        )
        db.add(thread)
        await db.flush()
        await db.refresh(thread)
    unread = await _unread_from_others(db, user_id=current_user.id, thread_id=thread.id)
    return TeamThreadRead(
        id=thread.id,
        peer_user_id=peer.id,
        peer_name=_display_name(peer),
        peer_role=peer.role.value if hasattr(peer.role, "value") else str(peer.role),
        title=thread.title,
        updated_at=thread.updated_at,
        unread_count=unread,
        last_message_text=None,
        last_message_at=None,
    )


@router.get("/threads/{thread_id}/messages", response_model=list[ChatMessageRead])
async def list_messages(
    thread_id: int,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentUser,
    company_id: CurrentCompanyId,
    limit: int = Query(default=120, ge=1, le=500),
) -> list[ChatMessageRead]:
    thread = await db.get(ChatThread, thread_id)
    if thread is None or thread.company_id != company_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Thread not found")
    await _assert_internal_thread_access(thread, current_user)
    rows = (
        await db.execute(
            select(ChatMessage)
            .where(ChatMessage.thread_id == thread_id)
            .order_by(ChatMessage.id.desc())
            .limit(limit)
        )
    ).scalars().all()
    await _mark_thread_read_up_to_latest(db, user_id=current_user.id, thread_id=thread_id)
    return [
        ChatMessageRead(
            id=m.id,
            thread_id=m.thread_id,
            author_user_id=m.author_user_id,
            direction=m.direction,
            text=m.text,
            message_type=m.message_type,
            media_url=m.media_url,
            media_mime=m.media_mime,
            file_name=m.file_name,
            delivery_status=m.delivery_status,
            created_at=m.created_at,
        )
        for m in reversed(rows)
    ]


@router.post("/threads/{thread_id}/messages", response_model=ChatMessageRead)
async def send_message(
    thread_id: int,
    body: TeamMessageCreate,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentUser,
    company_id: CurrentCompanyId,
) -> ChatMessageRead:
    thread = await db.get(ChatThread, thread_id)
    if thread is None or thread.company_id != company_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Thread not found")
    await _assert_internal_thread_access(thread, current_user)
    text = body.text.strip()
    if not text:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Empty message")
    msg = ChatMessage(
        company_id=company_id,
        thread_id=thread_id,
        author_user_id=current_user.id,
        direction="out",
        text=text,
        message_type="text",
        delivery_status="sent",
    )
    thread.updated_at = datetime.now(UTC)
    db.add(msg)
    await db.flush()
    await db.refresh(msg)
    return ChatMessageRead(
        id=msg.id,
        thread_id=msg.thread_id,
        author_user_id=msg.author_user_id,
        direction=msg.direction,
        text=msg.text,
        message_type=msg.message_type,
        media_url=msg.media_url,
        media_mime=msg.media_mime,
        file_name=msg.file_name,
        delivery_status=msg.delivery_status,
        created_at=msg.created_at,
    )
