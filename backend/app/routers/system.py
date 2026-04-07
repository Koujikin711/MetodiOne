from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field

from app.config import settings
from app.core.deps import CurrentUser
from app.models import UserRole
from app.services.mail import send_email

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

