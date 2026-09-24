"""Автоподключение Instagram Direct из Meta System User токена (маркетинг)."""

from __future__ import annotations

import logging
import secrets
from typing import Any

import httpx
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Integration, IntegrationProvider, Pipeline, PipelineStage
from app.services.meta_ads_client import GRAPH_BASE

logger = logging.getLogger(__name__)

# Два IG-аккаунта клиники (не MetodiOne)
_TARGET_IG = {
    "dr.ganjina.zamir": "Ganjina Zamiri",
    "metodi_clinic": "MetodiClinic",
}


def _match_label(page_name: str, ig_username: str) -> str | None:
    uname = (ig_username or "").strip().lower()
    if uname in _TARGET_IG:
        return _TARGET_IG[uname]
    n = (page_name or "").lower()
    if "ганчин" in n or "zamir" in n:
        return "Ganjina Zamiri"
    if "клиник" in n and "метод" in n:
        return "MetodiClinic"
    return None


async def fetch_target_pages(system_user_token: str) -> list[dict[str, Any]]:
    """Страницы System User → только Ganjina Zamiri и MetodiClinic."""
    token = (system_user_token or "").strip()
    if not token:
        raise RuntimeError("Нет Meta access token")
    async with httpx.AsyncClient(timeout=45.0) as client:
        r = await client.get(
            f"{GRAPH_BASE}/me/accounts",
            params={
                "fields": "id,name,access_token,instagram_business_account{id,username}",
                "access_token": token,
            },
        )
        data = r.json()
        if r.status_code >= 400:
            err = (data.get("error") or {}).get("message") if isinstance(data, dict) else r.text
            raise RuntimeError(err or f"Meta {r.status_code}")
        out: list[dict[str, Any]] = []
        for p in data.get("data") or []:
            if not isinstance(p, dict):
                continue
            ig = p.get("instagram_business_account") or {}
            if not isinstance(ig, dict):
                ig = {}
            label = _match_label(str(p.get("name") or ""), str(ig.get("username") or ""))
            if not label:
                continue
            page_token = str(p.get("access_token") or "").strip()
            if not page_token:
                continue
            out.append(
                {
                    "label": label,
                    "page_id": str(p.get("id") or ""),
                    "page_name": str(p.get("name") or ""),
                    "page_token": page_token,
                    "ig_id": str(ig.get("id") or "") or None,
                    "ig_username": str(ig.get("username") or "") or None,
                }
            )
        return out


async def subscribe_page_messaging(page_id: str, page_token: str) -> bool:
    async with httpx.AsyncClient(timeout=30.0) as client:
        r = await client.post(
            f"{GRAPH_BASE}/{page_id}/subscribed_apps",
            data={
                "subscribed_fields": (
                    "messages,messaging_postbacks,messaging_optins,"
                    "message_deliveries,message_reads,messaging_referrals,leadgen"
                ),
                "access_token": page_token,
            },
        )
        if r.status_code >= 400:
            logger.warning("subscribe page %s failed: %s", page_id, r.text[:400])
            return False
        return bool((r.json() or {}).get("success"))


async def resolve_medicina_intake(
    db: AsyncSession, company_id: int
) -> tuple[int, int]:
    pipe = (
        await db.execute(
            select(Pipeline)
            .where(Pipeline.company_id == company_id, Pipeline.name == "Медицина")
            .limit(1)
        )
    ).scalars().first()
    if pipe is None:
        pipe = (
            await db.execute(select(Pipeline).where(Pipeline.company_id == company_id).order_by(Pipeline.id).limit(1))
        ).scalars().first()
    if pipe is None:
        raise RuntimeError("Нет воронки для Instagram")
    stage = (
        await db.execute(
            select(PipelineStage)
            .where(
                PipelineStage.pipeline_id == pipe.id,
                PipelineStage.company_id == company_id,
                PipelineStage.name == "Новый лид",
            )
            .limit(1)
        )
    ).scalars().first()
    if stage is None:
        stage = (
            await db.execute(
                select(PipelineStage)
                .where(PipelineStage.pipeline_id == pipe.id, PipelineStage.company_id == company_id)
                .order_by(PipelineStage.order, PipelineStage.id)
                .limit(1)
            )
        ).scalars().first()
    if stage is None:
        raise RuntimeError("Нет стадии воронки для Instagram")
    return int(pipe.id), int(stage.id)


async def upsert_instagram_integrations(
    db: AsyncSession,
    *,
    company_id: int,
    pages: list[dict[str, Any]],
    verify_token: str,
) -> list[Integration]:
    pipeline_id, stage_id = await resolve_medicina_intake(db, company_id)
    existing = (
        await db.execute(
            select(Integration).where(
                Integration.company_id == company_id,
                Integration.provider == IntegrationProvider.instagram,
            )
        )
    ).scalars().all()
    by_page: dict[str, Integration] = {}
    by_name: dict[str, Integration] = {}
    for row in existing:
        cfg = row.config if isinstance(row.config, dict) else {}
        pid = str(cfg.get("page_id") or "").strip()
        if pid:
            by_page[pid] = row
        by_name[(row.name or "").strip()] = row

    rows: list[Integration] = []
    for p in pages:
        label = str(p["label"])
        page_id = str(p["page_id"])
        name = f"Instagram · {label}"
        cfg = {
            "page_access_token": p["page_token"],
            "page_id": page_id,
            "page_name": p.get("page_name"),
            "ig_user_id": p.get("ig_id"),
            "ig_username": p.get("ig_username"),
            "use_instagram_graph": False,
            "graph_host": "page",
            "account_label": label,
        }
        row = by_page.get(page_id) or by_name.get(name)
        if row is None:
            row = Integration(
                name=name,
                provider=IntegrationProvider.instagram,
                is_active=True,
                company_id=company_id,
                pipeline_id=pipeline_id,
                stage_id=stage_id,
                secret=verify_token,
                config=cfg,
                manager_close_deal_enabled=False,
            )
            db.add(row)
        else:
            merged = dict(row.config or {})
            merged.update(cfg)
            row.config = merged
            row.secret = verify_token
            row.is_active = True
            row.pipeline_id = pipeline_id
            row.stage_id = stage_id
            row.name = name
        rows.append(row)
        await subscribe_page_messaging(page_id, str(p["page_token"]))

    await db.flush()
    for row in rows:
        await db.refresh(row)
    return rows
