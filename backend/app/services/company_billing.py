"""Статусы биллинга: демо, ожидание оплаты, ленивая смена demo_trial → demo_expired, отложенный тариф."""

from __future__ import annotations

from datetime import UTC, datetime

from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Company, TariffPlan


async def refresh_company_billing_state(db: AsyncSession, company_id: int) -> Company | None:
    """Если истёк триал — demo_expired; если наступила дата отложенного тарифа — применяем. Возвращает компанию."""
    c = await db.get(Company, company_id)
    if c is None:
        return None
    now = datetime.now(UTC)

    sid = getattr(c, "scheduled_tariff_plan_id", None)
    sat = getattr(c, "scheduled_tariff_effective_at", None)
    if sid is not None and sat is not None:
        eff = sat
        if eff.tzinfo is None:
            eff = eff.replace(tzinfo=UTC)
        if eff <= now:
            pl = await db.get(TariffPlan, int(sid))
            if pl is not None and pl.is_active:
                c.tariff_plan_id = pl.id
            c.scheduled_tariff_plan_id = None
            c.scheduled_tariff_effective_at = None
            await db.flush()

    if c.billing_status == "demo_trial" and c.trial_ends_at is not None:
        te = c.trial_ends_at
        if te.tzinfo is None:
            te = te.replace(tzinfo=UTC)
        if te <= now:
            c.billing_status = "demo_expired"
            await db.flush()
    return c


def company_api_blocked_by_billing(c: Company) -> bool:
    return c.billing_status in ("demo_expired", "payment_pending")
