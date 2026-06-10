"""Автосинхронизация листа ОСВ из Google Sheets в finance_osv_rows."""

from __future__ import annotations

import logging
from datetime import UTC, date, datetime

from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import FinanceCompanySettings, FinanceOsvRow
from app.services.finance_osv_parse import parse_osv_grid
from app.services.google_sheets_sync import (
    _all_sheet_titles,
    _extract_sheet_id,
    _google_access_token,
    _google_service_account_ready,
    _sheet_rows,
    _sheet_title,
)

logger = logging.getLogger(__name__)

_OSV_SHEET_CANDIDATES = ("ОСВ", "OSV", "осв", "Лист1", "Sheet1")


async def _resolve_sheet_name(token: str, spreadsheet_id: str, preferred: str | None) -> str:
    pref = (preferred or "").strip()
    if pref:
        return pref
    titles = await _all_sheet_titles(token, spreadsheet_id)
    for candidate in _OSV_SHEET_CANDIDATES:
        if candidate in titles:
            return candidate
    for t in titles:
        if "осв" in t.lower() or "osv" in t.lower():
            return t
    if titles:
        return titles[0]
    return await _sheet_title(token, spreadsheet_id)


async def sync_google_sheets_to_osv(db: AsyncSession, company_id: int) -> tuple[int, str | None]:
    """
  Полная перезагрузка строк source=google_sheets из настроенной таблицы.
  Возвращает (число строк, имя листа).
  """
    settings = (
        await db.execute(select(FinanceCompanySettings).where(FinanceCompanySettings.company_id == company_id))
    ).scalars().first()
    if settings is None:
        return 0, None
    sheet_url = (settings.osv_sheet_url or "").strip()
    if not sheet_url:
        return 0, None
    spreadsheet_id = _extract_sheet_id(sheet_url)
    if not spreadsheet_id:
        raise RuntimeError("Некорректный URL Google таблицы ОСВ")

    if not _google_service_account_ready():
        raise RuntimeError(
            "Google Sheets не настроен на сервере. Добавьте service account и расшарьте таблицу на его email.",
        )

    token = await _google_access_token()
    sheet_name = await _resolve_sheet_name(token, spreadsheet_id, settings.osv_sheet_name)
    grid = await _sheet_rows(token, spreadsheet_id, f"{sheet_name}!A1:ZZ5000")
    parsed = parse_osv_grid(grid)
    if not parsed:
        raise RuntimeError(
            f"На листе «{sheet_name}» не найдены строки ОСВ. Проверьте заголовки (Дата, Выручка, Расход…).",
        )

    await db.execute(
        delete(FinanceOsvRow).where(
            FinanceOsvRow.company_id == company_id,
            FinanceOsvRow.source == "google_sheets",
        ),
    )

    imported = 0
    for i, payload in enumerate(parsed, start=1):
        db.add(
            FinanceOsvRow(
                company_id=company_id,
                source="google_sheets",
                external_key=f"sheets:{spreadsheet_id}:{sheet_name}:{i}",
                **payload,
            ),
        )
        imported += 1

    settings.updated_at = datetime.now(UTC)
    if imported:
        dates = [p["txn_date"] for p in parsed if isinstance(p.get("txn_date"), date)]
        if dates:
            settings.last_osv_import_from = min(dates)
            settings.last_osv_import_to = max(dates)

    await db.flush()
    return imported, sheet_name


async def run_finance_sheets_sync_tick(db: AsyncSession) -> int:
    """Фоновый тик: синхронизировать ОСВ для всех компаний с настроенной таблицей."""
    if not _google_service_account_ready():
        return 0
    rows = (
        await db.execute(
            select(FinanceCompanySettings).where(
                FinanceCompanySettings.osv_sheet_url.isnot(None),
                FinanceCompanySettings.osv_sheet_url != "",
            ),
        )
    ).scalars().all()
    synced = 0
    for settings in rows:
        try:
            n, _ = await sync_google_sheets_to_osv(db, int(settings.company_id))
            if n > 0:
                synced += 1
        except Exception as exc:
            logger.warning("finance sheets sync company=%s failed: %s", settings.company_id, exc)
    return synced
