"""CRUD тарифных планов платформы (только super_owner)."""

from decimal import Decimal
from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException, Response, status
from pydantic import BaseModel, Field
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import CurrentUser
from app.database import get_db
from app.models import PlatformFeaturePrice, PlatformLimitPrice, TariffPlan, User, UserRole
from app.services.tariff_catalog import ALL_FEATURE_KEYS, FEATURE_LABELS, validate_enabled_features
from app.services.tariff_pricing import (
    LIMIT_INTEGRATION_SLOT,
    LIMIT_USER_SLOT,
    LIMIT_WAREHOUSE_MONTHLY,
    SUPPORTED_CURRENCIES,
    compute_subscription_breakdown,
)

router = APIRouter(prefix="/tariff-plans", tags=["tariff-plans"])

_ALLOWED_LIMIT_KINDS = frozenset({LIMIT_USER_SLOT, LIMIT_INTEGRATION_SLOT, LIMIT_WAREHOUSE_MONTHLY})


class TariffPlanRead(BaseModel):
    id: int
    name: str
    max_active_users: int
    max_integrations: int
    enabled_features: list[str]
    warehouse_enabled: bool
    is_active: bool
    sort_order: int
    billing_currency: str = "TJS"
    discount_percent: float = 0.0


class TariffPlanCreate(BaseModel):
    name: str = Field(..., min_length=2, max_length=120)
    max_active_users: int = Field(default=0, ge=0, le=50000)
    max_integrations: int = Field(default=0, ge=0, le=50000)
    enabled_features: list[str] = Field(default_factory=list)
    warehouse_enabled: bool = True
    is_active: bool = True
    sort_order: int = Field(default=0, ge=0, le=9999)
    billing_currency: str = Field(default="TJS", min_length=3, max_length=3)
    discount_percent: float = Field(default=0.0, ge=0.0, le=100.0)


class TariffPlanUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=2, max_length=120)
    max_active_users: int | None = Field(default=None, ge=0, le=50000)
    max_integrations: int | None = Field(default=None, ge=0, le=50000)
    enabled_features: list[str] | None = None
    warehouse_enabled: bool | None = None
    is_active: bool | None = None
    sort_order: int | None = Field(default=None, ge=0, le=9999)
    billing_currency: str | None = Field(default=None, min_length=3, max_length=3)
    discount_percent: float | None = Field(default=None, ge=0.0, le=100.0)


class FeaturePriceItem(BaseModel):
    feature_key: str = Field(..., min_length=1, max_length=48)
    currency: str = Field(..., min_length=3, max_length=3)
    monthly_amount: float = Field(..., ge=0)


class LimitPriceItem(BaseModel):
    limit_kind: str = Field(..., min_length=1, max_length=32)
    currency: str = Field(..., min_length=3, max_length=3)
    monthly_amount: float = Field(..., ge=0)


class PricingTableRead(BaseModel):
    feature_prices: list[dict[str, Any]]
    limit_prices: list[dict[str, Any]]


class PricingTablePut(BaseModel):
    feature_prices: list[FeaturePriceItem] = Field(default_factory=list)
    limit_prices: list[LimitPriceItem] = Field(default_factory=list)


class FeatureCatalogItem(BaseModel):
    key: str
    label: str


def _ensure_super_owner(user: User) -> None:
    """Доступ к архитектору тарифов: super_owner или сессия «войти как владелец» (JWT с impersonated_by)."""
    if user.role == UserRole.super_owner:
        return
    payload = getattr(user, "_jwt_payload", {}) or {}
    if payload.get("impersonated_by") is not None:
        return
    raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Только super_owner")


def _norm_features(raw: list[str]) -> list[str]:
    return [x for x in {str(s).strip() for s in raw} if x in ALL_FEATURE_KEYS]


def _read(p: TariffPlan) -> TariffPlanRead:
    feats = p.enabled_features if isinstance(p.enabled_features, list) else []
    return TariffPlanRead(
        id=p.id,
        name=p.name,
        max_active_users=int(p.max_active_users),
        max_integrations=int(p.max_integrations),
        enabled_features=[str(x) for x in feats if str(x) in ALL_FEATURE_KEYS],
        warehouse_enabled=bool(getattr(p, "warehouse_enabled", True)),
        is_active=bool(p.is_active),
        sort_order=int(p.sort_order),
        billing_currency=str(getattr(p, "billing_currency", None) or "TJS").upper()[:3],
        discount_percent=float(getattr(p, "discount_percent", 0) or 0),
    )


@router.get("/catalog/features", response_model=list[FeatureCatalogItem])
async def feature_catalog(current_user: CurrentUser) -> list[FeatureCatalogItem]:
    _ensure_super_owner(current_user)
    return [FeatureCatalogItem(key=k, label=FEATURE_LABELS[k]) for k in sorted(FEATURE_LABELS)]


@router.get("/pricing-table", response_model=PricingTableRead)
async def get_pricing_table(
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentUser,
) -> PricingTableRead:
    _ensure_super_owner(current_user)
    frows = (await db.execute(select(PlatformFeaturePrice).order_by(PlatformFeaturePrice.currency, PlatformFeaturePrice.feature_key))).scalars().all()
    lrows = (await db.execute(select(PlatformLimitPrice).order_by(PlatformLimitPrice.currency, PlatformLimitPrice.limit_kind))).scalars().all()
    return PricingTableRead(
        feature_prices=[
            {"feature_key": r.feature_key, "currency": r.currency, "monthly_amount": float(r.monthly_amount or 0)} for r in frows
        ],
        limit_prices=[
            {"limit_kind": r.limit_kind, "currency": r.currency, "monthly_amount": float(r.monthly_amount or 0)} for r in lrows
        ],
    )


@router.put("/pricing-table", response_model=PricingTableRead)
async def put_pricing_table(
    body: PricingTablePut,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentUser,
) -> PricingTableRead:
    _ensure_super_owner(current_user)
    await db.execute(delete(PlatformFeaturePrice))
    await db.execute(delete(PlatformLimitPrice))
    for row in body.feature_prices:
        k = str(row.feature_key).strip()
        if k not in ALL_FEATURE_KEYS:
            raise HTTPException(status_code=400, detail=f"Неизвестная функция в ценах: {k}")
        cur = str(row.currency).strip().upper()[:3]
        if cur not in SUPPORTED_CURRENCIES:
            raise HTTPException(status_code=400, detail=f"Неподдерживаемая валюта: {cur}")
        db.add(PlatformFeaturePrice(feature_key=k, currency=cur, monthly_amount=Decimal(str(row.monthly_amount))))
    for row in body.limit_prices:
        lk = str(row.limit_kind).strip()
        if lk not in _ALLOWED_LIMIT_KINDS:
            raise HTTPException(
                status_code=400,
                detail=f"Неизвестный тип лимита: {lk}. Допустимо: {LIMIT_USER_SLOT}, {LIMIT_INTEGRATION_SLOT}, {LIMIT_WAREHOUSE_MONTHLY}.",
            )
        cur = str(row.currency).strip().upper()[:3]
        if cur not in SUPPORTED_CURRENCIES:
            raise HTTPException(status_code=400, detail=f"Неподдерживаемая валюта: {cur}")
        db.add(PlatformLimitPrice(limit_kind=lk, currency=cur, monthly_amount=Decimal(str(row.monthly_amount))))
    await db.flush()
    await db.commit()
    return await get_pricing_table(db, current_user)


@router.get("/{plan_id}/billing-preview", response_model=dict)
async def billing_preview(
    plan_id: int,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentUser,
) -> dict[str, Any]:
    _ensure_super_owner(current_user)
    p = await db.get(TariffPlan, plan_id)
    if p is None:
        raise HTTPException(status_code=404, detail="Тариф не найден")
    return await compute_subscription_breakdown(db, p, company=None)


@router.get("", response_model=list[TariffPlanRead])
async def list_plans(
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentUser,
) -> list[TariffPlanRead]:
    _ensure_super_owner(current_user)
    rows = (await db.execute(select(TariffPlan).order_by(TariffPlan.sort_order, TariffPlan.id))).scalars().all()
    return [_read(p) for p in rows]


@router.post("", response_model=TariffPlanRead, status_code=status.HTTP_201_CREATED)
async def create_plan(
    body: TariffPlanCreate,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentUser,
) -> TariffPlanRead:
    _ensure_super_owner(current_user)
    exists = await db.scalar(select(TariffPlan.id).where(TariffPlan.name == body.name.strip()))
    if exists is not None:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Тариф с таким названием уже есть")
    feats = _norm_features(list(body.enabled_features))
    ok, err = validate_enabled_features(feats)
    if not ok:
        raise HTTPException(status_code=400, detail=err or "Несовместимый набор функций")
    bc = str(body.billing_currency).strip().upper()[:3]
    if bc not in SUPPORTED_CURRENCIES:
        raise HTTPException(status_code=400, detail=f"Валюта должна быть одной из: {', '.join(sorted(SUPPORTED_CURRENCIES))}")
    p = TariffPlan(
        name=body.name.strip(),
        max_active_users=int(body.max_active_users),
        max_integrations=int(body.max_integrations),
        enabled_features=feats,
        warehouse_enabled=bool(body.warehouse_enabled),
        is_active=body.is_active,
        sort_order=int(body.sort_order),
        billing_currency=bc,
        discount_percent=Decimal(str(body.discount_percent)),
    )
    db.add(p)
    await db.flush()
    await db.refresh(p)
    return _read(p)


@router.patch("/{plan_id}", response_model=TariffPlanRead)
async def update_plan(
    plan_id: int,
    body: TariffPlanUpdate,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentUser,
) -> TariffPlanRead:
    _ensure_super_owner(current_user)
    p = await db.get(TariffPlan, plan_id)
    if p is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Тариф не найден")
    data = body.model_dump(exclude_unset=True)
    if "name" in data and body.name is not None:
        taken = await db.scalar(select(TariffPlan.id).where(TariffPlan.name == body.name.strip(), TariffPlan.id != plan_id))
        if taken is not None:
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Тариф с таким названием уже есть")
        p.name = body.name.strip()
    if "max_active_users" in data and body.max_active_users is not None:
        p.max_active_users = int(body.max_active_users)
    if "max_integrations" in data and body.max_integrations is not None:
        p.max_integrations = int(body.max_integrations)
    if "enabled_features" in data and body.enabled_features is not None:
        feats = _norm_features(list(body.enabled_features))
        ok, err = validate_enabled_features(feats)
        if not ok:
            raise HTTPException(status_code=400, detail=err or "Несовместимый набор функций")
        p.enabled_features = feats
    if "billing_currency" in data and body.billing_currency is not None:
        bc = str(body.billing_currency).strip().upper()[:3]
        if bc not in SUPPORTED_CURRENCIES:
            raise HTTPException(status_code=400, detail=f"Валюта должна быть одной из: {', '.join(sorted(SUPPORTED_CURRENCIES))}")
        p.billing_currency = bc
    if "discount_percent" in data and body.discount_percent is not None:
        p.discount_percent = Decimal(str(body.discount_percent))
    if "is_active" in data and body.is_active is not None:
        p.is_active = bool(body.is_active)
    if "sort_order" in data and body.sort_order is not None:
        p.sort_order = int(body.sort_order)
    if "warehouse_enabled" in data and body.warehouse_enabled is not None:
        p.warehouse_enabled = bool(body.warehouse_enabled)
    await db.flush()
    await db.refresh(p)
    return _read(p)


@router.delete("/{plan_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_plan(
    plan_id: int,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentUser,
) -> Response:
    _ensure_super_owner(current_user)
    p = await db.get(TariffPlan, plan_id)
    if p is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Тариф не найден")
    await db.execute(delete(TariffPlan).where(TariffPlan.id == plan_id))
    await db.flush()
    return Response(status_code=status.HTTP_204_NO_CONTENT)
