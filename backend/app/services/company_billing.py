"""Статусы биллинга: демо, ожидание оплаты, ленивая смена demo_trial → demo_expired."""

from __future__ import annotations

from datetime import UTC, datetime

from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Company


async def refresh_company_billing_state(db: AsyncSession, company_id: int) -> Company | None:
    """Если истёк триал — переводим в demo_expired. Возвращает актуальную компанию."""
    c = await db.get(Company, company_id)
    if c is None:
        return None
    if c.billing_status == "demo_trial" and c.trial_ends_at is not None:
        now = datetime.now(UTC)
        te = c.trial_ends_at
        if te.tzinfo is None:
            te = te.replace(tzinfo=UTC)
        if te <= now:
            c.billing_status = "demo_expired"
            await db.flush()
    return c


def company_api_blocked_by_billing(c: Company) -> bool:
    return c.billing_status in ("demo_expired", "payment_pending")
