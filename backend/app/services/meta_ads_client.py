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

# Кампании только с аккаунтов / брендов: Ganjina, Zamiri, Metodi_Clinic
_ALLOWED_CAMPAIGN_RE = re.compile(
    r"ganjina|ганчин|zamiri|замири|metodi[_\s-]?clinic|metodione|metodi\s*clinic",
    re.IGNORECASE,
)

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


def normalize_ad_account_id(raw: str) -> str:
    s = (raw or "").strip()
    if not s:
        return ""
    if s.startswith("act_"):
        return s
    digits = "".join(ch for ch in s if ch.isdigit())
    return f"act_{digits}" if digits else s


def is_allowed_campaign_name(name: str | None) -> bool:
    """Оставляем только Ganjina / Zamiri / Metodi_Clinic (и близкие названия)."""
    return bool(_ALLOWED_CAMPAIGN_RE.search(name or ""))


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
) -> list[dict[str, Any]]:
    act = normalize_ad_account_id(ad_account_id)
    fields = (
        "campaign_id,campaign_name,spend,impressions,clicks,cpc,ctr,reach,frequency,actions"
        if level == "campaign"
        else "spend,impressions,clicks,cpc,ctr,reach,frequency,actions"
    )
    params: dict[str, Any] = {
        "fields": fields,
        "level": level,
        "time_range": json.dumps({"since": since.isoformat(), "until": until.isoformat()}),
        "limit": 200,
        "access_token": token,
    }
    out: list[dict[str, Any]] = []
    url: str | None = f"{GRAPH_BASE}/{act}/insights"
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
    if level == "campaign":
        out = [row for row in out if is_allowed_campaign_name(str(row.get("campaign_name") or ""))]
    return out


def summarize_rows(rows: list[dict[str, Any]]) -> dict[str, Any]:
    spend = Decimal("0")
    impressions = 0
    clicks = 0
    leads = 0
    for row in rows:
        spend += Decimal(str(row.get("spend") or 0))
        impressions += int(float(row.get("impressions") or 0))
        clicks += int(float(row.get("clicks") or 0))
        leads += _row_leads(row.get("actions"))
    cpl = (spend / Decimal(leads)).quantize(Decimal("0.01")) if leads > 0 else None
    return {
        "spend": spend,
        "impressions": impressions,
        "clicks": clicks,
        "leads": leads,
        "cost_per_lead": cpl,
    }


def campaign_rows(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    for row in rows:
        spend = Decimal(str(row.get("spend") or 0))
        leads = _row_leads(row.get("actions"))
        out.append(
            {
                "campaign_id": str(row.get("campaign_id") or ""),
                "campaign_name": str(row.get("campaign_name") or "—"),
                "spend": spend,
                "impressions": int(float(row.get("impressions") or 0)),
                "clicks": int(float(row.get("clicks") or 0)),
                "leads": leads,
                "cpc": Decimal(str(row.get("cpc") or 0)) if row.get("cpc") not in (None, "") else None,
                "ctr": Decimal(str(row.get("ctr") or 0)) if row.get("ctr") not in (None, "") else None,
                "cost_per_lead": (spend / Decimal(leads)).quantize(Decimal("0.01")) if leads > 0 else None,
            }
        )
    out.sort(key=lambda x: x["spend"], reverse=True)
    return out
