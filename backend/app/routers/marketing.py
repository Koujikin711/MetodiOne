"""Раздел Маркетинг — сводка Meta Ads + конверсия менеджеров по лидам."""

from __future__ import annotations

import calendar
from datetime import UTC, date, datetime, timedelta
from typing import Annotated
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.core.deps import CurrentCompanyId, CurrentUser
from app.database import get_db
from app.models import ChatMessage, ChatThread, Lead, Pipeline, PipelineStage, User, UserRole
from app.models.marketing_meta import MarketingMetaSettings
from app.schemas.marketing import (
    MarketingBrandRow,
    MarketingCampaignRow,
    MarketingDailyPoint,
    MarketingManagerConversionRow,
    MarketingMetaSettingsPatch,
    MarketingMetaSettingsRead,
    MarketingOverviewRead,
)
from app.services.meta_ads_client import (
    brand_subscriber_rows,
    campaign_rows,
    daily_series,
    fetch_account_meta,
    fetch_insights_range,
    normalize_ad_account_id,
    summarize_rows,
)

router = APIRouter(prefix="/marketing", tags=["marketing"])

_WON = frozenset({"Удачно"})
_LOST = frozenset({"Отказ"})
_UNTOUCHED = frozenset({"Новый лид", "Не ответили"})
# Лиды с рекламы Meta / мессенджеров
_ADS_SOURCE_MARKERS = (
    "instagram",
    "инстаграм",
    "инста",
    "facebook",
    "messenger",
    "whatsapp",
    "ватсап",
    "вотсап",
    "green",
    "lead",
    "meta",
)


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


def _biz_tz() -> ZoneInfo:
    try:
        return ZoneInfo(settings.booking_timezone or "Asia/Dushanbe")
    except Exception:
        return ZoneInfo("Asia/Dushanbe")


def _dates_to_utc_window(since: date, until: date) -> tuple[datetime, datetime]:
    """Календарные дни since..until включительно → [start, end) UTC."""
    tz = _biz_tz()
    start_local = datetime(since.year, since.month, since.day, tzinfo=tz)
    end_exclusive = until + timedelta(days=1)
    end_local = datetime(end_exclusive.year, end_exclusive.month, end_exclusive.day, tzinfo=tz)
    return start_local.astimezone(UTC), end_local.astimezone(UTC)


def _resolve_period(
    period: str,
    date_from: str | None,
    date_to: str | None,
    year_month: str | None,
) -> tuple[str, date, date]:
    tz = _biz_tz()
    today = datetime.now(tz).date()

    if year_month and not date_from and period == "month":
        # legacy YYYY-MM
        try:
            y, m = year_month.split("-", 1)
            ym = date(int(y), int(m), 1)
        except Exception as e:
            raise HTTPException(status_code=400, detail="year_month должен быть YYYY-MM") from e
        since, until = _month_bounds(ym)
        if until > today:
            until = today
        return "month", since, until

    p = (period or "month").strip().lower()
    if p == "day":
        return "day", today, today
    if p == "week":
        start = today - timedelta(days=today.weekday())  # понедельник
        return "week", start, today
    if p == "month":
        since = date(today.year, today.month, 1)
        return "month", since, today
    if p == "custom":
        if not date_from or not date_to:
            raise HTTPException(status_code=400, detail="Укажите date_from и date_to")
        try:
            since = date.fromisoformat(date_from)
            until = date.fromisoformat(date_to)
        except ValueError as e:
            raise HTTPException(status_code=400, detail="Даты: YYYY-MM-DD") from e
        if until < since:
            raise HTTPException(status_code=400, detail="date_to раньше date_from")
        if until > today:
            until = today
        return "custom", since, until
    raise HTTPException(status_code=400, detail="period: day | week | month | custom")


def _pct(num: int, den: int) -> float:
    if den <= 0:
        return 0.0
    return round(min((num / den) * 100.0, 100.0), 1)


def _is_ads_source(raw: str | None) -> bool:
    s = (raw or "").strip().lower()
    if not s:
        return False
    return any(m in s for m in _ADS_SOURCE_MARKERS)


def _manager_label(u: User | None, mid: int | None) -> str:
    if u is None:
        return "Без менеджера" if mid is None else f"Менеджер #{mid}"
    name = (u.full_name or "").strip()
    if name:
        return name
    email = (u.email or "").strip()
    if email:
        return email
    return f"Менеджер #{u.id}"


def _conversion_row(
    *,
    manager_id: int | None,
    manager_name: str,
    received: int,
    answered: int,
    rejected: int,
    sold: int,
) -> MarketingManagerConversionRow:
    return MarketingManagerConversionRow(
        manager_id=manager_id,
        manager_name=manager_name,
        received=received,
        answered=answered,
        rejected=rejected,
        sold=sold,
        answered_pct=_pct(answered, received),
        rejected_pct=_pct(rejected, received),
        sold_pct=_pct(sold, received),
    )


async def _get_settings(db: AsyncSession, company_id: int) -> MarketingMetaSettings | None:
    return (
        await db.execute(
            select(MarketingMetaSettings).where(MarketingMetaSettings.company_id == company_id).limit(1)
        )
    ).scalars().first()


async def _medicina_pipeline_id(db: AsyncSession, company_id: int) -> int | None:
    row = (
        await db.execute(
            select(Pipeline.id)
            .where(Pipeline.company_id == company_id, Pipeline.name == "Медицина")
            .limit(1)
        )
    ).scalar_one_or_none()
    return int(row) if row is not None else None


async def _manager_conversion(
    db: AsyncSession,
    *,
    company_id: int,
    start: datetime,
    end: datetime,
) -> tuple[list[MarketingManagerConversionRow], MarketingManagerConversionRow]:
    pipeline_id = await _medicina_pipeline_id(db, company_id)

    q = (
        select(
            Lead.id,
            Lead.manager_id,
            Lead.source,
            Lead.archived_from_stage,
            PipelineStage.name.label("stage_name"),
        )
        .select_from(Lead)
        .join(PipelineStage, PipelineStage.id == Lead.status_id)
        .where(
            Lead.company_id == company_id,
            Lead.created_at >= start,
            Lead.created_at < end,
        )
    )
    if pipeline_id is not None:
        q = q.where(PipelineStage.pipeline_id == pipeline_id)

    rows = (await db.execute(q)).all()
    ads_leads = [r for r in rows if _is_ads_source(r.source)]
    lead_ids = [int(r.id) for r in ads_leads]

    answered_ids: set[int] = set()
    if lead_ids:
        replied = (
            await db.execute(
                select(func.distinct(ChatThread.lead_id))
                .select_from(ChatMessage)
                .join(ChatThread, ChatThread.id == ChatMessage.thread_id)
                .join(Lead, Lead.id == ChatThread.lead_id)
                .where(
                    ChatThread.lead_id.in_(lead_ids),
                    ChatMessage.direction == "out",
                    Lead.manager_id.is_not(None),
                    ChatMessage.author_user_id == Lead.manager_id,
                    or_(ChatMessage.company_id == company_id, ChatMessage.company_id.is_(None)),
                )
            )
        ).scalars().all()
        answered_ids = {int(x) for x in replied if x is not None}

    # Также «ответили», если лид уже не в «Новый» / «Не ответили»
    for r in ads_leads:
        stage = (r.stage_name or "").strip()
        if stage and stage not in _UNTOUCHED:
            answered_ids.add(int(r.id))

    by_mgr: dict[int | None, dict[str, int]] = {}
    for r in ads_leads:
        mid = r.manager_id
        bucket = by_mgr.setdefault(mid, {"received": 0, "answered": 0, "rejected": 0, "sold": 0})
        bucket["received"] += 1
        if int(r.id) in answered_ids:
            bucket["answered"] += 1
        stage = (r.stage_name or "").strip()
        archived_from = (r.archived_from_stage or "").strip()
        if stage in _LOST or (stage == "Архив" and archived_from in _LOST):
            bucket["rejected"] += 1
        if stage in _WON or (stage == "Архив" and archived_from in _WON):
            bucket["sold"] += 1

    manager_ids = [mid for mid in by_mgr if mid is not None]
    users: dict[int, User] = {}
    if manager_ids:
        for u in (await db.execute(select(User).where(User.id.in_(manager_ids)))).scalars().all():
            users[int(u.id)] = u

    items: list[MarketingManagerConversionRow] = []
    for mid, b in by_mgr.items():
        items.append(
            _conversion_row(
                manager_id=mid,
                manager_name=_manager_label(users.get(mid) if mid is not None else None, mid),
                received=b["received"],
                answered=b["answered"],
                rejected=b["rejected"],
                sold=b["sold"],
            )
        )
    items.sort(key=lambda x: (-x.received, x.manager_name))

    tot_r = sum(x.received for x in items)
    tot_a = sum(x.answered for x in items)
    tot_j = sum(x.rejected for x in items)
    tot_s = sum(x.sold for x in items)
    total = _conversion_row(
        manager_id=None,
        manager_name="Все менеджеры",
        received=tot_r,
        answered=tot_a,
        rejected=tot_j,
        sold=tot_s,
    )
    return items, total


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
    period: str = Query("month", description="day | week | month | custom"),
    date_from: str | None = Query(default=None, description="YYYY-MM-DD для custom"),
    date_to: str | None = Query(default=None, description="YYYY-MM-DD для custom"),
    year_month: str | None = Query(default=None, description="legacy YYYY-MM"),
) -> MarketingOverviewRead:
    _assert_marketing_access(current_user)
    resolved, since, until = _resolve_period(period, date_from, date_to, year_month)
    if since > until:
        raise HTTPException(status_code=400, detail="Период ещё не начался")

    row = await _get_settings(db, company_id)
    if row is None or not (row.access_token or "").strip() or not (row.ad_account_id or "").strip():
        raise HTTPException(
            status_code=400,
            detail="Сначала сохраните Meta Ads: ad account и токен в настройках маркетинга",
        )

    use_daily = (until - since).days >= 1
    try:
        meta = await fetch_account_meta(row.access_token or "", row.ad_account_id)
        rows = await fetch_insights_range(
            row.access_token or "",
            row.ad_account_id,
            since=since,
            until=until,
            level="campaign",
            time_increment=1 if use_daily else None,
        )
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Meta API: {e}") from e

    summary = summarize_rows(rows)
    camps = [MarketingCampaignRow(**c) for c in campaign_rows(rows)]
    brands = [MarketingBrandRow(**b) for b in brand_subscriber_rows(rows)]
    daily_pts: list[MarketingDailyPoint] = []
    for d in daily_series(rows):
        try:
            daily_pts.append(
                MarketingDailyPoint(
                    date=date.fromisoformat(str(d["date"])),
                    spend=d["spend"],
                    leads=int(d["leads"]),
                    followers=int(d["followers"]),
                    clicks=int(d["clicks"]),
                    impressions=int(d["impressions"]),
                )
            )
        except Exception:
            continue

    crm_start, crm_end = _dates_to_utc_window(since, until)
    managers, managers_total = await _manager_conversion(
        db, company_id=company_id, start=crm_start, end=crm_end
    )

    return MarketingOverviewRead(
        period=resolved,
        period_start=since,
        period_end=until,
        currency=str(meta.get("currency") or "USD"),
        account_name=str(meta.get("name") or "") or None,
        ad_account_id=normalize_ad_account_id(row.ad_account_id),
        spend=summary["spend"],
        impressions=summary["impressions"],
        clicks=summary["clicks"],
        leads=summary["leads"],
        followers=int(summary.get("followers") or 0),
        cost_per_lead=summary["cost_per_lead"],
        campaigns=camps,
        brands=brands,
        daily=daily_pts,
        managers=managers,
        managers_total=managers_total,
    )
