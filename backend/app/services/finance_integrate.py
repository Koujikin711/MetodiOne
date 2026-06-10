"""Интеграция ОСВ: Google Sheets + Gmail + CRM."""

from __future__ import annotations

import asyncio
import email
import email.utils
import imaplib
import re
from datetime import UTC, date, datetime
from decimal import Decimal
from email.header import decode_header
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import (
    BookingAppointment,
    Deal,
    FinanceCompanySettings,
    FinanceOsvRow,
    Integration,
    IntegrationProvider,
    Lead,
)
from app.services.finance_osv_parse import parse_csv_bytes, parse_decimal, parse_xlsx_bytes
from app.services.google_sheets_finance_sync import sync_google_sheets_to_osv

_AMOUNT_RE = re.compile(r"(\d[\d\s.,]{2,})\s*(?:som|сом|tjs|₽|руб)?", re.I)


def _decode_mime_header(raw: str | None) -> str:
    if not raw:
        return ""
    parts: list[str] = []
    for chunk, enc in decode_header(raw):
        if isinstance(chunk, bytes):
            parts.append(chunk.decode(enc or "utf-8", errors="replace"))
        else:
            parts.append(str(chunk))
    return "".join(parts)


def _parse_email_body_row(subject: str, body: str, fallback_date: date) -> dict[str, Any] | None:
    text = f"{subject}\n{body}"
    amounts = _AMOUNT_RE.findall(text)
    if not amounts:
        return None
    amt = parse_decimal(amounts[0])
    if amt <= 0:
        return None
    low = text.lower()
    is_expense = any(w in low for w in ("списан", "расход", "оплат", "перевод", "снят"))
    revenue = Decimal("0") if is_expense else amt
    expense = amt if is_expense else Decimal("0")
    brief = "Расход" if is_expense else "Выручка"
    article = "Поступления" if not is_expense else "Административные расходы"
    return {
        "txn_date": fallback_date,
        "revenue": revenue,
        "expense": expense,
        "basis": subject[:255] if subject else None,
        "brief_category": brief,
        "article": article,
        "bank": "Gmail",
    }


def _imap_fetch_parsed_rows(email_addr: str, app_password: str, imap_host: str) -> list[tuple[str, dict[str, Any]]]:
    out: list[tuple[str, dict[str, Any]]] = []
    mail = imaplib.IMAP4_SSL(imap_host or "imap.gmail.com")
    try:
        mail.login(email_addr, app_password)
        mail.select("INBOX")
        _status, data = mail.search(None, "ALL")
        ids = (data[0] or b"").split()
        for msg_id in ids[-80:]:
            _status, msg_data = mail.fetch(msg_id, "(RFC822)")
            if not msg_data or not msg_data[0]:
                continue
            raw = msg_data[0][1]
            msg = email.message_from_bytes(raw)
            subject = _decode_mime_header(msg.get("Subject"))
            ext_base = f"gmail:{msg_id.decode() if isinstance(msg_id, bytes) else msg_id}"
            msg_date = email.utils.parsedate_to_datetime(msg.get("Date") or "")
            fallback_date = msg_date.date() if msg_date else date.today()
            body_text = ""
            if msg.is_multipart():
                for part in msg.walk():
                    ctype = part.get_content_type()
                    fname = part.get_filename()
                    payload = part.get_payload(decode=True) or b""
                    if fname:
                        low = fname.lower()
                        parsed_rows: list[dict[str, Any]] = []
                        if low.endswith(".csv"):
                            parsed_rows = parse_csv_bytes(payload)
                        elif low.endswith((".xlsx", ".xlsm")):
                            parsed_rows = parse_xlsx_bytes(payload)
                        for i, row in enumerate(parsed_rows):
                            out.append((f"{ext_base}:att:{fname}:{i}", row))
                    elif ctype == "text/plain" and not body_text:
                        body_text = payload.decode("utf-8", errors="replace")
            else:
                body_text = (msg.get_payload(decode=True) or b"").decode("utf-8", errors="replace")
            if body_text:
                single = _parse_email_body_row(subject, body_text, fallback_date)
                if single:
                    out.append((f"{ext_base}:body", single))
    finally:
        try:
            mail.logout()
        except Exception:
            pass
    return out


async def get_gmail_integration(db: AsyncSession, company_id: int) -> Integration | None:
    row = (
        await db.execute(
            select(Integration)
            .where(
                Integration.company_id == company_id,
                Integration.provider == IntegrationProvider.gmail,
                Integration.is_active.is_(True),
            )
            .limit(1),
        )
    ).scalars().first()
    return row


async def _upsert_osv_row(
    db: AsyncSession,
    *,
    company_id: int,
    external_key: str,
    source: str,
    payload: dict[str, Any],
) -> bool:
    exists = (
        await db.execute(
            select(FinanceOsvRow.id).where(
                FinanceOsvRow.company_id == company_id,
                FinanceOsvRow.external_key == external_key,
            ).limit(1),
        )
    ).scalar_one_or_none()
    if exists is not None:
        return False
    db.add(
        FinanceOsvRow(
            company_id=company_id,
            source=source,
            external_key=external_key,
            **payload,
        ),
    )
    return True


async def sync_crm_to_osv(db: AsyncSession, company_id: int) -> tuple[int, int]:
    imported = 0
    skipped = 0
    deals = (
        await db.execute(
            select(Deal, Lead.name, Lead.phone)
            .join(Lead, Lead.id == Deal.lead_id, isouter=True)
            .where(
                Deal.paid_amount > 0,
                (Deal.company_id == company_id) | (Lead.company_id == company_id),
            ),
        )
    ).all()
    for deal, lead_name, lead_phone in deals:
        paid = Decimal(deal.paid_amount or 0)
        if paid <= 0:
            continue
        payload = {
            "txn_date": date.today(),
            "revenue": paid,
            "expense": Decimal("0"),
            "counterparty": lead_name,
            "phone": lead_phone,
            "product_service": deal.title or "Закрытая сделка",
            "article": "Поступления",
            "brief_category": "Выручка",
            "basis": f"CRM сделка #{deal.id}",
            "bank": "CRM",
        }
        ok = await _upsert_osv_row(
            db,
            company_id=company_id,
            external_key=f"crm:deal:{deal.id}",
            source="crm",
            payload=payload,
        )
        if ok:
            imported += 1
        else:
            skipped += 1

    appts = (
        await db.execute(
            select(BookingAppointment, Lead.name, Lead.phone)
            .join(Lead, Lead.id == BookingAppointment.lead_id, isouter=True)
            .where(
                BookingAppointment.company_id == company_id,
                BookingAppointment.paid_amount > 0,
            ),
        )
    ).all()
    for appt, lead_name, lead_phone in appts:
        paid = Decimal(appt.paid_amount or 0)
        if paid <= 0:
            continue
        payload = {
            "txn_date": (appt.start_at or datetime.now(UTC)).date(),
            "revenue": paid,
            "expense": Decimal("0"),
            "counterparty": lead_name,
            "phone": lead_phone,
            "product_service": appt.service_title or "Онлайн-запись",
            "article": "Поступления",
            "brief_category": "Выручка",
            "basis": f"Оплата записи #{appt.id}",
            "bank": "CRM",
        }
        ok = await _upsert_osv_row(
            db,
            company_id=company_id,
            external_key=f"crm:appt:{appt.id}",
            source="crm",
            payload=payload,
        )
        if ok:
            imported += 1
        else:
            skipped += 1
    return imported, skipped


async def sync_gmail_to_osv(db: AsyncSession, company_id: int) -> tuple[int, int, bool, str | None]:
    integ = await get_gmail_integration(db, company_id)
    if integ is None:
        return 0, 0, False, None
    cfg = integ.config if isinstance(integ.config, dict) else {}
    email_addr = str(cfg.get("email") or cfg.get("gmail_email") or "").strip()
    app_password = str(cfg.get("app_password") or "").strip()
    imap_host = str(cfg.get("imap_host") or "imap.gmail.com").strip()
    if not email_addr or not app_password:
        return 0, 0, False, email_addr or None

    parsed = await asyncio.to_thread(_imap_fetch_parsed_rows, email_addr, app_password, imap_host)
    imported = 0
    skipped = 0
    for external_key, payload in parsed:
        ok = await _upsert_osv_row(
            db,
            company_id=company_id,
            external_key=external_key,
            source="gmail",
            payload=payload,
        )
        if ok:
            imported += 1
        else:
            skipped += 1
    return imported, skipped, True, email_addr


async def ensure_finance_settings(db: AsyncSession, company_id: int) -> FinanceCompanySettings:
    row = (
        await db.execute(select(FinanceCompanySettings).where(FinanceCompanySettings.company_id == company_id))
    ).scalars().first()
    if row is None:
        row = FinanceCompanySettings(company_id=company_id)
        db.add(row)
        await db.flush()
    return row


async def run_finance_integrate(db: AsyncSession, company_id: int) -> dict[str, Any]:
    settings = await ensure_finance_settings(db, company_id)

    sheets_imported = 0
    sheets_sheet: str | None = None
    sheets_error: str | None = None
    if (settings.osv_sheet_url or "").strip():
        try:
            sheets_imported, sheets_sheet = await sync_google_sheets_to_osv(db, company_id)
        except Exception as exc:
            sheets_error = str(exc)

    gmail_imported, gmail_skipped, gmail_ok, gmail_email = await sync_gmail_to_osv(db, company_id)
    crm_imported, crm_skipped = await sync_crm_to_osv(db, company_id)

    settings.updated_at = datetime.now(UTC)

    total = (
        await db.execute(
            select(FinanceOsvRow.id).where(FinanceOsvRow.company_id == company_id),
        )
    ).all()

    msg_parts: list[str] = []
    if sheets_imported:
        msg_parts.append(f"Google Sheets ({sheets_sheet}): {sheets_imported} строк")
    elif (settings.osv_sheet_url or "").strip():
        msg_parts.append(sheets_error or "Google Sheets: строк не найдено")
    else:
        msg_parts.append("Google Sheets: укажите URL таблицы ОСВ в настройках финансов")

    if gmail_ok:
        msg_parts.append(f"Gmail: +{gmail_imported}")
    else:
        msg_parts.append("Gmail: не подключён")

    msg_parts.append(f"CRM: +{crm_imported}")
    skipped = gmail_skipped + crm_skipped
    if skipped:
        msg_parts.append(f"дублей пропущено: {skipped}")

    return {
        "gmail_connected": gmail_ok,
        "gmail_email": gmail_email,
        "sheets_connected": bool((settings.osv_sheet_url or "").strip()),
        "osv_sheet_url": settings.osv_sheet_url,
        "osv_sheet_name": sheets_sheet or settings.osv_sheet_name,
        "imported_from_sheets": sheets_imported,
        "imported_from_gmail": gmail_imported,
        "imported_from_crm": crm_imported,
        "skipped_duplicates": skipped,
        "osv_rows_count": len(total),
        "message": ". ".join(msg_parts),
    }
