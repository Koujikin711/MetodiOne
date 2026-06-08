"""WhatsApp-напоминания об оплате этапов (Green API)."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Integration, IntegrationProvider, Lead, PatientServiceEnrollment, PaymentInstallment, ServiceTemplate
from app.services.green_api_send import send_green_text
from app.services.whatsapp_automation import _active_green_integration_for_pipeline, _chat_id_from_thread_or_phone, _thread_for_lead_green


async def run_payment_reminder_tick(db: AsyncSession) -> int:
    now = datetime.now(UTC)
    remind_from = now + timedelta(days=3)
    rows = (
        await db.execute(
            select(PaymentInstallment, PatientServiceEnrollment, Lead)
            .join(PatientServiceEnrollment, PatientServiceEnrollment.id == PaymentInstallment.enrollment_id)
            .join(Lead, Lead.id == PatientServiceEnrollment.lead_id)
            .where(
                PaymentInstallment.status.in_(("pending", "overdue")),
                PaymentInstallment.reminder_sent_at.is_(None),
                PaymentInstallment.due_date <= remind_from,
            )
            .limit(50),
        )
    ).all()
    sent = 0
    for inst, enr, lead in rows:
        if lead.id is None:
            continue
        await db.refresh(lead, ["stage"])
        pipeline_id = enr.pipeline_id or (lead.stage.pipeline_id if lead.stage else None)
        integ = await _active_green_integration_for_pipeline(db, pipeline_id)
        if integ is None:
            continue
        thread = await _thread_for_lead_green(db, lead)
        chat_id = _chat_id_from_thread_or_phone(thread, lead.phone)
        if not chat_id:
            continue
        template = await db.get(ServiceTemplate, enr.template_id)
        tmpl_name = template.name if template else "курс"
        label = inst.label or f"этап {inst.sort_order}"
        due_s = inst.due_date.astimezone(UTC).strftime("%d.%m.%Y") if inst.due_date else ""
        text = (
            f"Здравствуйте, {lead.name}!\n"
            f"Напоминание об оплате ({tmpl_name}): {label} — {inst.amount} сом, срок {due_s}.\n"
            f"Пожалуйста, свяжитесь с клиникой для оплаты."
        )
        ok, _err, _pid = send_green_text(integ.config or {}, chat_id, text)
        if ok:
            inst.reminder_sent_at = now
            sent += 1
    if sent:
        await db.flush()
    return sent
