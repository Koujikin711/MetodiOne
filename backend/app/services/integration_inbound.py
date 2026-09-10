"""Создание лидов, тредов и входящих сообщений из интеграций (webhook, backfill)."""

from __future__ import annotations

import re
from datetime import UTC, datetime

from sqlalchemy import and_, case, select, text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import (
    ChatMessage,
    ChatThread,
    Integration,
    Lead,
    LeadSource,
    Pipeline,
    PipelineStage,
)
from app.services.chat_thread_dedup import normalize_whatsapp_chat_id
from app.services.chat_thread_state import touch_thread_on_message
from app.services.lead_assignment import assign_manager_for_new_lead
from app.services.lead_extra_phones import find_lead_by_any_phone
from app.services.lead_sales_stages import resolve_new_lead_stage_id
from app.services.phone_match import phones_equivalent, whatsapp_e164_digits


def norm_phone(raw: str | None) -> str | None:
    if not raw:
        return None
    digits = re.sub(r"\D+", "", raw)
    return digits or None


async def ensure_source_exists(db: AsyncSession, company_id: int, name: str) -> None:
    existing = await db.scalar(select(LeadSource.id).where(LeadSource.company_id == company_id, LeadSource.name == name))
    if existing is None:
        db.add(LeadSource(name=name, is_active=True, company_id=company_id))
        await db.flush()


async def find_existing_lead(
    db: AsyncSession,
    *,
    company_id: int,
    phone: str | None,
    source_name: str,
    pipeline_id: int,
    external_chat_id: str | None = None,
    thread_provider: str | None = None,
) -> Lead | None:
    """Один WhatsApp/чат и один телефон в воронке → один лид (источник не дробит карточку)."""
    ext = (external_chat_id or "").strip() or None
    # 1) Уже есть тред с этим chatId (даже у «ручного» / «Гость» лида).
    if ext and thread_provider:
        res = await db.execute(
            select(Lead)
            .join(ChatThread, ChatThread.lead_id == Lead.id)
            .join(PipelineStage, PipelineStage.id == Lead.status_id)
            .where(
                and_(
                    Lead.company_id == company_id,
                    ChatThread.company_id == company_id,
                    ChatThread.provider == thread_provider,
                    ChatThread.external_chat_id == ext,
                ),
            )
            .order_by(
                case((PipelineStage.pipeline_id == pipeline_id, 0), else_=1),
                Lead.id.desc(),
            )
            .limit(1),
        )
        found = res.scalars().first()
        if found is not None:
            return found

    # 2) Телефон: сначала воронка интеграции, затем вся компания (один номер ≠ две карточки).
    if phone:
        found = await find_lead_by_any_phone(
            db,
            company_id=company_id,
            phone=phone,
            pipeline_id=pipeline_id,
        )
        if found is not None:
            return found
        found = await find_lead_by_any_phone(
            db,
            company_id=company_id,
            phone=phone,
            pipeline_id=None,
        )
        if found is not None:
            return found
    return None


async def create_lead_from_integration(
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
    assign_manager: bool = True,
) -> tuple[Lead, bool]:
    """Возвращает (lead, created)."""
    await ensure_source_exists(db, company_id, source_name)
    norm = norm_phone(phone)
    existing = await find_existing_lead(
        db,
        company_id=company_id,
        phone=norm,
        source_name=source_name,
        pipeline_id=integ.pipeline_id,
        external_chat_id=(external_chat_id or "").strip() or None,
        thread_provider=thread_provider,
    )
    if existing is not None:
        name_s = name.strip()
        if name_s:
            cur = (existing.name or "").strip()
            # Подставляем имя из WA, если было пусто / техническое / номер.
            if (
                not cur
                or cur in ("Лид", "Клиент", "Гость")
                or (norm and norm_phone(cur) == norm)
            ):
                existing.name = name_s
        if norm and not norm_phone(existing.phone):
            existing.phone = norm
        if not existing.email and (email or "").strip():
            existing.email = (email or "").strip()
        await db.flush()
        await db.refresh(existing, ["stage"])
        return existing, False

    stage_id = await resolve_new_lead_stage_id(
        db,
        pipeline_id=int(integ.pipeline_id),
        preferred_stage_id=int(integ.stage_id) if integ.stage_id else None,
        default_name="Новый",
    )
    if stage_id is None and integ.stage_id:
        stage_id = int(integ.stage_id)
    if stage_id is None:
        stage_id = await db.scalar(
            select(PipelineStage.id).where(PipelineStage.pipeline_id == integ.pipeline_id).limit(1),
        )
    if stage_id is None:
        raise ValueError(f"No stages in pipeline {integ.pipeline_id}")

    lead = Lead(
        company_id=company_id,
        name=name.strip() or "Лид",
        phone=norm,
        email=(email or "").strip() or None,
        source=source_name,
        status_id=stage_id,
        manager_id=None,
    )
    db.add(lead)
    await db.flush()
    await db.refresh(lead, ["stage"])
    if assign_manager:
        pipe = await db.get(Pipeline, int(integ.pipeline_id))
        exclude_id = int(pipe.intake_manager_user_id) if pipe and pipe.intake_manager_user_id is not None else None
        mid = await assign_manager_for_new_lead(db, pipeline_id=integ.pipeline_id, exclude_user_id=exclude_id)
        if mid is not None:
            lead.manager_id = mid
            await db.flush()
    return lead, True


def _apply_thread_meta(
    thread: ChatThread,
    *,
    lead: Lead,
    title: str | None,
    resolved_pipeline_id: int | None,
    ext: str | None,
) -> None:
    thread.updated_at = datetime.now(UTC)
    if thread.lead_id is None:
        thread.lead_id = lead.id
    elif int(thread.lead_id) != int(lead.id):
        old_pipe = int(thread.pipeline_id) if thread.pipeline_id is not None else None
        new_pipe = int(resolved_pipeline_id) if resolved_pipeline_id is not None else None
        if new_pipe is not None and old_pipe != new_pipe:
            thread.lead_id = lead.id
            thread.pipeline_id = new_pipe
            if title:
                thread.title = title
    if int(thread.lead_id or 0) == int(lead.id):
        if title and not thread.title:
            thread.title = title
        if resolved_pipeline_id:
            thread.pipeline_id = int(resolved_pipeline_id)
    elif title and not thread.title:
        thread.title = title
    if resolved_pipeline_id and not thread.pipeline_id:
        thread.pipeline_id = resolved_pipeline_id
    if ext:
        cur = (thread.external_chat_id or "").strip()
        if not cur:
            thread.external_chat_id = ext
        elif cur != ext and phones_equivalent(cur.split("@", 1)[0], ext.split("@", 1)[0]):
            # Канонический 992…@c.us вместо короткого/старого формата.
            if len(ext) >= len(cur):
                thread.external_chat_id = ext


async def _find_thread_by_equivalent_chat(
    db: AsyncSession,
    *,
    company_id: int,
    provider: str,
    ext: str,
) -> ChatThread | None:
    """Ищет green_api-тред с тем же номером в другом написании chatId."""
    if provider != "green_api" or "@c.us" not in ext.lower():
        return None
    want = whatsapp_e164_digits(ext.split("@", 1)[0])
    if len(want) < 9:
        return None
    tail = want[-9:]
    # Короткий локальный и полный E.164 варианты.
    candidates = (
        await db.execute(
            select(ChatThread)
            .where(
                ChatThread.company_id == company_id,
                ChatThread.provider == provider,
                ChatThread.external_chat_id.is_not(None),
                ChatThread.external_chat_id.like(f"%{tail}@c.us"),
            )
            .order_by(ChatThread.id.asc())
            .limit(20),
        )
    ).scalars().all()
    for th in candidates:
        cur = (th.external_chat_id or "").strip()
        if not cur:
            continue
        if phones_equivalent(cur.split("@", 1)[0], want):
            return th
    return None


async def upsert_thread(
    db: AsyncSession,
    *,
    company_id: int,
    lead: Lead,
    provider: str,
    external_chat_id: str | None,
    title: str | None = None,
    pipeline_id: int | None = None,
) -> ChatThread:
    """Один WhatsApp chatId / один lead+provider → один тред (без дублей в «Диалогах»)."""
    resolved_pipeline_id = pipeline_id or (lead.stage.pipeline_id if lead.stage else None)
    raw_ext = (external_chat_id or "").strip() or None
    ext = normalize_whatsapp_chat_id(raw_ext) if provider == "green_api" else raw_ext

    # Сериализуем создание по chatId внутри транзакции (Postgres), чтобы гонка не плодила 2 строки.
    if ext:
        try:
            conn = await db.connection()
            if conn.dialect.name == "postgresql":
                await db.execute(
                    text("SELECT pg_advisory_xact_lock(hashtext(:k))"),
                    {"k": f"chat_thread:{company_id}:{provider}:{ext}"},
                )
        except Exception:
            pass

    # 1) Уже есть WhatsApp/тред у этого лида — не создаём второй диалог.
    by_lead = (
        await db.execute(
            select(ChatThread)
            .where(
                ChatThread.company_id == company_id,
                ChatThread.lead_id == lead.id,
                ChatThread.provider == provider,
            )
            .order_by(ChatThread.id.asc())
            .limit(1),
        )
    ).scalars().first()
    if by_lead is not None:
        _apply_thread_meta(
            by_lead,
            lead=lead,
            title=title,
            resolved_pipeline_id=resolved_pipeline_id,
            ext=ext,
        )
        await db.flush()
        return by_lead

    # 2) Глобально по точному chatId.
    if ext:
        by_chat = (
            await db.execute(
                select(ChatThread)
                .where(
                    ChatThread.company_id == company_id,
                    ChatThread.provider == provider,
                    ChatThread.external_chat_id == ext,
                )
                .order_by(ChatThread.id.asc())
                .limit(1),
            )
        ).scalars().first()
        if by_chat is None and raw_ext and raw_ext != ext:
            by_chat = (
                await db.execute(
                    select(ChatThread)
                    .where(
                        ChatThread.company_id == company_id,
                        ChatThread.provider == provider,
                        ChatThread.external_chat_id == raw_ext,
                    )
                    .order_by(ChatThread.id.asc())
                    .limit(1),
                )
            ).scalars().first()
        if by_chat is None:
            by_chat = await _find_thread_by_equivalent_chat(
                db, company_id=company_id, provider=provider, ext=ext,
            )
        if by_chat is not None:
            _apply_thread_meta(
                by_chat,
                lead=lead,
                title=title,
                resolved_pipeline_id=resolved_pipeline_id,
                ext=ext,
            )
            await db.flush()
            return by_chat

    t = ChatThread(
        company_id=company_id,
        lead_id=lead.id,
        pipeline_id=resolved_pipeline_id,
        provider=provider,
        external_chat_id=ext,
        title=title,
        created_at=datetime.now(UTC),
        updated_at=datetime.now(UTC),
    )
    try:
        async with db.begin_nested():
            db.add(t)
            await db.flush()
    except IntegrityError:
        existing = None
        if ext:
            existing = (
                await db.execute(
                    select(ChatThread)
                    .where(
                        ChatThread.company_id == company_id,
                        ChatThread.provider == provider,
                        ChatThread.external_chat_id == ext,
                    )
                    .order_by(ChatThread.id.asc())
                    .limit(1),
                )
            ).scalars().first()
        if existing is None:
            existing = (
                await db.execute(
                    select(ChatThread)
                    .where(
                        ChatThread.company_id == company_id,
                        ChatThread.lead_id == lead.id,
                        ChatThread.provider == provider,
                    )
                    .order_by(ChatThread.id.asc())
                    .limit(1),
                )
            ).scalars().first()
        if existing is not None:
            _apply_thread_meta(
                existing,
                lead=lead,
                title=title,
                resolved_pipeline_id=resolved_pipeline_id,
                ext=ext,
            )
            await db.flush()
            return existing
        raise
    return t


async def message_exists_by_provider_id(db: AsyncSession, company_id: int, provider_message_id: str | None) -> bool:
    pid = (provider_message_id or "").strip()
    if not pid:
        return False
    q = select(ChatMessage.id).where(
        ChatMessage.company_id == company_id,
        ChatMessage.provider_message_id == pid,
    ).limit(1)
    return (await db.execute(q)).scalar() is not None


async def find_incoming_message_by_provider_id(
    db: AsyncSession,
    company_id: int,
    provider_message_id: str | None,
) -> ChatMessage | None:
    pid = (provider_message_id or "").strip()
    if not pid:
        return None
    return (
        await db.execute(
            select(ChatMessage)
            .where(
                ChatMessage.company_id == company_id,
                ChatMessage.provider_message_id == pid,
                ChatMessage.direction == "in",
            )
            .order_by(ChatMessage.id.desc())
            .limit(1),
        )
    ).scalars().first()


async def add_incoming_message(
    db: AsyncSession,
    company_id: int,
    thread_id: int,
    text: str,
    *,
    message_type: str = "text",
    media_url: str | None = None,
    media_mime: str | None = None,
    file_name: str | None = None,
    provider_message_id: str | None = None,
    created_at: datetime | None = None,
) -> ChatMessage | None:
    """Добавляет входящее сообщение. None — дубликат по provider_message_id."""
    if await message_exists_by_provider_id(db, company_id, provider_message_id):
        return None
    body = (text or "").strip()
    if not body and not media_url:
        return None
    if not body:
        body = " "
    msg = ChatMessage(
        company_id=company_id,
        thread_id=thread_id,
        author_user_id=None,
        direction="in",
        text=body,
        message_type=message_type,
        media_url=media_url,
        media_mime=media_mime,
        file_name=file_name,
        provider_message_id=(provider_message_id or "").strip() or None,
        delivery_status="sent",
        created_at=created_at or datetime.now(UTC),
    )
    db.add(msg)
    thread = await db.get(ChatThread, thread_id)
    if thread is not None:
        touch_thread_on_message(thread, "in")
    await db.flush()
    await db.refresh(msg)
    return msg


async def add_outgoing_message(
    db: AsyncSession,
    company_id: int,
    thread_id: int,
    text: str,
    *,
    provider_message_id: str | None = None,
    created_at: datetime | None = None,
    send_by_api: bool = False,
) -> bool:
    if await message_exists_by_provider_id(db, company_id, provider_message_id):
        return False
    body = (text or "").strip() or " "
    db.add(
        ChatMessage(
            company_id=company_id,
            thread_id=thread_id,
            author_user_id=None,
            direction="out",
            text=body,
            message_type="text",
            provider_message_id=(provider_message_id or "").strip() or None,
            delivery_status="sent",
            created_at=created_at or datetime.now(UTC),
        )
    )
    thread = await db.get(ChatThread, thread_id)
    if thread is not None:
        touch_thread_on_message(thread, "out")
    await db.flush()
    return True
