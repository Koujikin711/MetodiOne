from __future__ import annotations

from datetime import UTC, datetime, timedelta
from zoneinfo import ZoneInfo

from sqlalchemy import and_, exists, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.models import (
    BookingAppointment,
    ChatMessage,
    ChatThread,
    Integration,
    IntegrationProvider,
    Lead,
    PipelineStage,
    SystemAuditEvent,
    User,
)
from app.services.audit import write_audit_event
from app.services.green_api_send import send_green_text

_DEFAULT_TEMPLATES = {
    "greeting": "Здравствуйте, {name}! Спасибо за сообщение.",
    "confirm": "Вы записаны на {date} в {time}. Ответственный менеджер: {manager}.",
    "reminder_24h": "Напоминание: ваша запись {date} в {time}.",
    "reminder_2h": "Через 2 часа запись: {date} в {time}.",
    "reactivation": "Мы давно не общались. Готовы снова помочь вам.",
    "waiting_callback": (
        "Здравствуйте, {name}! Напоминаем: сегодня в {time} ({date}) с вами свяжется менеджер {manager}."
    ),
}


def _templates_from_integration_config(config: dict | None) -> dict[str, str]:
    if not isinstance(config, dict):
        return dict(_DEFAULT_TEMPLATES)
    raw = config.get("templates")
    out = dict(_DEFAULT_TEMPLATES)
    if isinstance(raw, dict):
        for k in _DEFAULT_TEMPLATES:
            v = raw.get(k)
            if isinstance(v, str) and v.strip():
                out[k] = v.strip()
    return out


def _render_template(text: str, ctx: dict[str, str]) -> str:
    out = text
    for k, v in ctx.items():
        out = out.replace("{" + k + "}", v)
    return out


def _chat_id_from_thread_or_phone(thread: ChatThread | None, phone: str | None) -> str | None:
    if thread and thread.external_chat_id:
        return thread.external_chat_id
    if not phone:
        return None
    digits = "".join(ch for ch in phone if ch.isdigit())
    return f"{digits}@c.us" if digits else None


async def _has_event(db: AsyncSession, *, entity_type: str, entity_id: int | None, action: str) -> bool:
    q = select(
        exists().where(
            and_(
                SystemAuditEvent.entity_type == entity_type,
                SystemAuditEvent.entity_id == entity_id,
                SystemAuditEvent.action == action,
            )
        )
    )
    return bool((await db.execute(q)).scalar())


async def _active_green_integration_for_pipeline(db: AsyncSession, pipeline_id: int | None) -> Integration | None:
    if pipeline_id is None:
        return None
    q = (
        select(Integration)
        .where(
            Integration.provider == IntegrationProvider.green_api,
            Integration.is_active.is_(True),
            Integration.pipeline_id == pipeline_id,
        )
        .order_by(Integration.id.desc())
        .limit(1)
    )
    return (await db.execute(q)).scalars().first()


async def _thread_for_lead_green(db: AsyncSession, lead: Lead) -> ChatThread | None:
    q = (
        select(ChatThread)
        .where(
            ChatThread.lead_id == lead.id,
            ChatThread.provider == IntegrationProvider.green_api.value,
        )
        .order_by(ChatThread.id.desc())
        .limit(1)
    )
    return (await db.execute(q)).scalars().first()


async def _log_outgoing_message(
    db: AsyncSession,
    *,
    thread: ChatThread,
    text: str,
    delivery_status: str,
    provider_message_id: str | None,
) -> None:
    db.add(
        ChatMessage(
            thread_id=thread.id,
            author_user_id=None,
            direction="out",
            text=text or " ",
            message_type="text",
            delivery_status=delivery_status,
            provider_message_id=provider_message_id,
            created_at=datetime.now(UTC),
        )
    )
    thread.updated_at = datetime.now(UTC)
    await db.flush()


def _booking_ctx(appt: BookingAppointment, manager_name: str | None) -> dict[str, str]:
    tz = ZoneInfo(settings.booking_timezone)
    local_start = appt.start_at.astimezone(tz)
    return {
        "name": (appt.patient_name or "Клиент").strip() or "Клиент",
        "date": local_start.strftime("%d.%m.%Y"),
        "time": local_start.strftime("%H:%M"),
        "manager": (manager_name or "не назначен").strip() or "не назначен",
    }


async def send_welcome_if_first_incoming(
    db: AsyncSession,
    *,
    lead: Lead,
    thread: ChatThread,
    integration: Integration,
) -> None:
    if await _has_event(db, entity_type="lead", entity_id=lead.id, action="whatsapp_welcome_sent"):
        return
    cfg = integration.config if isinstance(integration.config, dict) else {}
    tpl = _templates_from_integration_config(cfg).get("greeting", _DEFAULT_TEMPLATES["greeting"])
    text = _render_template(
        tpl,
        {
            "name": (lead.name or "Клиент").strip() or "Клиент",
            "date": "",
            "time": "",
            "manager": "",
        },
    ).strip()
    if not text:
        return
    chat_id = _chat_id_from_thread_or_phone(thread, lead.phone)
    if not chat_id:
        return
    ok, err, provider_id = send_green_text(cfg, chat_id, text)
    await _log_outgoing_message(
        db,
        thread=thread,
        text=text,
        delivery_status=("sent" if ok else "failed"),
        provider_message_id=provider_id,
    )
    await write_audit_event(
        db,
        entity_type="lead",
        entity_id=lead.id,
        action="whatsapp_welcome_sent",
        current_user=None,
        details=None if ok else f"send_failed={err}",
    )


async def booking_whatsapp_confirmation_sent(db: AsyncSession, appointment_id: int) -> bool:
    return await _has_event(
        db,
        entity_type="booking_appointment",
        entity_id=appointment_id,
        action="whatsapp_confirm_sent",
    )


async def send_booking_confirmation_if_needed(
    db: AsyncSession,
    *,
    appointment: BookingAppointment,
) -> bool:
    """Отправляет подтверждение записи в WhatsApp. Возвращает True, если сообщение ушло успешно."""
    if appointment.lead_id is None:
        return False
    if await booking_whatsapp_confirmation_sent(db, appointment.id):
        return True
    lead = await db.get(Lead, appointment.lead_id)
    if lead is None:
        return False
    await db.refresh(lead, ["stage"])
    pipeline_id = lead.stage.pipeline_id if lead.stage else None
    integ = await _active_green_integration_for_pipeline(db, pipeline_id)
    if integ is None:
        return False
    thread = await _thread_for_lead_green(db, lead)
    manager = await db.get(User, appointment.responsible_manager_id) if appointment.responsible_manager_id else None
    text = _render_template(
        _templates_from_integration_config(integ.config).get("confirm", _DEFAULT_TEMPLATES["confirm"]),
        _booking_ctx(appointment, manager.full_name if manager else None),
    ).strip()
    if not text:
        return False
    chat_id = _chat_id_from_thread_or_phone(thread, lead.phone)
    if not chat_id:
        return False
    ok, err, provider_id = send_green_text(integ.config or {}, chat_id, text)
    if thread is not None:
        await _log_outgoing_message(
            db,
            thread=thread,
            text=text,
            delivery_status=("sent" if ok else "failed"),
            provider_message_id=provider_id,
        )
    await write_audit_event(
        db,
        entity_type="booking_appointment",
        entity_id=appointment.id,
        action="whatsapp_confirm_sent",
        current_user=None,
        details=None if ok else f"send_failed={err}",
    )
    return bool(ok)


async def run_whatsapp_reminder_tick(db: AsyncSession) -> int:
    now = datetime.now(UTC)
    window_24_from = now + timedelta(hours=23, minutes=45)
    window_24_to = now + timedelta(hours=24, minutes=15)
    window_2_from = now + timedelta(hours=1, minutes=45)
    window_2_to = now + timedelta(hours=2, minutes=15)

    q = (
        select(BookingAppointment)
        .where(
            BookingAppointment.status == "booked",
            BookingAppointment.start_at >= now + timedelta(minutes=90),
            BookingAppointment.start_at <= now + timedelta(hours=25),
            BookingAppointment.lead_id.is_not(None),
        )
        .order_by(BookingAppointment.start_at.asc())
    )
    appointments = (await db.execute(q)).scalars().all()
    sent = 0
    for appt in appointments:
        action = None
        template_key = None
        if window_24_from <= appt.start_at <= window_24_to:
            action = "whatsapp_reminder_24h_sent"
            template_key = "reminder_24h"
        elif window_2_from <= appt.start_at <= window_2_to:
            action = "whatsapp_reminder_2h_sent"
            template_key = "reminder_2h"
        if action is None:
            continue
        if await _has_event(
            db,
            entity_type="booking_appointment",
            entity_id=appt.id,
            action=action,
        ):
            continue

        lead = await db.get(Lead, appt.lead_id)
        if lead is None:
            continue
        await db.refresh(lead, ["stage"])
        pipeline_id = lead.stage.pipeline_id if lead.stage else None
        integ = await _active_green_integration_for_pipeline(db, pipeline_id)
        if integ is None:
            continue
        thread = await _thread_for_lead_green(db, lead)
        if thread is None:
            continue
        manager = await db.get(User, appt.responsible_manager_id) if appt.responsible_manager_id else None
        text = _render_template(
            _templates_from_integration_config(integ.config).get(template_key, _DEFAULT_TEMPLATES[template_key]),
            _booking_ctx(appt, manager.full_name if manager else None),
        ).strip()
        if not text:
            continue
        chat_id = _chat_id_from_thread_or_phone(thread, lead.phone)
        if not chat_id:
            continue
        ok, err, provider_id = send_green_text(integ.config or {}, chat_id, text)
        await _log_outgoing_message(
            db,
            thread=thread,
            text=text,
            delivery_status=("sent" if ok else "failed"),
            provider_message_id=provider_id,
        )
        await write_audit_event(
            db,
            entity_type="booking_appointment",
            entity_id=appt.id,
            action=action,
            current_user=None,
            details=None if ok else f"send_failed={err}",
        )
        sent += 1
    return sent

