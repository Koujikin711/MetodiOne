"""Биллинг демо: выбор тарифа, ожидание оплаты, настройки платформы (super_owner)."""

from __future__ import annotations

import html
from datetime import datetime
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.core.deps import CurrentCompanyId, CurrentUser
from app.database import get_db
from app.models import Company, PlatformSettings, TariffPlan, UserRole
from app.services.company_billing import refresh_company_billing_state
from app.services.mail import send_email

router = APIRouter(prefix="/billing", tags=["billing"])


class TariffChoiceRead(BaseModel):
    id: int
    name: str
    max_active_users: int
    max_integrations: int
    warehouse_enabled: bool


class BillingStatusRead(BaseModel):
    billing_status: str
    trial_ends_at: datetime | None
    pending_tariff_plan_id: int | None
    pending_tariff_plan_name: str | None
    current_tariff_plan_id: int | None
    current_tariff_plan_name: str | None
    plans: list[TariffChoiceRead]


class SelectTariffBody(BaseModel):
    tariff_plan_id: int = Field(..., ge=1)


class PlatformSettingsRead(BaseModel):
    demo_trial_days: int


class PlatformSettingsPatch(BaseModel):
    demo_trial_days: int = Field(..., ge=1, le=365)


class PendingCompanyRead(BaseModel):
    id: int
    name: str
    contact_email: str | None
    billing_status: str
    pending_tariff_plan_id: int | None
    pending_tariff_plan_name: str | None
    tariff_plan_id: int | None
    tariff_plan_name: str | None


class ConfirmBillingBody(BaseModel):
    company_id: int = Field(..., ge=1)


def _ensure_super_owner(user) -> None:
    if user.role != UserRole.super_owner:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Только super_owner")


def _ensure_owner(user) -> None:
    if user.role != UserRole.owner:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Только владелец компании")


def _ensure_owner_or_admin(user) -> None:
    if user.role not in (UserRole.owner, UserRole.admin):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Только владелец или администратор")


def _plan_choices(rows: list[TariffPlan]) -> list[TariffChoiceRead]:
    return [
        TariffChoiceRead(
            id=p.id,
            name=p.name,
            max_active_users=int(p.max_active_users),
            max_integrations=int(p.max_integrations),
            warehouse_enabled=bool(getattr(p, "warehouse_enabled", True)),
        )
        for p in rows
        if p.is_active
    ]


@router.get("/status", response_model=BillingStatusRead)
async def billing_status(
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentUser,
    company_id: CurrentCompanyId,
) -> BillingStatusRead:
    _ensure_owner(current_user)
    c = await refresh_company_billing_state(db, company_id)
    if c is None:
        raise HTTPException(status_code=404, detail="Компания не найдена")
    await db.commit()

    rows = (
        await db.execute(select(TariffPlan).where(TariffPlan.is_active.is_(True)).order_by(TariffPlan.sort_order, TariffPlan.id))
    ).scalars().all()
    plans = _plan_choices(list(rows))

    pending_name = None
    if c.pending_tariff_plan_id:
        pp = await db.get(TariffPlan, c.pending_tariff_plan_id)
        pending_name = pp.name if pp else None
    cur_name = None
    if c.tariff_plan_id:
        cp = await db.get(TariffPlan, c.tariff_plan_id)
        cur_name = cp.name if cp else None

    return BillingStatusRead(
        billing_status=str(c.billing_status or "active"),
        trial_ends_at=c.trial_ends_at,
        pending_tariff_plan_id=c.pending_tariff_plan_id,
        pending_tariff_plan_name=pending_name,
        current_tariff_plan_id=c.tariff_plan_id,
        current_tariff_plan_name=cur_name,
        plans=plans,
    )


@router.post("/select-tariff", response_model=BillingStatusRead)
async def select_tariff(
    body: SelectTariffBody,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentUser,
    company_id: CurrentCompanyId,
) -> BillingStatusRead:
    _ensure_owner(current_user)
    c = await refresh_company_billing_state(db, company_id)
    if c is None:
        raise HTTPException(status_code=404, detail="Компания не найдена")
    if c.billing_status not in ("demo_expired", "payment_pending"):
        raise HTTPException(
            status_code=400,
            detail="Выбор тарифа доступен после окончания демо или при ожидании оплаты.",
        )
    pl = await db.get(TariffPlan, body.tariff_plan_id)
    if pl is None or not pl.is_active:
        raise HTTPException(status_code=400, detail="Тариф не найден или отключён")

    c.pending_tariff_plan_id = pl.id
    c.billing_status = "payment_pending"
    await db.flush()
    await db.commit()
    c = await db.get(Company, company_id)
    admin = (settings.demo_request_to_email or "").strip().lower()
    if admin:
        plain = (
            f"Компания запросила тариф после демо.\n\n"
            f"Компания: {c.name} (id={c.id})\n"
            f"Выбранный тариф: {pl.name} (id={pl.id})\n"
            f"Email компании: {c.contact_email or '-'}\n\n"
            "Проверьте оплату и подтвердите в админке: POST /api/billing/confirm-payment\n"
        )
        subj = f"[MetodiOne] Выбор тарифа: {c.name} → {pl.name}"
        html_body = f"""<!DOCTYPE html><html><body style="font-family:system-ui,sans-serif;">
<h2>Выбор тарифа</h2>
<p><b>Компания:</b> {html.escape(c.name)} (id={c.id})</p>
<p><b>Тариф:</b> {html.escape(pl.name)} (id={pl.id})</p>
<p><b>Контакт:</b> {html.escape(c.contact_email or '-')}</p>
<p>Проверьте оплату и подтвердите включение тарифа в панели супер-владельца.</p>
</body></html>"""
        send_email(admin, subj, plain, html_body=html_body)

    if c is None:
        raise HTTPException(status_code=404, detail="Компания не найдена")
    rows = (
        await db.execute(select(TariffPlan).where(TariffPlan.is_active.is_(True)).order_by(TariffPlan.sort_order, TariffPlan.id))
    ).scalars().all()
    plans = _plan_choices(list(rows))
    pending_name = None
    if c.pending_tariff_plan_id:
        pp = await db.get(TariffPlan, c.pending_tariff_plan_id)
        pending_name = pp.name if pp else None
    cur_name = None
    if c.tariff_plan_id:
        cp = await db.get(TariffPlan, c.tariff_plan_id)
        cur_name = cp.name if cp else None
    return BillingStatusRead(
        billing_status=str(c.billing_status or "active"),
        trial_ends_at=c.trial_ends_at,
        pending_tariff_plan_id=c.pending_tariff_plan_id,
        pending_tariff_plan_name=pending_name,
        current_tariff_plan_id=c.tariff_plan_id,
        current_tariff_plan_name=cur_name,
        plans=plans,
    )


@router.get("/platform-settings", response_model=PlatformSettingsRead)
async def get_platform_settings(
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentUser,
) -> PlatformSettingsRead:
    _ensure_super_owner(current_user)
    row = await db.get(PlatformSettings, 1)
    if row is None:
        return PlatformSettingsRead(demo_trial_days=14)
    return PlatformSettingsRead(demo_trial_days=max(1, min(int(row.demo_trial_days or 14), 365)))


@router.patch("/platform-settings", response_model=PlatformSettingsRead)
async def patch_platform_settings(
    body: PlatformSettingsPatch,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentUser,
) -> PlatformSettingsRead:
    _ensure_super_owner(current_user)
    row = await db.get(PlatformSettings, 1)
    if row is None:
        row = PlatformSettings(id=1, demo_trial_days=int(body.demo_trial_days))
        db.add(row)
    else:
        row.demo_trial_days = int(body.demo_trial_days)
    await db.flush()
    await db.commit()
    return PlatformSettingsRead(demo_trial_days=int(body.demo_trial_days))


@router.get("/pending-payments", response_model=list[PendingCompanyRead])
async def list_pending_payments(
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentUser,
) -> list[PendingCompanyRead]:
    _ensure_super_owner(current_user)
    rows = (
        await db.execute(select(Company).where(Company.billing_status == "payment_pending").order_by(Company.id))
    ).scalars().all()
    out: list[PendingCompanyRead] = []
    for c in rows:
        pn = await db.get(TariffPlan, c.pending_tariff_plan_id) if c.pending_tariff_plan_id else None
        tn = await db.get(TariffPlan, c.tariff_plan_id) if c.tariff_plan_id else None
        out.append(
            PendingCompanyRead(
                id=c.id,
                name=c.name,
                contact_email=c.contact_email,
                billing_status=str(c.billing_status),
                pending_tariff_plan_id=c.pending_tariff_plan_id,
                pending_tariff_plan_name=pn.name if pn else None,
                tariff_plan_id=c.tariff_plan_id,
                tariff_plan_name=tn.name if tn else None,
            ),
        )
    return out


@router.post("/confirm-payment", response_model=PendingCompanyRead)
async def confirm_payment(
    body: ConfirmBillingBody,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentUser,
) -> PendingCompanyRead:
    _ensure_super_owner(current_user)
    c = await db.get(Company, body.company_id)
    if c is None:
        raise HTTPException(status_code=404, detail="Компания не найдена")
    if c.billing_status != "payment_pending" or c.pending_tariff_plan_id is None:
        raise HTTPException(status_code=400, detail="Компания не в статусе ожидания оплаты или тариф не выбран")
    pl = await db.get(TariffPlan, c.pending_tariff_plan_id)
    if pl is None or not pl.is_active:
        raise HTTPException(status_code=400, detail="Выбранный тариф недоступен")
    c.tariff_plan_id = pl.id
    c.pending_tariff_plan_id = None
    c.billing_status = "subscribed"
    await db.flush()
    await db.commit()
    return PendingCompanyRead(
        id=c.id,
        name=c.name,
        contact_email=c.contact_email,
        billing_status=str(c.billing_status),
        pending_tariff_plan_id=None,
        pending_tariff_plan_name=None,
        tariff_plan_id=c.tariff_plan_id,
        tariff_plan_name=pl.name,
    )
