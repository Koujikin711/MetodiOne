"""Клиент Meta Marketing API (Insights)."""

from __future__ import annotations

import json
import re
from datetime import date
from decimal import Decimal
from typing import Any

import httpx

GRAPH_VERSION = "v21.0"
GRAPH_BASE = f"https://graph.facebook.com/{GRAPH_VERSION}"

# Instagram: Ganjina, Zamiri; аккаунт MetodiClinic. MetodiOne — не входит.
_EXCLUDED_CAMPAIGN_RE = re.compile(r"metodione|metodi[\s_-]*one", re.IGNORECASE)
_ALLOWED_CAMPAIGN_RE = re.compile(
    r"ganjina|ганчин|zamiri|замири|metodiclinic|metodi[_\s-]?clinic",
    re.IGNORECASE,
)
_CLINIC_RE = re.compile(r"metodiclinic|metodi[_\s-]?clinic", re.IGNORECASE)

_LEAD_ACTION_TYPES = (
    "lead",
    "onsite_conversion.lead",
    "onsite_web_lead",
    "offsite_complete_registration_add_meta_leads",
)
_MESSAGING_ACTION_TYPES = (
    "onsite_conversion.total_messaging_connection",
    "onsite_conversion.messaging_conversation_started_7d",
)
_FOLLOW_ACTION_TYPES = (
    "follow",
    "onsite_conversion.follow",
    "page_like",
    "like",
)

BRAND_ORDER = ("Ganjina", "Zamiri", "MetodiClinic")


def normalize_ad_account_id(raw: str) -> str:
    s = (raw or "").strip()
    if not s:
        return ""
    if s.startswith("act_"):
        return s
    digits = "".join(ch for ch in s if ch.isdigit())
    return f"act_{digits}" if digits else s


def is_allowed_campaign_name(name: str | None) -> bool:
    """Только Ganjina / Zamiri / MetodiClinic. MetodiOne исключён."""
    n = name or ""
    if _EXCLUDED_CAMPAIGN_RE.search(n):
        return False
    return bool(_ALLOWED_CAMPAIGN_RE.search(n))


def campaign_brand(name: str | None) -> str | None:
    """К какому аккаунту относится кампания."""
    n = name or ""
    if not is_allowed_campaign_name(n):
        return None
    low = n.lower()
    # Zamiri раньше Ganjina — «Замири Ганчина» → Zamiri
    if re.search(r"zamiri|замири", low):
        return "Zamiri"
    if re.search(r"ganjina|ганчин", low):
        return "Ganjina"
    if _CLINIC_RE.search(n):
        return "MetodiClinic"
    return None


def _action_value(actions: list[dict[str, Any]] | None, *types: str) -> int:
    if not actions:
        return 0
    wanted = set(types)
    total = 0
    for row in actions:
        if str(row.get("action_type") or "") in wanted:
            try:
                total += int(float(row.get("value") or 0))
            except (TypeError, ValueError):
                continue
    return total


def _row_leads(actions: list[dict[str, Any]] | None) -> int:
    """Формы + переписки (messaging) = лиды."""
    return _action_value(actions, *_LEAD_ACTION_TYPES) + _action_value(actions, *_MESSAGING_ACTION_TYPES)


def _row_followers(actions: list[dict[str, Any]] | None) -> int:
    return _action_value(actions, *_FOLLOW_ACTION_TYPES)


async def fetch_account_meta(token: str, ad_account_id: str) -> dict[str, Any]:
    act = normalize_ad_account_id(ad_account_id)
    async with httpx.AsyncClient(timeout=30.0) as client:
        r = await client.get(
            f"{GRAPH_BASE}/{act}",
            params={
                "fields": "id,name,account_id,currency,timezone_name,account_status",
                "access_token": token,
            },
        )
        data = r.json()
        if r.status_code >= 400:
            err = data.get("error") if isinstance(data, dict) else None
            msg = (err or {}).get("message") if isinstance(err, dict) else r.text
            raise RuntimeError(msg or f"Meta API {r.status_code}")
        return data


async def fetch_insights_range(
    token: str,
    ad_account_id: str,
    *,
    since: date,
    until: date,
    level: str = "campaign",
    time_increment: int | None = None,
) -> list[dict[str, Any]]:
    act = normalize_ad_account_id(ad_account_id)
    if level == "campaign":
        fields = "campaign_id,campaign_name,spend,impressions,clicks,cpc,ctr,reach,frequency,actions,date_start,date_stop"
    else:
        fields = "spend,impressions,clicks,cpc,ctr,reach,frequency,actions,date_start,date_stop"
    params: dict[str, Any] = {
        "fields": fields,
        "level": level,
        "time_range": json.dumps({"since": since.isoformat(), "until": until.isoformat()}),
        "limit": 500,
        "access_token": token,
    }
    if time_increment is not None:
        params["time_increment"] = time_increment
    out: list[dict[str, Any]] = []
    url: str | None = f"{GRAPH_BASE}/{act}/insights"
    async with httpx.AsyncClient(timeout=90.0) as client:
        first = True
        while url:
            r = await client.get(url, params=params if first else None)
            first = False
            data = r.json()
            if r.status_code >= 400:
                err = data.get("error") if isinstance(data, dict) else None
                msg = (err or {}).get("message") if isinstance(err, dict) else r.text
                raise RuntimeError(msg or f"Meta API {r.status_code}")
            out.extend(data.get("data") or [])
            paging = data.get("paging") or {}
            url = paging.get("next") or None
            params = {}
    if level == "campaign":
        out = [row for row in out if is_allowed_campaign_name(str(row.get("campaign_name") or ""))]
    return out


def summarize_rows(rows: list[dict[str, Any]]) -> dict[str, Any]:
    spend = Decimal("0")
    impressions = 0
    clicks = 0
    leads = 0
    followers = 0
    for row in rows:
        spend += Decimal(str(row.get("spend") or 0))
        impressions += int(float(row.get("impressions") or 0))
        clicks += int(float(row.get("clicks") or 0))
        leads += _row_leads(row.get("actions"))
        followers += _row_followers(row.get("actions"))
    cpl = (spend / Decimal(leads)).quantize(Decimal("0.01")) if leads > 0 else None
    return {
        "spend": spend,
        "impressions": impressions,
        "clicks": clicks,
        "leads": leads,
        "followers": followers,
        "cost_per_lead": cpl,
    }


def campaign_rows(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Агрегат по campaign_id (на случай daily rows)."""
    by_id: dict[str, dict[str, Any]] = {}
    for row in rows:
        cid = str(row.get("campaign_id") or row.get("campaign_name") or "")
        spend = Decimal(str(row.get("spend") or 0))
        leads = _row_leads(row.get("actions"))
        followers = _row_followers(row.get("actions"))
        impress = int(float(row.get("impressions") or 0))
        clicks = int(float(row.get("clicks") or 0))
        name = str(row.get("campaign_name") or "—")
        bucket = by_id.get(cid)
        if bucket is None:
            by_id[cid] = {
                "campaign_id": cid,
                "campaign_name": name,
                "brand": campaign_brand(name),
                "spend": spend,
                "impressions": impress,
                "clicks": clicks,
                "leads": leads,
                "followers": followers,
            }
        else:
            bucket["spend"] += spend
            bucket["impressions"] += impress
            bucket["clicks"] += clicks
            bucket["leads"] += leads
            bucket["followers"] += followers
    out: list[dict[str, Any]] = []
    for bucket in by_id.values():
        spend = bucket["spend"]
        leads = int(bucket["leads"])
        out.append(
            {
                **bucket,
                "leads": leads,
                "followers": int(bucket["followers"]),
                "cpc": None,
                "ctr": None,
                "cost_per_lead": (spend / Decimal(leads)).quantize(Decimal("0.01")) if leads > 0 else None,
            }
        )
    out.sort(key=lambda x: x["spend"], reverse=True)
    return out


def brand_subscriber_rows(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Подписчики / лиды / расход по аккаунтам Ganjina · Zamiri · Metodi_Clinic."""
    buckets: dict[str, dict[str, Any]] = {
        b: {"account": b, "followers": 0, "leads": 0, "spend": Decimal("0"), "impressions": 0, "clicks": 0}
        for b in BRAND_ORDER
    }
    for row in rows:
        brand = campaign_brand(str(row.get("campaign_name") or ""))
        if brand is None:
            continue
        b = buckets[brand]
        b["followers"] += _row_followers(row.get("actions"))
        b["leads"] += _row_leads(row.get("actions"))
        b["spend"] += Decimal(str(row.get("spend") or 0))
        b["impressions"] += int(float(row.get("impressions") or 0))
        b["clicks"] += int(float(row.get("clicks") or 0))
    return [buckets[b] for b in BRAND_ORDER]


def daily_series(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Дневной ряд spend / leads / followers (если insights с time_increment=1)."""
    by_day: dict[str, dict[str, Any]] = {}
    for row in rows:
        day = str(row.get("date_start") or "")[:10]
        if not day:
            continue
        bucket = by_day.setdefault(
            day,
            {"date": day, "spend": Decimal("0"), "leads": 0, "followers": 0, "clicks": 0, "impressions": 0},
        )
        bucket["spend"] += Decimal(str(row.get("spend") or 0))
        bucket["leads"] += _row_leads(row.get("actions"))
        bucket["followers"] += _row_followers(row.get("actions"))
        bucket["clicks"] += int(float(row.get("clicks") or 0))
        bucket["impressions"] += int(float(row.get("impressions") or 0))
    out = sorted(by_day.values(), key=lambda x: x["date"])
    return out
