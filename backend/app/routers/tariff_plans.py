"""CRUD тарифных планов платформы (только super_owner)."""

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Response, status
from pydantic import BaseModel, Field
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import CurrentUser
from app.database import get_db
from app.models import TariffPlan, User, UserRole
from app.services.tariff_catalog import ALL_FEATURE_KEYS, FEATURE_LABELS

router = APIRouter(prefix="/tariff-plans", tags=["tariff-plans"])


class TariffPlanRead(BaseModel):
    id: int
    name: str
    max_active_users: int
    max_integrations: int
    enabled_features: list[str]
    warehouse_enabled: bool
    is_active: bool
    sort_order: int


class TariffPlanCreate(BaseModel):
    name: str = Field(..., min_length=2, max_length=120)
    max_active_users: int = Field(default=0, ge=0, le=50000)
    max_integrations: int = Field(default=0, ge=0, le=50000)
    enabled_features: list[str] = Field(default_factory=list)
    warehouse_enabled: bool = True
    is_active: bool = True
    sort_order: int = Field(default=0, ge=0, le=9999)


class TariffPlanUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=2, max_length=120)
    max_active_users: int | None = Field(default=None, ge=0, le=50000)
    max_integrations: int | None = Field(default=None, ge=0, le=50000)
    enabled_features: list[str] | None = None
    warehouse_enabled: bool | None = None
    is_active: bool | None = None
    sort_order: int | None = Field(default=None, ge=0, le=9999)


class FeatureCatalogItem(BaseModel):
    key: str
    label: str


def _ensure_super_owner(user: User) -> None:
    if user.role != UserRole.super_owner:
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
    )


@router.get("/catalog/features", response_model=list[FeatureCatalogItem])
async def feature_catalog(current_user: CurrentUser) -> list[FeatureCatalogItem]:
    _ensure_super_owner(current_user)
    return [FeatureCatalogItem(key=k, label=FEATURE_LABELS[k]) for k in sorted(FEATURE_LABELS)]


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
    p = TariffPlan(
        name=body.name.strip(),
        max_active_users=int(body.max_active_users),
        max_integrations=int(body.max_integrations),
        enabled_features=_norm_features(list(body.enabled_features)),
        warehouse_enabled=bool(body.warehouse_enabled),
        is_active=body.is_active,
        sort_order=int(body.sort_order),
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
        p.enabled_features = _norm_features(list(body.enabled_features))
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
