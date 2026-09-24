"""Раздел Маркетинг — сводка Meta Ads."""

from __future__ import annotations

import calendar
from datetime import UTC, date, datetime
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import CurrentCompanyId, CurrentUser
from app.database import get_db
from app.models import UserRole
from app.models.marketing_meta import MarketingMetaSettings
from app.schemas.marketing import (
    MarketingCampaignRow,
    MarketingMetaSettingsPatch,
    MarketingMetaSettingsRead,
    MarketingOverviewRead,
)
from app.services.meta_ads_client import (
    campaign_rows,
    fetch_account_meta,
    fetch_insights_range,
    normalize_ad_account_id,
    summarize_rows,
)

router = APIRouter(prefix="/marketing", tags=["marketing"])


def _assert_marketing_access(user) -> None:
    if user.role in (
        UserRole.owner,
        UserRole.super_owner,
        UserRole.admin,
    ):
        return
    raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Нет доступа к маркетингу")


def _month_bounds(ym: date) -> tuple[date, date]:
    last = calendar.monthrange(ym.year, ym.month)[1]
    return date(ym.year, ym.month, 1), date(ym.year, ym.month, last)


async def _get_settings(db: AsyncSession, company_id: int) -> MarketingMetaSettings | None:
    return (
        await db.execute(
            select(MarketingMetaSettings).where(MarketingMetaSettings.company_id == company_id).limit(1)
        )
    ).scalars().first()


@router.get("/meta/settings", response_model=MarketingMetaSettingsRead)
async def get_meta_settings(
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentUser,
    company_id: CurrentCompanyId,
) -> MarketingMetaSettingsRead:
    _assert_marketing_access(current_user)
    row = await _get_settings(db, company_id)
    if row is None or not (row.ad_account_id or "").strip() or not (row.access_token or "").strip():
        return MarketingMetaSettingsRead(
            configured=False,
            ad_account_id=(row.ad_account_id if row else "") or "",
            has_token=bool(row and (row.access_token or "").strip()),
        )
    account_name = None
    currency = None
    tz = None
    try:
        meta = await fetch_account_meta(row.access_token or "", row.ad_account_id)
        account_name = str(meta.get("name") or "") or None
        currency = str(meta.get("currency") or "") or None
        tz = str(meta.get("timezone_name") or "") or None
    except Exception:
        pass
    return MarketingMetaSettingsRead(
        configured=True,
        ad_account_id=normalize_ad_account_id(row.ad_account_id),
        has_token=True,
        account_name=account_name,
        currency=currency,
        timezone_name=tz,
    )


@router.put("/meta/settings", response_model=MarketingMetaSettingsRead)
async def put_meta_settings(
    body: MarketingMetaSettingsPatch,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentUser,
    company_id: CurrentCompanyId,
) -> MarketingMetaSettingsRead:
    _assert_marketing_access(current_user)
    act = normalize_ad_account_id(body.ad_account_id)
    if not act.startswith("act_"):
        raise HTTPException(status_code=400, detail="Укажите ad account id (act_…)")

    row = await _get_settings(db, company_id)
    token = (body.access_token or "").strip()
    if row is None:
        if not token:
            raise HTTPException(status_code=400, detail="Укажите access token")
        row = MarketingMetaSettings(
            company_id=company_id,
            ad_account_id=act,
            access_token=token,
        )
        db.add(row)
    else:
        row.ad_account_id = act
        if token:
            row.access_token = token
        if not (row.access_token or "").strip():
            raise HTTPException(status_code=400, detail="Укажите access token")
        row.updated_at = datetime.now(UTC)

    # Проверка доступа до сохранения
    try:
        meta = await fetch_account_meta(row.access_token or "", act)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Meta отклонил токен/кабинет: {e}") from e

    await db.flush()
    return MarketingMetaSettingsRead(
        configured=True,
        ad_account_id=act,
        has_token=True,
        account_name=str(meta.get("name") or "") or None,
        currency=str(meta.get("currency") or "") or None,
        timezone_name=str(meta.get("timezone_name") or "") or None,
    )


@router.get("/meta/overview", response_model=MarketingOverviewRead)
async def meta_overview(
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentUser,
    company_id: CurrentCompanyId,
    year_month: str = Query(..., description="YYYY-MM"),
) -> MarketingOverviewRead:
    _assert_marketing_access(current_user)
    try:
        y, m = year_month.split("-", 1)
        ym = date(int(y), int(m), 1)
    except Exception as e:
        raise HTTPException(status_code=400, detail="year_month должен быть YYYY-MM") from e

    row = await _get_settings(db, company_id)
    if row is None or not (row.access_token or "").strip() or not (row.ad_account_id or "").strip():
        raise HTTPException(
            status_code=400,
            detail="Сначала сохраните Meta Ads: ad account и токен в настройках маркетинга",
        )

    since, until = _month_bounds(ym)
    today = datetime.now(UTC).date()
    if until > today:
        until = today
    if since > until:
        raise HTTPException(status_code=400, detail="Период ещё не начался")

    try:
        meta = await fetch_account_meta(row.access_token or "", row.ad_account_id)
        rows = await fetch_insights_range(
            row.access_token or "",
            row.ad_account_id,
            since=since,
            until=until,
            level="campaign",
        )
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Meta API: {e}") from e

    summary = summarize_rows(rows)
    camps = [MarketingCampaignRow(**c) for c in campaign_rows(rows)]
    return MarketingOverviewRead(
        period_start=since,
        period_end=until,
        currency=str(meta.get("currency") or "USD"),
        account_name=str(meta.get("name") or "") or None,
        ad_account_id=normalize_ad_account_id(row.ad_account_id),
        spend=summary["spend"],
        impressions=summary["impressions"],
        clicks=summary["clicks"],
        leads=summary["leads"],
        messaging_connections=summary["messaging_connections"],
        cost_per_lead=summary["cost_per_lead"],
        campaigns=camps,
    )
