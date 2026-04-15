import html
import secrets
import string
from typing import Annotated
from urllib.parse import urlparse, urlunparse

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import CurrentCompanyId, CurrentUser
from app.core.security import create_access_token, hash_password
from app.config import settings
from app.database import get_db
from app.models import Company, Lead, Pipeline, Task, User, UserRole
from app.services.mail import send_email

router = APIRouter(prefix="/companies", tags=["companies"])


class CompanyRead(BaseModel):
    id: int
    name: str
    contact_email: str | None = None
    is_active: bool
    users_count: int = 0
    leads_count: int = 0
    pipelines_count: int = 0


class CompanyCreate(BaseModel):
    name: str = Field(..., min_length=2, max_length=255)
    owner_email: str = Field(..., min_length=3, max_length=320)
    owner_full_name: str | None = Field(default=None, min_length=2, max_length=255)
    external_db_dsn: str | None = Field(default=None, max_length=2000)


class UpdateCompanyStatusBody(BaseModel):
    is_active: bool


class SwitchCompanyBody(BaseModel):
    company_id: int = Field(..., ge=1)


def _ensure_super_owner(user: User) -> None:
    if user.role != UserRole.super_owner:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Только super_owner")


def _rand_password() -> str:
    alphabet = string.ascii_letters + string.digits
    return "".join(secrets.choice(alphabet) for _ in range(12))


def _invite_app_base() -> str:
    raw = (settings.public_app_url or "").strip()
    if not raw:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Задайте PUBLIC_APP_URL, чтобы отправлять ссылку доступа владельцу компании",
        )
    if not raw.startswith(("http://", "https://")):
        raw = "https://" + raw
    p = urlparse(raw)
    if p.scheme not in ("http", "https") or not p.netloc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="PUBLIC_APP_URL указан неверно")
    path = (p.path or "").rstrip("/")
    if path == "/":
        path = ""
    return urlunparse((p.scheme, p.netloc, path, "", "", "")).rstrip("/")


def _build_invite_url(invite_token: str) -> str:
    return f"{_invite_app_base()}/login?invite={invite_token}"


@router.get("", response_model=list[CompanyRead])
async def list_companies(
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentUser,
) -> list[CompanyRead]:
    _ensure_super_owner(current_user)
    rows = (await db.execute(select(Company).order_by(Company.id.asc()))).scalars().all()
    out: list[CompanyRead] = []
    for c in rows:
        users_count = int(await db.scalar(select(func.count(User.id)).where(User.company_id == c.id)) or 0)
        leads_count = int(await db.scalar(select(func.count(Lead.id)).where(Lead.company_id == c.id)) or 0)
        pipelines_count = int(await db.scalar(select(func.count(Pipeline.id)).where(Pipeline.company_id == c.id)) or 0)
        out.append(
            CompanyRead(
                id=c.id,
                name=c.name,
                contact_email=c.contact_email,
                is_active=c.is_active,
                users_count=users_count,
                leads_count=leads_count,
                pipelines_count=pipelines_count,
            )
        )
    return out


@router.post("", response_model=CompanyRead, status_code=status.HTTP_201_CREATED)
async def create_company(
    body: CompanyCreate,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentUser,
) -> CompanyRead:
    _ensure_super_owner(current_user)
    exists = await db.scalar(select(Company.id).where(Company.name == body.name.strip()))
    if exists is not None:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Компания с таким названием уже существует")
    owner_email = str(body.owner_email).strip().lower()
    if "@" not in owner_email or "." not in owner_email.split("@")[-1]:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Некорректный email владельца")
    user_exists = await db.scalar(select(User.id).where(User.email == owner_email))
    if user_exists is not None:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Пользователь с таким email уже существует")

    temp_password = _rand_password()
    invite_token = secrets.token_urlsafe(32)
    owner_name = (body.owner_full_name or "").strip() or None

    c = Company(
        name=body.name.strip(),
        contact_email=owner_email,
        external_db_dsn=(body.external_db_dsn or "").strip() or None,
        is_active=True,
    )
    db.add(c)
    await db.flush()
    owner = User(
        company_id=c.id,
        email=owner_email,
        full_name=owner_name,
        role=UserRole.owner,
        hashed_password=hash_password(temp_password),
        invite_token=invite_token,
        is_active=True,
    )
    db.add(owner)
    await db.flush()

    invite_url = _build_invite_url(invite_token)
    safe_email = html.escape(owner_email)
    safe_pw = html.escape(temp_password)
    safe_url = html.escape(invite_url, quote=True)
    plain = (
        "Здравствуйте!\n\n"
        "Вам создан доступ владельца компании в CRM.\n"
        f"Логин: {owner_email}\n"
        f"Пароль: {temp_password}\n"
        f"Вход: {invite_url}\n\n"
        "После входа рекомендуем сменить пароль."
    )
    html_body = f"""<!DOCTYPE html>
<html><body style="font-family:system-ui,Segoe UI,sans-serif;line-height:1.5;color:#1e293b;background:#f8fafc;padding:24px;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:520px;margin:0 auto;background:#fff;border-radius:16px;box-shadow:0 4px 24px rgba(15,23,42,.08);overflow:hidden;">
    <tr><td style="padding:28px 28px 8px;">
      <h1 style="margin:0;font-size:20px;color:#0f172a;">Доступ к CRM компании</h1>
      <p style="margin:16px 0 0;font-size:15px;">Вам выдан доступ владельца компании. Данные для входа:</p>
    </td></tr>
    <tr><td style="padding:8px 28px;">
      <p style="margin:8px 0;"><strong>Логин:</strong> {safe_email}</p>
      <p style="margin:8px 0;"><strong>Пароль:</strong> <code style="background:#f1f5f9;padding:2px 8px;border-radius:6px;">{safe_pw}</code></p>
    </td></tr>
    <tr><td style="padding:16px 28px 28px;">
      <a href="{safe_url}" style="display:inline-block;background:linear-gradient(135deg,#6366f1,#8b5cf6);color:#fff;text-decoration:none;padding:12px 24px;border-radius:12px;font-weight:600;font-size:15px;">Войти в CRM</a>
      <p style="margin:20px 0 0;font-size:13px;color:#64748b;">Если кнопка не открывается, используйте ссылку:<br/><span style="word-break:break-all;color:#475569;">{safe_url}</span></p>
    </td></tr>
  </table>
</body></html>"""
    sent = send_email(owner_email, "Доступ владельца в CRM", plain, html_body=html_body)
    if not sent:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Не удалось отправить письмо доступа владельцу. Проверьте SMTP настройки.",
        )

    await db.refresh(c)
    return CompanyRead(id=c.id, name=c.name, contact_email=c.contact_email, is_active=c.is_active)


@router.get("/current", response_model=CompanyRead)
async def current_company(
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentUser,
    company_id: CurrentCompanyId,
) -> CompanyRead:
    _ = current_user
    c = await db.get(Company, company_id)
    if c is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Компания не найдена")
    users_count = int(await db.scalar(select(func.count(User.id)).where(User.company_id == c.id)) or 0)
    leads_count = int(await db.scalar(select(func.count(Lead.id)).where(Lead.company_id == c.id)) or 0)
    pipelines_count = int(await db.scalar(select(func.count(Pipeline.id)).where(Pipeline.company_id == c.id)) or 0)
    return CompanyRead(
        id=c.id,
        name=c.name,
        contact_email=c.contact_email,
        is_active=c.is_active,
        users_count=users_count,
        leads_count=leads_count,
        pipelines_count=pipelines_count,
    )


@router.patch("/{company_id}/status", response_model=CompanyRead)
async def update_company_status(
    company_id: int,
    body: UpdateCompanyStatusBody,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentUser,
) -> CompanyRead:
    _ensure_super_owner(current_user)
    c = await db.get(Company, company_id)
    if c is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Компания не найдена")
    c.is_active = body.is_active
    await db.flush()
    users_count = int(await db.scalar(select(func.count(User.id)).where(User.company_id == c.id)) or 0)
    leads_count = int(await db.scalar(select(func.count(Lead.id)).where(Lead.company_id == c.id)) or 0)
    pipelines_count = int(await db.scalar(select(func.count(Pipeline.id)).where(Pipeline.company_id == c.id)) or 0)
    return CompanyRead(
        id=c.id,
        name=c.name,
        contact_email=c.contact_email,
        is_active=c.is_active,
        users_count=users_count,
        leads_count=leads_count,
        pipelines_count=pipelines_count,
    )


@router.post("/switch")
async def switch_company(
    body: SwitchCompanyBody,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentUser,
) -> dict[str, str]:
    _ensure_super_owner(current_user)
    c = await db.get(Company, body.company_id)
    if c is None or not c.is_active:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Компания не найдена")
    token = create_access_token(
        str(current_user.id),
        extra={"role": current_user.role.value, "company_id": c.id},
    )
    return {"access_token": token, "token_type": "bearer"}


@router.get("/{company_id}/structure")
async def company_structure(
    company_id: int,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentUser,
) -> dict:
    _ensure_super_owner(current_user)
    c = await db.get(Company, company_id)
    if c is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Компания не найдена")
    users = (
        await db.execute(
            select(User.id, User.full_name, User.email, User.role).where(User.company_id == company_id, User.is_active.is_(True))
        )
    ).all()
    pipelines = (await db.execute(select(Pipeline.id, Pipeline.name).where(Pipeline.company_id == company_id))).all()
    tasks_open = int(
        await db.scalar(
            select(func.count(Task.id)).where(
                Task.company_id == company_id,
                Task.status.in_(("pending", "in_progress")),
            )
        )
        or 0
    )
    return {
        "company": {"id": c.id, "name": c.name, "is_active": c.is_active},
        "users": [
            {
                "id": int(uid),
                "full_name": (str(fn) if fn else None),
                "email": str(email),
                "role": role.value if hasattr(role, "value") else str(role),
            }
            for uid, fn, email, role in users
        ],
        "pipelines": [{"id": int(pid), "name": str(name)} for pid, name in pipelines],
        "leads_count": int(await db.scalar(select(func.count(Lead.id)).where(Lead.company_id == company_id)) or 0),
        "tasks_open_count": tasks_open,
    }
