"""Клиент Meta Marketing API (Insights)."""

from __future__ import annotations

import json
from datetime import date
from decimal import Decimal
from typing import Any

import httpx

GRAPH_VERSION = "v21.0"
GRAPH_BASE = f"https://graph.facebook.com/{GRAPH_VERSION}"

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

BRAND_ORDER = ("Ganjina Zamiri", "MetodiClinic")

# Instagram, с которых клиника запускает рекламу. Имя кампании не используется.
_ALLOWED_IG_USERNAMES = {
    "dr.ganjina.zamir": "Ganjina Zamiri",
    "metodi_clinic": "MetodiClinic",
}
_IG_ID_KEYS = ("instagram_user_id", "instagram_actor_id", "instagram_profile_id")


def normalize_ad_account_id(raw: str) -> str:
    s = (raw or "").strip()
    if not s:
        return ""
    if s.startswith("act_"):
        return s
    digits = "".join(ch for ch in s if ch.isdigit())
    return f"act_{digits}" if digits else s


def ig_account_label(username: str | None, name: str | None = None) -> str | None:
    """Метка клиники по username/имени Instagram. MetodiOne и прочие — None."""
    uname = (username or "").strip().lower().lstrip("@")
    if uname in _ALLOWED_IG_USERNAMES:
        return _ALLOWED_IG_USERNAMES[uname]
    n = (name or "").strip().lower()
    if any(part in n for part in ("ganjina", "zamir", "ганчин", "замир")):
        return "Ganjina Zamiri"
    if ("clinic" in n or "клиник" in n) and ("metodi" in n or "метод" in n):
        return "MetodiClinic"
    return None


def instagram_id_from_creative(creative: Any) -> str | None:
    if not isinstance(creative, dict):
        return None
    for key in _IG_ID_KEYS:
        val = creative.get(key)
        if val:
            return str(val)
    spec = creative.get("object_story_spec")
    if isinstance(spec, dict):
        for key in _IG_ID_KEYS:
            val = spec.get(key)
            if val:
                return str(val)
    return None


def campaign_ig_map_from_ads(ads: list[dict[str, Any]]) -> dict[str, str]:
    """campaign_id → Instagram id, который чаще стоит в объявлениях кампании."""
    counts: dict[str, dict[str, int]] = {}
    for ad in ads:
        if not isinstance(ad, dict):
            continue
        cid = str(ad.get("campaign_id") or "")
        ig = instagram_id_from_creative(ad.get("creative"))
        if not cid or not ig:
            promoted = ad.get("promoted_object")
            if isinstance(promoted, dict):
                ig = instagram_id_from_creative(promoted)
        if not cid or not ig:
            continue
        bucket = counts.setdefault(cid, {})
        bucket[ig] = bucket.get(ig, 0) + 1
    out: dict[str, str] = {}
    for cid, bucket in counts.items():
        out[cid] = max(bucket.items(), key=lambda item: item[1])[0]
    return out


def keep_rows_for_instagram_accounts(
    rows: list[dict[str, Any]],
    campaign_ig: dict[str, str],
    ig_labels: dict[str, str],
) -> list[dict[str, Any]]:
    """Оставляет строки Insights, чей Instagram — Ganjina Zamiri или MetodiClinic."""
    out: list[dict[str, Any]] = []
    for row in rows:
        cid = str(row.get("campaign_id") or "")
        label = ig_labels.get(campaign_ig.get(cid, ""))
        if not label:
            continue
        copied = dict(row)
        copied["brand"] = label
        out.append(copied)
    return out


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
                "brand": row.get("brand") or None,
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


def merge_campaign_catalog(
    insight_rows: list[dict[str, Any]],
    campaigns: list[dict[str, Any]],
    *,
    since: date,
    until: date,
    brand_by_campaign: dict[str, str],
) -> list[dict[str, Any]]:
    """Добавляет новые кампании периода без показов, если они идут с разрешённого Instagram."""
    seen = {str(row.get("campaign_id") or "") for row in insight_rows if row.get("campaign_id")}
    out = list(insight_rows)
    for camp in campaigns:
        cid = str(camp.get("id") or "")
        name = str(camp.get("name") or "")
        brand = brand_by_campaign.get(cid)
        if not cid or cid in seen or not brand:
            continue
        created_raw = str(camp.get("created_time") or "")[:10]
        if not created_raw:
            continue
        try:
            created = date.fromisoformat(created_raw)
        except ValueError:
            continue
        if created < since or created > until:
            continue
        out.append(
            {
                "campaign_id": cid,
                "campaign_name": name,
                "brand": brand,
                "spend": "0",
                "impressions": "0",
                "clicks": "0",
                "actions": [],
                "date_start": created_raw,
                "date_stop": created_raw,
            }
        )
        seen.add(cid)
    return out


async def fetch_ad_campaigns(token: str, ad_account_id: str) -> list[dict[str, Any]]:
    """Список кампаний ad account (id, name, created_time)."""
    act = normalize_ad_account_id(ad_account_id)
    params: dict[str, Any] = {
        "fields": "id,name,created_time,effective_status",
        "limit": 200,
        "access_token": token,
    }
    out: list[dict[str, Any]] = []
    url: str | None = f"{GRAPH_BASE}/{act}/campaigns"
    async with httpx.AsyncClient(timeout=60.0) as client:
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
    return out


async def _graph_list(token: str, url: str, params: dict[str, Any]) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    async with httpx.AsyncClient(timeout=90.0) as client:
        first = True
        next_url: str | None = url
        query: dict[str, Any] | None = params
        while next_url:
            r = await client.get(next_url, params=query if first else None)
            first = False
            data = r.json()
            if r.status_code >= 400:
                err = data.get("error") if isinstance(data, dict) else None
                msg = (err or {}).get("message") if isinstance(err, dict) else r.text
                raise RuntimeError(msg or f"Meta API {r.status_code}")
            out.extend(data.get("data") or [])
            paging = data.get("paging") or {}
            next_url = paging.get("next") or None
            query = None
    return out


async def fetch_campaign_instagram_ids(token: str, ad_account_id: str) -> dict[str, str]:
    """campaign_id → Instagram user id из объявления (не из названия кампании)."""
    act = normalize_ad_account_id(ad_account_id)
    ads = await _graph_list(
        token,
        f"{GRAPH_BASE}/{act}/ads",
        {
            "fields": "campaign_id,creative{instagram_user_id,instagram_actor_id,object_story_spec}",
            "limit": 200,
            "access_token": token,
        },
    )
    mapped = campaign_ig_map_from_ads(ads)
    adsets = await _graph_list(
        token,
        f"{GRAPH_BASE}/{act}/adsets",
        {
            "fields": "campaign_id,promoted_object",
            "limit": 200,
            "access_token": token,
        },
    )
    for row in adsets:
        cid = str(row.get("campaign_id") or "")
        if not cid or cid in mapped:
            continue
        ig = instagram_id_from_creative(row.get("promoted_object"))
        if ig:
            mapped[cid] = ig
    return mapped


async def resolve_ig_account_labels(token: str, ig_ids: set[str]) -> dict[str, str]:
    """ig id → Ganjina Zamiri | MetodiClinic. Чужие id, включая MetodiOne, не возвращаются."""
    labels: dict[str, str] = {}
    if not ig_ids:
        return labels
    async with httpx.AsyncClient(timeout=30.0) as client:
        for ig_id in ig_ids:
            r = await client.get(
                f"{GRAPH_BASE}/{ig_id}",
                params={"fields": "id,username,name", "access_token": token},
            )
            data = r.json()
            if r.status_code >= 400 or not isinstance(data, dict):
                continue
            label = ig_account_label(str(data.get("username") or ""), str(data.get("name") or ""))
            if label:
                labels[str(ig_id)] = label
    return labels


def brand_subscriber_rows(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Подписчики / лиды / расход: Ganjina Zamiri, MetodiClinic и прочие кампании аккаунта."""
    buckets: dict[str, dict[str, Any]] = {
        b: {"account": b, "followers": 0, "leads": 0, "spend": Decimal("0"), "impressions": 0, "clicks": 0}
        for b in BRAND_ORDER
    }
    for row in rows:
        brand = str(row.get("brand") or "")
        if brand not in buckets:
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
