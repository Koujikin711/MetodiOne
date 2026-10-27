"""Фоновая синхронизация Meta Ads (расход, лиды, кампании, подписчики).

Тянем Graph API 4–6 раз в сутки и кладём снимок в БД — страница маркетинга
открывается быстро, цифры не «застывают» до ручного обновления.
"""

from __future__ import annotations

import logging
from datetime import UTC, date, datetime, timedelta
from decimal import Decimal
from typing import Any
from zoneinfo import ZoneInfo

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.models.marketing_meta import MarketingMetaSettings, MarketingMetaSnapshot
from app.services.meta_ads_client import (
    brand_subscriber_rows,
    campaign_rows,
    daily_series,
    fetch_account_meta,
    fetch_ad_campaigns,
    fetch_campaign_instagram_ids,
    fetch_insights_range,
    fetch_instagram_follower_gains,
    keep_rows_for_instagram_accounts,
    merge_campaign_catalog,
    normalize_ad_account_id,
    resolve_ig_account_labels,
    summarize_rows,
)

logger = logging.getLogger(__name__)

# 4 часа → 6 раз в сутки; env META_ADS_SYNC_SECONDS может переопределить.
DEFAULT_SYNC_SECONDS = 4 * 60 * 60
# Кэш считаем свежим чуть дольше интервала, чтобы тик и UI не гоняли Meta параллельно.
CACHE_FRESH_SECONDS = int(DEFAULT_SYNC_SECONDS * 1.15)


def sync_interval_seconds() -> int:
    raw = int(getattr(settings, "meta_ads_sync_seconds", 0) or 0)
    if raw >= 60:
        return raw
    return DEFAULT_SYNC_SECONDS


def cache_fresh_seconds() -> int:
    return max(CACHE_FRESH_SECONDS, int(sync_interval_seconds() * 1.1))


def _biz_tz() -> ZoneInfo:
    try:
        return ZoneInfo(settings.booking_timezone or "Asia/Dushanbe")
    except Exception:
        return ZoneInfo("Asia/Dushanbe")


def today_biz() -> date:
    return datetime.now(_biz_tz()).date()


def period_key(period: str, since: date, until: date) -> str:
    return f"{period}:{since.isoformat()}:{until.isoformat()}"


def _jsonable(value: Any) -> Any:
    if isinstance(value, Decimal):
        return format(value, "f")
    if isinstance(value, date) and not isinstance(value, datetime):
        return value.isoformat()
    if isinstance(value, datetime):
        return value.isoformat()
    if isinstance(value, dict):
        return {str(k): _jsonable(v) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return [_jsonable(v) for v in value]
    return value


def resolve_preset_bounds(period: str, *, today: date | None = None) -> tuple[str, date, date]:
    """day | week | month → границы для фонового тика."""
    day = today or today_biz()
    p = (period or "month").strip().lower()
    if p == "day":
        return "day", day, day
    if p == "week":
        start = day - timedelta(days=day.weekday())
        return "week", start, day
    if p == "month":
        return "month", date(day.year, day.month, 1), day
    raise ValueError(f"unsupported period for sync: {period}")


def snapshot_is_fresh(fetched_at: datetime | None, *, now: datetime | None = None) -> bool:
    if fetched_at is None:
        return False
    ts = fetched_at
    if ts.tzinfo is None:
        ts = ts.replace(tzinfo=UTC)
    current = now or datetime.now(UTC)
    if current.tzinfo is None:
        current = current.replace(tzinfo=UTC)
    age = (current - ts.astimezone(UTC)).total_seconds()
    return age >= 0 and age <= cache_fresh_seconds()


async def pull_meta_ads_payload(
    *,
    access_token: str,
    ad_account_id: str,
    since: date,
    until: date,
) -> dict[str, Any]:
    """Сырой пакет Ads (без CRM-конверсии менеджеров)."""
    token = (access_token or "").strip()
    act = normalize_ad_account_id(ad_account_id)
    if not token or not act:
        raise ValueError("Нет токена или ad account")

    use_daily = (until - since).days >= 1
    meta = await fetch_account_meta(token, act)
    rows = await fetch_insights_range(
        token,
        act,
        since=since,
        until=until,
        level="campaign",
        time_increment=1 if use_daily else None,
    )
    campaign_ig = await fetch_campaign_instagram_ids(token, act)
    ig_labels = await resolve_ig_account_labels(token, set(campaign_ig.values()))
    brand_by_campaign = {cid: ig_labels[ig] for cid, ig in campaign_ig.items() if ig in ig_labels}
    rows = keep_rows_for_instagram_accounts(rows, campaign_ig, ig_labels)
    catalog = await fetch_ad_campaigns(token, act)
    rows = merge_campaign_catalog(
        rows,
        catalog,
        since=since,
        until=until,
        brand_by_campaign=brand_by_campaign,
    )
    follower_gains = await fetch_instagram_follower_gains(token, ig_labels, since=since, until=until)

    summary = summarize_rows(rows)
    follower_total = sum(int(item.get("total") or 0) for item in follower_gains.values())
    camps = campaign_rows(rows)
    brand_rows = brand_subscriber_rows(rows)
    for brand in brand_rows:
        gained = follower_gains.get(str(brand.get("account") or ""))
        brand["followers"] = int(gained["total"]) if gained else 0

    daily_pts: list[dict[str, Any]] = []
    for d in daily_series(rows):
        try:
            day_key = str(d["date"])[:10]
            day_followers = sum(
                int((item.get("by_day") or {}).get(day_key) or 0) for item in follower_gains.values()
            )
            daily_pts.append(
                {
                    "date": day_key,
                    "spend": d["spend"],
                    "leads": int(d["leads"]),
                    "followers": day_followers,
                    "clicks": int(d["clicks"]),
                    "impressions": int(d["impressions"]),
                }
            )
        except Exception:
            continue

    return _jsonable(
        {
            "currency": str(meta.get("currency") or "USD"),
            "account_name": str(meta.get("name") or "") or None,
            "ad_account_id": act,
            "spend": summary["spend"],
            "impressions": summary["impressions"],
            "clicks": summary["clicks"],
            "leads": summary["leads"],
            "followers": follower_total,
            "cost_per_lead": summary["cost_per_lead"],
            "campaigns": camps,
            "brands": brand_rows,
            "daily": daily_pts,
        }
    )


async def get_snapshot(
    db: AsyncSession,
    *,
    company_id: int,
    period: str,
    since: date,
    until: date,
) -> MarketingMetaSnapshot | None:
    key = period_key(period, since, until)
    return (
        await db.execute(
            select(MarketingMetaSnapshot)
            .where(
                MarketingMetaSnapshot.company_id == company_id,
                MarketingMetaSnapshot.period_key == key,
            )
            .limit(1)
        )
    ).scalars().first()


async def upsert_snapshot(
    db: AsyncSession,
    *,
    company_id: int,
    period: str,
    since: date,
    until: date,
    payload: dict[str, Any],
    fetched_at: datetime | None = None,
) -> MarketingMetaSnapshot:
    key = period_key(period, since, until)
    row = await get_snapshot(db, company_id=company_id, period=period, since=since, until=until)
    now = fetched_at or datetime.now(UTC)
    if row is None:
        row = MarketingMetaSnapshot(
            company_id=company_id,
            period_key=key,
            period=period,
            period_start=since,
            period_end=until,
            payload=payload,
            fetched_at=now,
        )
        db.add(row)
    else:
        row.period = period
        row.period_start = since
        row.period_end = until
        row.payload = payload
        row.fetched_at = now
    await db.flush()
    return row


async def sync_company_periods(
    db: AsyncSession,
    settings_row: MarketingMetaSettings,
    *,
    periods: tuple[str, ...] = ("day", "week", "month"),
    force: bool = False,
) -> int:
    token = (settings_row.access_token or "").strip()
    act = (settings_row.ad_account_id or "").strip()
    if not token or not act:
        return 0

    synced = 0
    today = today_biz()
    for name in periods:
        period, since, until = resolve_preset_bounds(name, today=today)
        existing = await get_snapshot(
            db, company_id=int(settings_row.company_id), period=period, since=since, until=until
        )
        if not force and existing is not None and snapshot_is_fresh(existing.fetched_at):
            continue
        try:
            payload = await pull_meta_ads_payload(
                access_token=token,
                ad_account_id=act,
                since=since,
                until=until,
            )
            await upsert_snapshot(
                db,
                company_id=int(settings_row.company_id),
                period=period,
                since=since,
                until=until,
                payload=payload,
            )
            synced += 1
        except Exception:
            logger.exception(
                "meta ads sync failed company=%s period=%s",
                settings_row.company_id,
                period,
            )
    return synced


async def run_meta_ads_sync_tick(db: AsyncSession) -> int:
    """Обновляет day/week/month для всех компаний с токеном Meta Ads."""
    rows = (
        await db.execute(
            select(MarketingMetaSettings).where(
                MarketingMetaSettings.access_token.is_not(None),
                MarketingMetaSettings.ad_account_id != "",
            )
        )
    ).scalars().all()
    total = 0
    for row in rows:
        if not (row.access_token or "").strip():
            continue
        total += await sync_company_periods(db, row)
    return total
