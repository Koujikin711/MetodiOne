from __future__ import annotations

import re
import time
from typing import Any
from urllib.parse import quote

import httpx
from jose import jwt
from sqlalchemy import and_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.models import Integration, IntegrationProvider, Lead, LeadSource, Pipeline, PipelineStage
from app.services.lead_assignment import assign_manager_for_new_lead

_GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token"
_GOOGLE_SHEETS_SCOPE = "https://www.googleapis.com/auth/spreadsheets.readonly"
_GOOGLE_SHEETS_API = "https://sheets.googleapis.com/v4/spreadsheets"
_SOURCE_NAME = "GOOGLE SHEETS"
_SHEET_ID_RE = re.compile(r"/spreadsheets/d/([a-zA-Z0-9-_]+)")
_TEST_ROW_MARKERS = (
    "<test",
    "test lead",
    "dummy",
    "example",
    "sample",
    "тест",
)


def _norm(s: str) -> str:
    raw = str(s or "").replace("\ufeff", "").strip().lower()
    raw = re.sub(r"\s+", "_", raw)
    raw = re.sub(r"[^a-z0-9а-я_]+", "_", raw)
    raw = re.sub(r"_+", "_", raw).strip("_")
    return raw


def _resolve_private_key() -> str:
    raw = settings.google_service_account_private_key.strip()
    if not raw:
        return ""
    return raw.replace("\\n", "\n")


def _google_service_account_ready() -> bool:
    return bool(settings.google_service_account_email.strip() and _resolve_private_key().strip())


def _extract_sheet_id(sheet_url_or_id: str) -> str | None:
    val = (sheet_url_or_id or "").strip()
    if not val:
        return None
    m = _SHEET_ID_RE.search(val)
    if m:
        return m.group(1)
    if "/" not in val and "?" not in val and len(val) >= 20:
        return val
    return None


def _col_letters_to_index(spec: str) -> int | None:
    s = (spec or "").strip().upper()
    if not s or not s.isalpha():
        return None
    idx = 0
    for ch in s:
        idx = idx * 26 + (ord(ch) - 64)
    return idx - 1


def _resolve_col_index(spec: str | int | None, headers: list[str]) -> int | None:
    if spec is None:
        return None
    if isinstance(spec, int):
        return spec if spec >= 0 else None
    s = str(spec).strip()
    if not s:
        return None
    if s.isdigit():
        n = int(s)
        return n - 1 if n >= 1 else None
    letter_idx = _col_letters_to_index(s)
    if letter_idx is not None:
        return letter_idx
    needle = _norm(s)
    normalized_headers = [_norm(h) for h in headers]
    for i, h in enumerate(normalized_headers):
        if h == needle:
            return i
    # Мягкое сопоставление: "phone_number_1", "lead_phone_number", и т.п.
    for i, h in enumerate(normalized_headers):
        if needle and (needle in h or h in needle):
            return i
    for i, h in enumerate(headers):
        if _norm(h) == needle:
            return i
    return None


def _cell(row: list[Any], idx: int | None) -> str:
    if idx is None or idx < 0 or idx >= len(row):
        return ""
    v = row[idx]
    return str(v).strip() if v is not None else ""


async def _google_access_token() -> str:
    now = int(time.time())
    assertion = jwt.encode(
        {
            "iss": settings.google_service_account_email.strip(),
            "scope": _GOOGLE_SHEETS_SCOPE,
            "aud": _GOOGLE_TOKEN_URL,
            "iat": now,
            "exp": now + 3600,
        },
        _resolve_private_key(),
        algorithm="RS256",
    )
    async with httpx.AsyncClient(timeout=20.0) as client:
        resp = await client.post(
            _GOOGLE_TOKEN_URL,
            data={
                "grant_type": "urn:ietf:params:oauth:grant-type:jwt-bearer",
                "assertion": assertion,
            },
        )
    resp.raise_for_status()
    data = resp.json()
    token = str(data.get("access_token") or "").strip()
    if not token:
        raise RuntimeError("Google token response has no access_token")
    return token


async def _sheet_title(token: str, spreadsheet_id: str) -> str:
    url = f"{_GOOGLE_SHEETS_API}/{quote(spreadsheet_id)}/?fields=sheets(properties(title))"
    async with httpx.AsyncClient(timeout=20.0) as client:
        r = await client.get(url, headers={"Authorization": f"Bearer {token}"})
    r.raise_for_status()
    payload = r.json() if isinstance(r.json(), dict) else {}
    sheets = payload.get("sheets") or []
    if isinstance(sheets, list):
        for s in sheets:
            props = s.get("properties") if isinstance(s, dict) else None
            title = props.get("title") if isinstance(props, dict) else None
            if isinstance(title, str) and title.strip():
                return title.strip()
    raise RuntimeError("Google Sheets: не удалось определить имя листа")


async def _all_sheet_titles(token: str, spreadsheet_id: str) -> list[str]:
    url = f"{_GOOGLE_SHEETS_API}/{quote(spreadsheet_id)}/?fields=sheets(properties(title))"
    async with httpx.AsyncClient(timeout=20.0) as client:
        r = await client.get(url, headers={"Authorization": f"Bearer {token}"})
    r.raise_for_status()
    payload = r.json() if isinstance(r.json(), dict) else {}
    out: list[str] = []
    sheets = payload.get("sheets") or []
    if isinstance(sheets, list):
        for s in sheets:
            props = s.get("properties") if isinstance(s, dict) else None
            title = props.get("title") if isinstance(props, dict) else None
            if isinstance(title, str) and title.strip():
                out.append(title.strip())
    return out


async def _sheet_rows(token: str, spreadsheet_id: str, rng: str) -> list[list[Any]]:
    url = f"{_GOOGLE_SHEETS_API}/{quote(spreadsheet_id)}/values/{quote(rng, safe='')}"
    async with httpx.AsyncClient(timeout=25.0) as client:
        r = await client.get(url, headers={"Authorization": f"Bearer {token}"})
    r.raise_for_status()
    payload = r.json() if isinstance(r.json(), dict) else {}
    vals = payload.get("values")
    if not isinstance(vals, list):
        return []
    out: list[list[Any]] = []
    for row in vals:
        out.append(row if isinstance(row, list) else [])
    return out


async def _ensure_source_exists(db: AsyncSession, company_id: int, name: str) -> None:
    existing = await db.scalar(select(LeadSource.id).where(LeadSource.company_id == company_id, LeadSource.name == name))
    if existing is None:
        db.add(LeadSource(name=name, is_active=True, company_id=company_id))
        await db.flush()


def _norm_phone(raw: str | None) -> str | None:
    if not raw:
        return None
    digits = re.sub(r"\D+", "", raw)
    return digits or None


def _is_probably_test_row(*values: str) -> bool:
    merged = " ".join((v or "").strip().lower() for v in values)
    if not merged:
        return False
    return any(marker in merged for marker in _TEST_ROW_MARKERS)


def _is_valid_phone_for_lead(phone: str | None) -> bool:
    if not phone:
        return False
    # 9+ цифр: отсекаем короткий мусор, но не ломаем локальные форматы.
    return len(phone) >= 9


async def _find_existing_lead(
    db: AsyncSession,
    *,
    company_id: int,
    phone: str | None,
    source_name: str,
    pipeline_id: int,
) -> Lead | None:
    if not phone:
        return None
    res = await db.execute(
        select(Lead)
        .join(PipelineStage, PipelineStage.id == Lead.status_id)
        .where(
            and_(
                Lead.phone == phone,
                Lead.company_id == company_id,
                Lead.source == source_name,
                PipelineStage.pipeline_id == pipeline_id,
            ),
        )
        .order_by(Lead.id.desc())
        .limit(1),
    )
    return res.scalars().first()


async def _upsert_sheet_lead(
    db: AsyncSession,
    *,
    integ: Integration,
    company_id: int,
    name: str,
    phone: str | None,
    email: str | None,
) -> None:
    await _ensure_source_exists(db, company_id, _SOURCE_NAME)
    norm_phone = _norm_phone(phone)
    existing = await _find_existing_lead(
        db,
        company_id=company_id,
        phone=norm_phone,
        source_name=_SOURCE_NAME,
        pipeline_id=integ.pipeline_id,
    )
    if existing is not None:
        existing.status_id = integ.stage_id
        if not existing.name and name.strip():
            existing.name = name.strip()
        if not existing.email and (email or "").strip():
            existing.email = (email or "").strip()
        await db.flush()
        return

    lead = Lead(
        company_id=company_id,
        name=name.strip() or "Лид из таблицы",
        phone=norm_phone,
        email=(email or "").strip() or None,
        source=_SOURCE_NAME,
        status_id=integ.stage_id,
        manager_id=None,
    )
    db.add(lead)
    await db.flush()
    pipe = await db.get(Pipeline, int(integ.pipeline_id))
    exclude_id = int(pipe.intake_manager_user_id) if pipe and pipe.intake_manager_user_id is not None else None
    mid = await assign_manager_for_new_lead(db, pipeline_id=integ.pipeline_id, exclude_user_id=exclude_id)
    if mid is not None:
        lead.manager_id = mid
        await db.flush()


async def sync_google_sheet_integration(
    db: AsyncSession,
    *,
    integ: Integration,
    max_rows: int = 500,
) -> dict[str, int]:
    if integ.provider != IntegrationProvider.google_sheets:
        return {"created": 0, "processed": 0, "skipped": 0}
    if integ.company_id is None:
        raise RuntimeError("Integration has no company scope")
    cfg = dict(integ.config or {})
    spreadsheet_id = _extract_sheet_id(str(cfg.get("sheet_url") or cfg.get("spreadsheet_id") or ""))
    if not spreadsheet_id:
        raise RuntimeError("Укажите корректный URL Google таблицы (sheet_url)")

    if not _google_service_account_ready():
        raise RuntimeError("Google credentials не настроены на сервере")

    token = await _google_access_token()
    sheet_name = str(cfg.get("sheet_name") or "").strip()
    if not sheet_name:
        sheet_name = await _sheet_title(token, spreadsheet_id)

    header_row = int(cfg.get("header_row") or 1)
    if header_row < 1:
        header_row = 1
    start_row = int(cfg.get("start_row") or (header_row + 1))
    if start_row < 1:
        start_row = 1
    cursor_row = int(cfg.get("cursor_row") or 0)
    from_row = max(start_row, cursor_row + 1)

    header_vals = await _sheet_rows(token, spreadsheet_id, f"{sheet_name}!A{header_row}:ZZ{header_row}")
    headers = [str(x).strip() for x in (header_vals[0] if header_vals else [])]
    name_col = _resolve_col_index(cfg.get("full_name_column") or "full_name", headers)
    phone_col = _resolve_col_index(cfg.get("phone_column") or "phone_number", headers)
    email_col = _resolve_col_index(cfg.get("email_column") or "email", headers)
    if (name_col is None or phone_col is None) and cfg.get("sheet_name"):
        # Если явно указали не тот лист, пробуем автоматически найти корректный по заголовкам.
        for candidate in await _all_sheet_titles(token, spreadsheet_id):
            cand_vals = await _sheet_rows(token, spreadsheet_id, f"{candidate}!A{header_row}:ZZ{header_row}")
            cand_headers = [str(x).strip() for x in (cand_vals[0] if cand_vals else [])]
            cand_name = _resolve_col_index(cfg.get("full_name_column") or "full_name", cand_headers)
            cand_phone = _resolve_col_index(cfg.get("phone_column") or "phone_number", cand_headers)
            if cand_name is not None and cand_phone is not None:
                sheet_name = candidate
                headers = cand_headers
                name_col = cand_name
                phone_col = cand_phone
                email_col = _resolve_col_index(cfg.get("email_column") or "email", headers)
                break
    if name_col is None and phone_col is None:
        raise RuntimeError(
            "Не найдены колонки full_name/phone_number. Проверьте имя листа, строку заголовков и названия колонок в интеграции.",
        )

    rows = await _sheet_rows(token, spreadsheet_id, f"{sheet_name}!A{from_row}:ZZ")
    created = 0
    processed = 0
    skipped = 0
    last_seen_row = cursor_row

    for i, row in enumerate(rows):
        if processed >= max_rows:
            break
        row_no = from_row + i
        last_seen_row = max(last_seen_row, row_no)
        full_name = _cell(row, name_col)
        phone = _cell(row, phone_col)
        email = _cell(row, email_col)
        norm_phone = _norm_phone(phone)
        if _is_probably_test_row(full_name, phone, email):
            skipped += 1
            continue
        if not _is_valid_phone_for_lead(norm_phone):
            skipped += 1
            continue
        await _upsert_sheet_lead(
            db,
            integ=integ,
            company_id=int(integ.company_id or 0),
            name=full_name or "Лид из таблицы",
            phone=norm_phone,
            email=email or None,
        )
        processed += 1
        created += 1

    cfg["spreadsheet_id"] = spreadsheet_id
    cfg["sheet_name"] = sheet_name
    cfg["cursor_row"] = last_seen_row
    integ.config = cfg
    await db.flush()
    return {"created": created, "processed": processed, "skipped": skipped}


async def run_google_sheets_import_tick(db: AsyncSession, *, max_rows_per_integration: int = 300) -> int:
    if not _google_service_account_ready():
        return 0
    rows = await db.execute(
        select(Integration).where(
            Integration.is_active.is_(True),
            Integration.provider == IntegrationProvider.google_sheets,
            Integration.company_id.is_not(None),
        ),
    )
    synced = 0
    for integ in rows.scalars().all():
        await sync_google_sheet_integration(db, integ=integ, max_rows=max_rows_per_integration)
        synced += 1
    return synced
