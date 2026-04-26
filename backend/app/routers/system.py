from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.core.deps import CurrentCompanyId, CurrentUser
from app.database import get_db
from app.models import Company, TariffPlan, UserRole
from app.services.background_events import list_background_events
from app.services.mail import send_email
from app.schemas.email_types import RelaxedEmailStr
from app.services.tariff import count_company_active_users, count_company_integrations

router = APIRouter(prefix="/system", tags=["system"])


class SmtpConfigRead(BaseModel):
    host: str
    port: int
    user: str
    from_email: str
    has_password: bool
    public_app_url: str
    public_api_base_url: str


class SmtpTestBody(BaseModel):
    to_email: str = Field(..., min_length=3, max_length=320)


class DemoRequestBody(BaseModel):
    full_name: str = Field(..., min_length=2, max_length=255)
    phone: str = Field(..., min_length=7, max_length=32)
    email: RelaxedEmailStr
    message: str | None = Field(default=None, max_length=2000)


@router.get("/smtp", response_model=SmtpConfigRead)
async def smtp_config(current_user: CurrentUser) -> SmtpConfigRead:
    if current_user.role != UserRole.owner:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Только владелец")
    return SmtpConfigRead(
        host=settings.smtp_host,
        port=settings.smtp_port,
        user=settings.smtp_user,
        from_email=settings.smtp_from,
        has_password=bool(settings.smtp_password),
        public_app_url=settings.public_app_url,
        public_api_base_url=settings.public_api_base_url,
    )


@router.post("/smtp/test")
async def smtp_test(body: SmtpTestBody, current_user: CurrentUser) -> dict:
    if current_user.role != UserRole.owner:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Только владелец")
    ok = send_email(
        body.to_email.strip(),
        "CRM SMTP test",
        "Тестовое письмо CRM: SMTP настроен корректно.",
    )
    if not ok:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="SMTP test failed. Check SMTP_HOST/PORT/USER/PASSWORD/FROM and server network access.",
        )
    return {"ok": True}


@router.post("/demo-request")
async def demo_request(body: DemoRequestBody) -> dict:
    target = (settings.demo_request_to_email or "").strip().lower()
    if not target:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="DEMO_REQUEST_TO_EMAIL is not configured",
        )
    phone_norm = "".join(ch for ch in body.phone if ch.isdigit())
    if len(phone_norm) < 7:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Некорректный телефон")

    subject = "Новая заявка на демо MetodiOne"
    text = (
        "Получена заявка с лендинга.\n\n"
        f"ФИО: {body.full_name.strip()}\n"
        f"Телефон: {body.phone.strip()}\n"
        f"Email: {body.email}\n"
        f"Сообщение: {(body.message or '').strip() or '-'}\n"
    )
    html_body = (
        "<h2>Новая заявка на демо MetodiOne</h2>"
        f"<p><b>ФИО:</b> {body.full_name.strip()}</p>"
        f"<p><b>Телефон:</b> {body.phone.strip()}</p>"
        f"<p><b>Email:</b> {body.email}</p>"
        f"<p><b>Сообщение:</b> {(body.message or '').strip() or '-'}</p>"
    )
    ok = send_email(target, subject, text, html_body=html_body)
    if not ok:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=(
                "Не удалось отправить заявку. Проверьте SMTP_HOST/PORT/USER/PASSWORD/FROM "
                "и доступ сервера к smtp.gmail.com."
            ),
        )
    return {"ok": True}


class BackgroundEventRead(BaseModel):
    ts: str
    source: str
    ok: bool
    message: str
    detail: str | None = None


@router.get("/background-events", response_model=list[BackgroundEventRead])
async def get_background_events(
    current_user: CurrentUser,
    limit: int = Query(50, ge=1, le=100),
) -> list[BackgroundEventRead]:
    if current_user.role not in (UserRole.owner, UserRole.admin, UserRole.super_owner):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Недостаточно прав")
    raw = list_background_events(limit)
    return [BackgroundEventRead(**x) for x in raw]


class TariffStatusRead(BaseModel):
    max_active_users: int
    max_integrations: int
    platform_max_active_users: int
    platform_max_integrations: int
    company_override_active_users: int | None = None
    company_override_integrations: int | None = None
    tariff_plan_id: int | None = None
    tariff_plan_name: str | None = None
    active_users: int
    integrations: int


class TariffAccessRead(BaseModel):
    """Текущий тариф компании: разрешённые функции и подсказки по апгрейду."""

    plan_id: int | None = None
    plan_name: str | None = None
    enabled_features: list[str]
    feature_labels: dict[str, str]
    upgrade_hints: dict[str, list[str]]


@router.get("/tariff", response_model=TariffStatusRead)
async def get_tariff_status(
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentUser,
    company_id: CurrentCompanyId,
) -> TariffStatusRead:
    if current_user.role not in (UserRole.owner, UserRole.admin, UserRole.super_owner):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Недостаточно прав")
    from app.services.tariff_effective import effective_tariff_max_active_users, effective_tariff_max_integrations

    au = await count_company_active_users(db, company_id)
    ig = await count_company_integrations(db, company_id)
    eff_u = await effective_tariff_max_active_users(db, company_id)
    eff_i = await effective_tariff_max_integrations(db, company_id)
    comp = await db.get(Company, company_id)
    plan_name = None
    plan_id = None
    if comp and comp.tariff_plan_id:
        pl = await db.get(TariffPlan, comp.tariff_plan_id)
        if pl is not None:
            plan_id = pl.id
            plan_name = pl.name
    return TariffStatusRead(
        max_active_users=eff_u,
        max_integrations=eff_i,
        platform_max_active_users=int(settings.tariff_max_active_users),
        platform_max_integrations=int(settings.tariff_max_integrations),
        company_override_active_users=comp.tariff_max_active_users if comp else None,
        company_override_integrations=comp.tariff_max_integrations if comp else None,
        tariff_plan_id=plan_id,
        tariff_plan_name=plan_name,
        active_users=au,
        integrations=ig,
    )


@router.get("/tariff-access", response_model=TariffAccessRead)
async def get_tariff_access(
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentUser,
    company_id: CurrentCompanyId,
) -> TariffAccessRead:
    from app.services.tariff_catalog import ALL_FEATURE_KEYS, FEATURE_LABELS
    from app.services.tariff_plan_access import enabled_features_for_company, plan_names_including_feature

    if current_user.role == UserRole.super_owner:
        all_keys = sorted(ALL_FEATURE_KEYS)
        return TariffAccessRead(
            plan_id=None,
            plan_name=None,
            enabled_features=all_keys,
            feature_labels=dict(FEATURE_LABELS),
            upgrade_hints={},
        )
    allowed = await enabled_features_for_company(db, company_id)
    comp = await db.get(Company, company_id)
    plan_id = None
    plan_name = None
    if comp and comp.tariff_plan_id:
        pl = await db.get(TariffPlan, comp.tariff_plan_id)
        if pl is not None:
            plan_id = pl.id
            plan_name = pl.name
    upgrade_hints: dict[str, list[str]] = {}
    for key in sorted(ALL_FEATURE_KEYS):
        if key not in allowed:
            upgrade_hints[key] = await plan_names_including_feature(db, key)
    return TariffAccessRead(
        plan_id=plan_id,
        plan_name=plan_name,
        enabled_features=sorted(allowed),
        feature_labels=dict(FEATURE_LABELS),
        upgrade_hints=upgrade_hints,
    )

