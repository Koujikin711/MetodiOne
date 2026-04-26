"""Эффективные лимиты тарифа: переопределение на компанию или глобальный env."""

from __future__ import annotations

from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.models import Company, TariffPlan


async def effective_tariff_max_active_users(db: AsyncSession, company_id: int) -> int:
    c = await db.get(Company, company_id)
    if c is not None and c.tariff_max_active_users is not None:
        return int(c.tariff_max_active_users)
    if c is not None and c.tariff_plan_id is not None:
        plan = await db.get(TariffPlan, c.tariff_plan_id)
        if plan is not None and plan.is_active:
            return int(plan.max_active_users)
    return int(settings.tariff_max_active_users)


async def effective_tariff_max_integrations(db: AsyncSession, company_id: int) -> int:
    c = await db.get(Company, company_id)
    if c is not None and c.tariff_max_integrations is not None:
        return int(c.tariff_max_integrations)
    if c is not None and c.tariff_plan_id is not None:
        plan = await db.get(TariffPlan, c.tariff_plan_id)
        if plan is not None and plan.is_active:
            return int(plan.max_integrations)
    return int(settings.tariff_max_integrations)
