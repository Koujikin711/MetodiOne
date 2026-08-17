"""Тик напоминаний для callback «В ожидании»."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from zoneinfo import ZoneInfo

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Lead, LeadWaitingCallback, Task, TaskStatus, User
from app.services.audit import write_audit_event
from app.services.whatsapp_automation import (
    _active_green_integration_for_pipeline,
    _chat_id_from_thread_or_phone,
    _log_outgoing_message,
    _render_template,
    _templates_from_integration_config,
    _thread_for_lead_green,
)
from app.services.green_api_send import send_green_text

_BOOKING_TZ = ZoneInfo("Asia/Dushanbe")


def _fmt_dt(dt: datetime) -> tuple[str, str]:
    local = dt.astimezone(_BOOKING_TZ) if dt.tzinfo else dt.replace(tzinfo=UTC).astimezone(_BOOKING_TZ)
    return local.strftime("%d.%m.%Y"), local.strftime("%H:%M")


async def run_waiting_callback_tick(db: AsyncSession) -> int:
    """
    - За сутки до scheduled_at → задача менеджеру с Боль.
    - В окне ±7 мин вокруг scheduled_at → WhatsApp клиенту (шаблон waiting_callback).
    """
    now = datetime.now(UTC)
    acted = 0

    # Менеджер: как только до связи осталось ≤24ч (или уже назначено ближе)
    mgr_horizon = now + timedelta(hours=24)
    mgr_rows = (
        await db.execute(
            select(LeadWaitingCallback).where(
                LeadWaitingCallback.status == "scheduled",
                LeadWaitingCallback.manager_notified_at.is_(None),
                LeadWaitingCallback.scheduled_at <= mgr_horizon,
                LeadWaitingCallback.scheduled_at >= now - timedelta(minutes=30),
            ).order_by(LeadWaitingCallback.scheduled_at.asc()).limit(100),
        )
    ).scalars().all()

    for row in mgr_rows:
        if row.manager_id is None:
            row.manager_notified_at = now
            continue
        date_s, time_s = _fmt_dt(row.scheduled_at)
        pain = (row.pain_text or "").strip() or "—"
        hours_left = (row.scheduled_at - now).total_seconds() / 3600.0
        when_line = (
            f"Сегодня ({date_s} в {time_s})"
            if hours_left < 20
            else f"Завтра ({date_s} в {time_s})"
        )
        db.add(
            Task(
                company_id=row.company_id,
                title=f"Связаться с клиентом: {row.client_name}",
                deadline=row.scheduled_at,
                status=TaskStatus.pending,
                assigned_to=row.manager_id,
                created_by_user_id=None,
                description=(
                    f"{when_line} нужно связаться с клиентом.\n"
                    f"Телефон: {row.client_phone or '—'}\n"
                    f"Боль: {pain}"
                ),
                related_lead_id=row.lead_id,
            ),
        )
        row.manager_notified_at = now
        await write_audit_event(
            db,
            entity_type="waiting_callback",
            entity_id=row.id,
            action="waiting_manager_notified",
            current_user=None,
            details=f"lead_id={row.lead_id}, manager_id={row.manager_id}",
        )
        acted += 1

    # Клиент: в момент callback (±7 мин)
    client_from = now - timedelta(minutes=7)
    client_to = now + timedelta(minutes=7)
    client_rows = (
        await db.execute(
            select(LeadWaitingCallback).where(
                LeadWaitingCallback.status == "scheduled",
                LeadWaitingCallback.client_reminder_sent_at.is_(None),
                LeadWaitingCallback.scheduled_at >= client_from,
                LeadWaitingCallback.scheduled_at <= client_to,
            ).order_by(LeadWaitingCallback.scheduled_at.asc()).limit(100),
        )
    ).scalars().all()

    for row in client_rows:
        lead = await db.get(Lead, row.lead_id)
        if lead is None:
            row.client_reminder_sent_at = now
            continue
        await db.refresh(lead, ["stage"])
        pipeline_id = lead.stage.pipeline_id if lead.stage else None
        integ = await _active_green_integration_for_pipeline(db, pipeline_id)
        if integ is None:
            # Нет WhatsApp — помечаем, чтобы не крутить бесконечно
            row.client_reminder_sent_at = now
            await write_audit_event(
                db,
                entity_type="waiting_callback",
                entity_id=row.id,
                action="waiting_client_reminder_skipped",
                current_user=None,
                details="no_green_api_integration",
            )
            acted += 1
            continue

        thread = await _thread_for_lead_green(db, lead)
        manager = await db.get(User, row.manager_id) if row.manager_id else None
        date_s, time_s = _fmt_dt(row.scheduled_at)
        tpl = _templates_from_integration_config(integ.config).get(
            "waiting_callback",
            "Здравствуйте, {name}! Напоминаем: сегодня в {time} с вами свяжется менеджер {manager}.",
        )
        text = _render_template(
            tpl,
            {
                "name": row.client_name or lead.name or "клиент",
                "date": date_s,
                "time": time_s,
                "manager": (manager.full_name if manager and manager.full_name else "менеджер"),
                "pain": (row.pain_text or "").strip(),
            },
        ).strip()
        phone = row.client_phone or lead.phone
        chat_id = _chat_id_from_thread_or_phone(thread, phone)
        if not text or not chat_id:
            row.client_reminder_sent_at = now
            continue
        ok, err, provider_id = send_green_text(integ.config or {}, chat_id, text)
        if thread is not None:
            await _log_outgoing_message(
                db,
                thread=thread,
                text=text,
                delivery_status=("sent" if ok else "failed"),
                provider_message_id=provider_id,
            )
        row.client_reminder_sent_at = now
        await write_audit_event(
            db,
            entity_type="waiting_callback",
            entity_id=row.id,
            action="waiting_client_reminder_sent" if ok else "waiting_client_reminder_failed",
            current_user=None,
            details=None if ok else f"send_failed={err}",
        )
        acted += 1

    if acted:
        await db.flush()
    return acted
