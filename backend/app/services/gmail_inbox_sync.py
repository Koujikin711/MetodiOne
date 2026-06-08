"""Синхронизация входящих писем Gmail (IMAP) в finance_gmail_inbox."""

from __future__ import annotations

import asyncio
import email
import imaplib
import logging
from email.header import decode_header
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import FinanceGmailInboxItem, Integration, IntegrationProvider

logger = logging.getLogger(__name__)


def _decode_mime_header(value: str | None) -> str:
    if not value:
        return ""
    parts: list[str] = []
    for chunk, enc in decode_header(value):
        if isinstance(chunk, bytes):
            parts.append(chunk.decode(enc or "utf-8", errors="replace"))
        else:
            parts.append(str(chunk))
    return " ".join(parts).strip()


def _fetch_gmail_messages_blocking(
    *,
    imap_host: str,
    email_addr: str,
    app_password: str,
    known_ids: set[str],
    limit: int = 25,
) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    mail: imaplib.IMAP4_SSL | None = None
    try:
        mail = imaplib.IMAP4_SSL(imap_host, 993)
        mail.login(email_addr, app_password)
        mail.select("INBOX")
        _status, data = mail.search(None, "UNSEEN")
        if not data or not data[0]:
            return out
        ids = data[0].split()
        for msg_id in ids[-limit:]:
            _status, msg_data = mail.fetch(msg_id, "(RFC822)")
            if not msg_data or not msg_data[0]:
                continue
            raw = msg_data[0][1]
            if not isinstance(raw, (bytes, bytearray)):
                continue
            msg = email.message_from_bytes(raw)
            gmail_id = msg.get("Message-ID") or f"imap:{msg_id.decode()}"
            if gmail_id in known_ids:
                continue
            subject = _decode_mime_header(msg.get("Subject"))
            sender = _decode_mime_header(msg.get("From"))
            attachment_name: str | None = None
            summary_parts: list[str] = []
            if msg.is_multipart():
                for part in msg.walk():
                    ctype = part.get_content_type()
                    disp = str(part.get("Content-Disposition") or "")
                    if "attachment" in disp.lower():
                        fname = part.get_filename()
                        if fname and attachment_name is None:
                            attachment_name = _decode_mime_header(fname)
                    elif ctype == "text/plain":
                        payload = part.get_payload(decode=True)
                        if isinstance(payload, bytes) and payload:
                            text = payload.decode(part.get_content_charset() or "utf-8", errors="replace")
                            summary_parts.append(text.strip()[:400])
            else:
                payload = msg.get_payload(decode=True)
                if isinstance(payload, bytes):
                    summary_parts.append(
                        payload.decode(msg.get_content_charset() or "utf-8", errors="replace").strip()[:400],
                    )
            parsed_summary = summary_parts[0] if summary_parts else None
            if attachment_name and any(
                attachment_name.lower().endswith(ext) for ext in (".csv", ".xlsx", ".xls", ".pdf", ".xml")
            ):
                parsed_summary = (parsed_summary or "") + f" [вложение: {attachment_name}]"
            out.append(
                {
                    "gmail_message_id": gmail_id,
                    "subject": subject or None,
                    "sender": sender or None,
                    "attachment_name": attachment_name,
                    "parsed_summary": parsed_summary,
                },
            )
        return out
    except Exception as exc:
        logger.warning("gmail imap sync failed for %s: %s", email_addr, exc)
        return out
    finally:
        if mail is not None:
            try:
                mail.logout()
            except Exception:
                pass


async def sync_gmail_inbox_for_company(
    db: AsyncSession,
    *,
    company_id: int,
    integration: Integration,
) -> int:
    cfg = integration.config or {}
    email_addr = str(cfg.get("email") or cfg.get("gmail_email") or "").strip()
    app_password = str(cfg.get("app_password") or "").strip()
    imap_host = str(cfg.get("imap_host") or "imap.gmail.com").strip()
    if not email_addr or not app_password:
        return 0

    existing = (
        await db.execute(
            select(FinanceGmailInboxItem.gmail_message_id).where(
                FinanceGmailInboxItem.company_id == company_id,
            ),
        )
    ).all()
    known_ids = {str(r[0]) for r in existing}

    fetched = await asyncio.to_thread(
        _fetch_gmail_messages_blocking,
        imap_host=imap_host,
        email_addr=email_addr,
        app_password=app_password,
        known_ids=known_ids,
    )
    added = 0
    for row in fetched:
        db.add(
            FinanceGmailInboxItem(
                company_id=company_id,
                gmail_message_id=row["gmail_message_id"],
                subject=row.get("subject"),
                sender=row.get("sender"),
                attachment_name=row.get("attachment_name"),
                parsed_summary=row.get("parsed_summary"),
                status="pending",
            ),
        )
        added += 1
    if added:
        await db.flush()
    return added


async def run_gmail_inbox_sync_tick(db: AsyncSession) -> int:
    rows = (
        await db.execute(
            select(Integration).where(
                Integration.provider == IntegrationProvider.gmail,
                Integration.is_active.is_(True),
            ),
        )
    ).scalars().all()
    total = 0
    for integ in rows:
        if integ.company_id is None:
            continue
        total += await sync_gmail_inbox_for_company(db, company_id=int(integ.company_id), integration=integ)
    return total
