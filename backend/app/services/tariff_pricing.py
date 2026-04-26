"""Расчёт стоимости подписки из каталога цен функций и лимитов (мультивалюта)."""

from __future__ import annotations

from decimal import Decimal
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Company, PlatformFeaturePrice, PlatformLimitPrice, TariffPlan
from app.services.tariff_catalog import FEATURE_LABELS

SUPPORTED_CURRENCIES = frozenset({"TJS", "USD", "RUB"})

LIMIT_USER_SLOT = "user_slot"
LIMIT_INTEGRATION_SLOT = "integration_slot"
LIMIT_WAREHOUSE_MONTHLY = "warehouse_monthly"


def _norm_currency(raw: str | None) -> str:
    c = (raw or "TJS").strip().upper()
    return c if c in SUPPORTED_CURRENCIES else "TJS"


def _effective_discount_percent(plan: TariffPlan, company: Company | None) -> Decimal:
    if company is not None and company.billing_discount_percent is not None:
        return Decimal(str(company.billing_discount_percent))
    return Decimal(str(plan.discount_percent or 0))


async def _feature_price_map(db: AsyncSession, currency: str) -> dict[str, Decimal]:
    rows = (await db.execute(select(PlatformFeaturePrice).where(PlatformFeaturePrice.currency == currency))).scalars().all()
    return {r.feature_key: Decimal(str(r.monthly_amount or 0)) for r in rows}


async def _limit_price_map(db: AsyncSession, currency: str) -> dict[str, Decimal]:
    rows = (await db.execute(select(PlatformLimitPrice).where(PlatformLimitPrice.currency == currency))).scalars().all()
    return {r.limit_kind: Decimal(str(r.monthly_amount or 0)) for r in rows}


async def compute_subscription_breakdown(
    db: AsyncSession,
    plan: TariffPlan,
    *,
    company: Company | None = None,
) -> dict[str, Any]:
    """Список строк, subtotal, discount_percent, discount_amount, total, currency."""
    currency = _norm_currency(getattr(plan, "billing_currency", None))
    feats = plan.enabled_features if isinstance(plan.enabled_features, list) else []
    feat_keys = [str(x).strip() for x in feats if str(x).strip()]

    fprices = await _feature_price_map(db, currency)
    lprices = await _limit_price_map(db, currency)

    lines: list[dict[str, Any]] = []
    subtotal = Decimal("0")

    for key in feat_keys:
        amt = fprices.get(key, Decimal("0"))
        label = FEATURE_LABELS.get(key, key)
        lines.append({"kind": "feature", "key": key, "label": label, "amount": str(amt.quantize(Decimal("0.01"))), "quantity": 1})
        subtotal += amt

    mu = int(plan.max_active_users or 0)
    if mu > 0:
        unit = lprices.get(LIMIT_USER_SLOT, Decimal("0"))
        amt = (unit * Decimal(mu)).quantize(Decimal("0.01"))
        lines.append(
            {
                "kind": "limit",
                "key": LIMIT_USER_SLOT,
                "label": f"Лимит пользователей ×{mu}",
                "amount": str(amt),
                "quantity": mu,
                "unit_amount": str(unit.quantize(Decimal("0.01"))),
            },
        )
        subtotal += amt

    mi = int(plan.max_integrations or 0)
    if mi > 0:
        unit = lprices.get(LIMIT_INTEGRATION_SLOT, Decimal("0"))
        amt = (unit * Decimal(mi)).quantize(Decimal("0.01"))
        lines.append(
            {
                "kind": "limit",
                "key": LIMIT_INTEGRATION_SLOT,
                "label": f"Лимит интеграций ×{mi}",
                "amount": str(amt),
                "quantity": mi,
                "unit_amount": str(unit.quantize(Decimal("0.01"))),
            },
        )
        subtotal += amt

    if bool(getattr(plan, "warehouse_enabled", True)):
        amt = lprices.get(LIMIT_WAREHOUSE_MONTHLY, Decimal("0")).quantize(Decimal("0.01"))
        if amt > 0:
            lines.append(
                {
                    "kind": "limit",
                    "key": LIMIT_WAREHOUSE_MONTHLY,
                    "label": "Склад в финансах (месяц)",
                    "amount": str(amt),
                    "quantity": 1,
                },
            )
            subtotal += amt

    disc_pct = _effective_discount_percent(plan, company)
    if disc_pct < 0:
        disc_pct = Decimal("0")
    if disc_pct > 100:
        disc_pct = Decimal("100")
    disc_amt = (subtotal * (disc_pct / Decimal("100"))).quantize(Decimal("0.01"))
    total = (subtotal - disc_amt).quantize(Decimal("0.01"))
    if total < 0:
        total = Decimal("0")

    return {
        "currency": currency,
        "lines": lines,
        "subtotal": str(subtotal.quantize(Decimal("0.01"))),
        "discount_percent": str(disc_pct.quantize(Decimal("0.01"))),
        "discount_amount": str(disc_amt),
        "total": str(total),
    }
