"""Раз в 10 дней тихо отправляет CSV карточек на два заданных адреса.

Письма уходят по отдельности. В журнале аудита и на экране CRM этого нет.
"""

from __future__ import annotations

import asyncio
import logging
from datetime import date, datetime
from zoneinfo import ZoneInfo

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.models import Company, Pipeline, SystemAuditEvent
from app.services.close_pipeline import build_pipeline_leads_csv
from app.services.mail import send_email

logger = logging.getLogger(__name__)

EVERY_DAYS = 10
AUDIT_ACTION = "lead_base_email_sent"
# Только эти ящики. Каждому своё письмо, без копии остальным.
BACKUP_RECIPIENTS = (
    "ganj220492@gmail.com",
    "isharafjon@gmail.com",
)


def backup_is_due(last_on: date | None, today: date, *, every_days: int = EVERY_DAYS) -> bool:
    if last_on is None:
        return True
    return (today - last_on).days >= every_days


def _today() -> date:
    try:
        tz = ZoneInfo(settings.booking_timezone or "Asia/Dushanbe")
    except Exception:
        tz = ZoneInfo("Asia/Dushanbe")
    return datetime.now(tz).date()


def _parse_day(raw: str | None) -> date | None:
    text = (raw or "").strip()[:10]
    try:
        return date.fromisoformat(text)
    except ValueError:
        return None


async def _last_sent_on(db: AsyncSession, company_id: int) -> date | None:
    raw = (
        await db.execute(
            select(SystemAuditEvent.details)
            .where(
                SystemAuditEvent.company_id == company_id,
                SystemAuditEvent.action == AUDIT_ACTION,
            )
            .order_by(SystemAuditEvent.id.desc())
            .limit(1),
        )
    ).scalar_one_or_none()
    return _parse_day(raw)


async def run_lead_base_email_tick(db: AsyncSession) -> int:
    """Письмо владельцу с файлом базы. 0 — сегодня нечего отправлять или почта не настроена."""
    if not settings.smtp_host:
        return 0
    try:
        return await _send_due_backups(db)
    except Exception:
        logger.exception("lead base email tick skipped")
        return 0


async def _send_due_backups(db: AsyncSession) -> int:
    today = _today()
    companies = (
        await db.execute(
            select(Company).where(Company.is_active.is_(True)).order_by(Company.id.asc()),
        )
    ).scalars().all()
    sent_companies = 0
    for company in companies:
        try:
            last_on = await _last_sent_on(db, int(company.id))
            if not backup_is_due(last_on, today):
                continue
            emails = BACKUP_RECIPIENTS
            pipelines = (
                await db.execute(
                    select(Pipeline)
                    .where(Pipeline.company_id == company.id)
                    .order_by(Pipeline.id.asc()),
                )
            ).scalars().all()
            if not emails or not pipelines:
                continue
            attachments: list[tuple[str, bytes]] = []
            total_leads = 0
            for pipe in pipelines:
                csv_text, count = await build_pipeline_leads_csv(
                    db,
                    company_id=int(company.id),
                    pipeline_id=int(pipe.id),
                )
                total_leads += count
                attachments.append((f"baza_{int(pipe.id)}.csv", csv_text.encode("utf-8")))
            subject = f"MetodiOne · база карточек · {today.isoformat()}"
            body = (
                f"Копия карточек «{company.name}» во вложении.\n"
                "Это тот же файл, что кнопка «Скачать базу». "
                "Его можно загрузить обратно через «Загрузить базу».\n"
                "Визиты, переписка и оплаты в файле не хранятся.\n"
                "Следующее письмо через 10 дней."
            )
            delivered = 0
            for email in emails:
                ok = await asyncio.to_thread(
                    send_email,
                    email,
                    subject,
                    body,
                    None,
                    attachments,
                )
                if ok:
                    delivered += 1
            if delivered == 0:
                logger.warning("lead base email was not delivered for company_id=%s", company.id)
                continue
            db.add(
                SystemAuditEvent(
                    company_id=int(company.id),
                    entity_type="company",
                    entity_id=int(company.id),
                    action=AUDIT_ACTION,
                    details=today.isoformat(),
                    user_id=None,
                ),
            )
            await db.flush()
            sent_companies += 1
            logger.info(
                "lead base email sent company_id=%s recipients=%s leads=%s",
                company.id,
                delivered,
                total_leads,
            )
        except Exception:
            logger.exception("lead base email skipped company_id=%s", company.id)
    return sent_companies
