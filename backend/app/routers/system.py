from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.core.deps import CurrentCompanyId, CurrentUser
from app.database import get_db
from app.models import UserRole
from app.services.background_events import list_background_events
from app.services.mail import send_email
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
    if current_user.role not in (UserRole.owner, UserRole.admin):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Недостаточно прав")
    raw = list_background_events(limit)
    return [BackgroundEventRead(**x) for x in raw]


class TariffStatusRead(BaseModel):
    max_active_users: int
    max_integrations: int
    active_users: int
    integrations: int


@router.get("/tariff", response_model=TariffStatusRead)
async def get_tariff_status(
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentUser,
    company_id: CurrentCompanyId,
) -> TariffStatusRead:
    if current_user.role not in (UserRole.owner, UserRole.admin, UserRole.super_owner):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Недостаточно прав")
    au = await count_company_active_users(db, company_id)
    ig = await count_company_integrations(db, company_id)
    return TariffStatusRead(
        max_active_users=settings.tariff_max_active_users,
        max_integrations=settings.tariff_max_integrations,
        active_users=au,
        integrations=ig,
    )

