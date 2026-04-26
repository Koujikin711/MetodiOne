"""Проверка доступа компании к функциям по выбранному тарифному плану."""

from __future__ import annotations

import json
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Company, TariffPlan
from app.services.tariff_catalog import ALL_FEATURE_KEYS, FEATURE_LABELS


def _normalize_feature_list(raw: Any) -> set[str]:
    if raw is None:
        return set()
    if isinstance(raw, str):
        try:
            raw = json.loads(raw)
        except json.JSONDecodeError:
            return set()
    if not isinstance(raw, list):
        return set()
    out: set[str] = set()
    for x in raw:
        k = str(x).strip()
        if k in ALL_FEATURE_KEYS:
            out.add(k)
    return out


async def enabled_features_for_company(db: AsyncSession, company_id: int) -> set[str]:
    """Без привязанного тарифа — все функции (обратная совместимость)."""
    c = await db.get(Company, company_id)
    if c is None or c.tariff_plan_id is None:
        return set(ALL_FEATURE_KEYS)
    plan = await db.get(TariffPlan, c.tariff_plan_id)
    if plan is None or not plan.is_active:
        return set(ALL_FEATURE_KEYS)
    feats = _normalize_feature_list(plan.enabled_features)
    if not feats:
        return set()
    return feats


async def plan_names_including_feature(db: AsyncSession, feature_key: str) -> list[str]:
    rows = (await db.execute(select(TariffPlan).where(TariffPlan.is_active.is_(True)).order_by(TariffPlan.sort_order, TariffPlan.id))).scalars().all()
    names: list[str] = []
    for p in rows:
        if feature_key in _normalize_feature_list(p.enabled_features):
            names.append(p.name)
    return names


async def company_has_tariff_feature(db: AsyncSession, company_id: int, feature_key: str) -> bool:
    if feature_key not in ALL_FEATURE_KEYS:
        return True
    allowed = await enabled_features_for_company(db, company_id)
    return feature_key in allowed


def tariff_block_detail(feature_key: str, upgrade_names: list[str]) -> dict[str, Any]:
    label = FEATURE_LABELS.get(feature_key, feature_key)
    if upgrade_names:
        msg = (
            f"Функция «{label}» недоступна в вашем тарифе. "
            f"Для доступа приобретите тариф: {', '.join(upgrade_names)}."
        )
    else:
        msg = f"Функция «{label}» недоступна в вашем тарифе. Обратитесь к администратору платформы для подключения."
    return {
        "code": "tariff_feature_required",
        "message": msg,
        "feature": feature_key,
        "feature_label": label,
        "upgrade_tariff_names": upgrade_names,
    }
