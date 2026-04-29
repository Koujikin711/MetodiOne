import csv
import html
import io
import secrets
import string
from decimal import Decimal
from datetime import UTC, datetime, timedelta
from typing import Annotated
from urllib.parse import urlparse, urlunparse

from fastapi import APIRouter, Depends, HTTPException, Query, status
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import CurrentCompanyId, CurrentUser
from app.core.security import create_access_token, hash_password, jwt_claims_for_user
from app.config import settings
from app.database import get_db
from app.models import Company, Lead, Pipeline, SuperOwnerAuditEvent, TariffPlan, Task, User, UserRole
from app.services.background_events import list_background_events
from app.services.mail import send_email
from app.services.super_owner_audit import record_super_owner_audit

router = APIRouter(prefix="/companies", tags=["companies"])


class CompanyRead(BaseModel):
    id: int
    name: str
    contact_email: str | None = None
    is_active: bool
    users_count: int = 0
    leads_count: int = 0
    pipelines_count: int = 0
    tariff_plan_id: int | None = None
    tariff_plan_name: str | None = None
    tariff_max_active_users: int | None = None
    tariff_max_integrations: int | None = None
    billing_status: str = "active"
    trial_ends_at: datetime | None = None
    pending_tariff_plan_id: int | None = None
    pending_tariff_plan_name: str | None = None
    billing_discount_percent: float | None = None
    scheduled_tariff_plan_id: int | None = None
    scheduled_tariff_plan_name: str | None = None
    scheduled_tariff_effective_at: datetime | None = None


class CompanyCreate(BaseModel):
    name: str = Field(..., min_length=2, max_length=255)
    owner_email: str = Field(..., min_length=3, max_length=320)
    owner_full_name: str | None = Field(default=None, min_length=2, max_length=255)
    external_db_dsn: str | None = Field(default=None, max_length=2000)
    tariff_plan_id: int | None = None
    billing_discount_percent: float | None = Field(default=None, ge=0.0, le=100.0)


class UpdateCompanyStatusBody(BaseModel):
    is_active: bool


class SwitchCompanyBody(BaseModel):
    company_id: int = Field(..., ge=1)


class CompanyTariffPatchBody(BaseModel):
    """Передайте поле, чтобы изменить; `null` в JSON = сброс на глобальные лимиты (NULL в БД)."""
    tariff_max_active_users: int | None = Field(default=None, ge=0, le=50000)
    tariff_max_integrations: int | None = Field(default=None, ge=0, le=50000)


class CompanyTariffPlanPatchBody(BaseModel):
    """Назначить тарифный план компании или сбросить (`null`)."""
    tariff_plan_id: int | None = None


class CompanyBillingDiscountPatchBody(BaseModel):
    billing_discount_percent: float | None = Field(default=None, ge=0.0, le=100.0)


class CompanyScheduledTariffPatchBody(BaseModel):
    """Отложенная смена тарифа (например урезание — с указанной даты, обычно 1-е число месяца)."""
    scheduled_tariff_plan_id: int | None = None
    scheduled_tariff_effective_at: datetime | None = None


class SuperOwnerAuditRead(BaseModel):
    id: int
    actor_user_id: int
    company_id: int | None
    action: str
    detail: str | None
    created_at: datetime


class PlatformDashboardRead(BaseModel):
    companies_total: int
    companies_active: int
    companies_suspended: int
    users_total: int
    leads_total: int
    pipelines_total: int
    global_tariff_max_active_users: int
    global_tariff_max_integrations: int
    recent_audit_count: int
    recent_background_failures: int


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


def _company_read_from_row(
    c: Company,
    *,
    users_count: int,
    leads_count: int,
    pipelines_count: int,
    tariff_plan_name: str | None = None,
    pending_tariff_plan_name: str | None = None,
    scheduled_tariff_plan_name: str | None = None,
) -> CompanyRead:
    bd = getattr(c, "billing_discount_percent", None)
    bd_f = float(bd) if bd is not None else None
    return CompanyRead(
        id=c.id,
        name=c.name,
        contact_email=c.contact_email,
        is_active=c.is_active,
        users_count=users_count,
        leads_count=leads_count,
        pipelines_count=pipelines_count,
        tariff_plan_id=c.tariff_plan_id,
        tariff_plan_name=tariff_plan_name,
        tariff_max_active_users=c.tariff_max_active_users,
        tariff_max_integrations=c.tariff_max_integrations,
        billing_status=str(getattr(c, "billing_status", None) or "active"),
        trial_ends_at=getattr(c, "trial_ends_at", None),
        pending_tariff_plan_id=getattr(c, "pending_tariff_plan_id", None),
        pending_tariff_plan_name=pending_tariff_plan_name,
        billing_discount_percent=bd_f,
        scheduled_tariff_plan_id=getattr(c, "scheduled_tariff_plan_id", None),
        scheduled_tariff_plan_name=scheduled_tariff_plan_name,
        scheduled_tariff_effective_at=getattr(c, "scheduled_tariff_effective_at", None),
    )


async def _tariff_plan_label(db: AsyncSession, plan_id: int | None) -> str | None:
    if plan_id is None:
        return None
    pln = await db.get(TariffPlan, plan_id)
    return pln.name if pln else None


async def _pending_tariff_plan_label(db: AsyncSession, pending_id: int | None) -> str | None:
    if pending_id is None:
        return None
    pln = await db.get(TariffPlan, pending_id)
    return pln.name if pln else None


async def _scheduled_tariff_plan_label(db: AsyncSession, scheduled_id: int | None) -> str | None:
    if scheduled_id is None:
        return None
    pln = await db.get(TariffPlan, scheduled_id)
    return pln.name if pln else None


@router.get("/dashboard", response_model=PlatformDashboardRead)
async def platform_dashboard(
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentUser,
) -> PlatformDashboardRead:
    _ensure_super_owner(current_user)
    companies_total = int(await db.scalar(select(func.count(Company.id))) or 0)
    companies_active = int(await db.scalar(select(func.count(Company.id)).where(Company.is_active.is_(True))) or 0)
    companies_suspended = max(companies_total - companies_active, 0)
    users_total = int(
        await db.scalar(
            select(func.count(User.id)).where(User.company_id.isnot(None), User.is_active.is_(True)),
        )
        or 0
    )
    leads_total = int(await db.scalar(select(func.count(Lead.id))) or 0)
    pipelines_total = int(await db.scalar(select(func.count(Pipeline.id))) or 0)
    since = datetime.now(UTC) - timedelta(days=7)
    recent_audit_count = int(
        await db.scalar(select(func.count(SuperOwnerAuditEvent.id)).where(SuperOwnerAuditEvent.created_at >= since)) or 0
    )
    bg = list_background_events(80)
    recent_background_failures = sum(1 for e in bg if not e.get("ok"))
    return PlatformDashboardRead(
        companies_total=companies_total,
        companies_active=companies_active,
        companies_suspended=companies_suspended,
        users_total=users_total,
        leads_total=leads_total,
        pipelines_total=pipelines_total,
        global_tariff_max_active_users=int(settings.tariff_max_active_users),
        global_tariff_max_integrations=int(settings.tariff_max_integrations),
        recent_audit_count=recent_audit_count,
        recent_background_failures=recent_background_failures,
    )


@router.get("/audit-log", response_model=list[SuperOwnerAuditRead])
async def list_super_owner_audit(
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentUser,
    limit: int = Query(80, ge=1, le=200),
    company_id: int | None = Query(default=None, ge=1),
) -> list[SuperOwnerAuditRead]:
    _ensure_super_owner(current_user)
    q = select(SuperOwnerAuditEvent).order_by(SuperOwnerAuditEvent.created_at.desc()).limit(limit)
    if company_id is not None:
        q = q.where(SuperOwnerAuditEvent.company_id == company_id)
    rows = (await db.execute(q)).scalars().all()
    return [
        SuperOwnerAuditRead(
            id=r.id,
            actor_user_id=r.actor_user_id,
            company_id=r.company_id,
            action=r.action,
            detail=r.detail,
            created_at=r.created_at,
        )
        for r in rows
    ]


@router.get("/incidents-export")
async def export_incidents_csv(
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentUser,
    hours: int = Query(168, ge=1, le=24 * 90),
) -> StreamingResponse:
    _ensure_super_owner(current_user)
    since = datetime.now(UTC) - timedelta(hours=hours)
    rows = (
        await db.execute(
            select(SuperOwnerAuditEvent)
            .where(SuperOwnerAuditEvent.created_at >= since)
            .order_by(SuperOwnerAuditEvent.created_at.desc())
            .limit(2000)
        )
    ).scalars().all()
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(["ts", "type", "actor_user_id", "company_id", "action", "message", "detail"])
    for r in rows:
        w.writerow(
            [
                r.created_at.isoformat(),
                "super_owner_audit",
                r.actor_user_id,
                r.company_id or "",
                r.action,
                "",
                (r.detail or "").replace("\n", " ")[:2000],
            ]
        )
    for ev in list_background_events(200):
        ts = ev.get("ts") or ""
        try:
            tsd = datetime.fromisoformat(str(ts).replace("Z", "+00:00"))
        except Exception:
            tsd = None
        if tsd is not None and tsd < since:
            continue
        w.writerow(
            [
                str(ts),
                "background_event",
                "",
                "",
                str(ev.get("source") or ""),
                str(ev.get("message") or ""),
                str(ev.get("detail") or "")[:2000],
            ]
        )
    buf.seek(0)
    filename = f"metodione_incidents_{datetime.now(UTC).strftime('%Y%m%d_%H%M')}.csv"
    return StreamingResponse(
        iter([buf.getvalue()]),
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.get("", response_model=list[CompanyRead])
async def list_companies(
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentUser,
) -> list[CompanyRead]:
    _ensure_super_owner(current_user)
    rows = (await db.execute(select(Company).order_by(Company.id.asc()))).scalars().all()
    plan_ids = {c.tariff_plan_id for c in rows if c.tariff_plan_id} | {
        c.pending_tariff_plan_id for c in rows if getattr(c, "pending_tariff_plan_id", None)
    } | {getattr(c, "scheduled_tariff_plan_id", None) for c in rows if getattr(c, "scheduled_tariff_plan_id", None)}
    plan_by_id: dict[int, str] = {}
    if plan_ids:
        pr = await db.execute(select(TariffPlan).where(TariffPlan.id.in_(plan_ids)))
        for pl in pr.scalars().all():
            plan_by_id[pl.id] = pl.name
    out: list[CompanyRead] = []
    for c in rows:
        users_count = int(
            await db.scalar(select(func.count(User.id)).where(User.company_id == c.id, User.is_active.is_(True))) or 0
        )
        leads_count = int(await db.scalar(select(func.count(Lead.id)).where(Lead.company_id == c.id)) or 0)
        pipelines_count = int(await db.scalar(select(func.count(Pipeline.id)).where(Pipeline.company_id == c.id)) or 0)
        pn = plan_by_id.get(int(c.tariff_plan_id)) if c.tariff_plan_id else None
        ppend = plan_by_id.get(int(c.pending_tariff_plan_id)) if getattr(c, "pending_tariff_plan_id", None) else None
        psch = plan_by_id.get(int(c.scheduled_tariff_plan_id)) if getattr(c, "scheduled_tariff_plan_id", None) else None
        out.append(
            _company_read_from_row(
                c,
                users_count=users_count,
                leads_count=leads_count,
                pipelines_count=pipelines_count,
                tariff_plan_name=pn,
                pending_tariff_plan_name=ppend,
                scheduled_tariff_plan_name=psch,
            ),
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
    if body.tariff_plan_id is not None:
        pl = await db.get(TariffPlan, body.tariff_plan_id)
        if pl is None or not pl.is_active:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Тариф не найден или отключён",
            )
        c.tariff_plan_id = pl.id
    if body.billing_discount_percent is not None:
        c.billing_discount_percent = Decimal(str(body.billing_discount_percent))
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
        must_change_password=False,
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
    await record_super_owner_audit(
        db,
        actor_user_id=current_user.id,
        action="company_create",
        company_id=c.id,
        detail={"name": c.name, "owner_email": owner_email},
    )
    users_count = int(await db.scalar(select(func.count(User.id)).where(User.company_id == c.id, User.is_active.is_(True))) or 0)
    leads_count = int(await db.scalar(select(func.count(Lead.id)).where(Lead.company_id == c.id)) or 0)
    pipelines_count = int(await db.scalar(select(func.count(Pipeline.id)).where(Pipeline.company_id == c.id)) or 0)
    plan_name = await _tariff_plan_label(db, c.tariff_plan_id)
    pend_name = await _pending_tariff_plan_label(db, getattr(c, "pending_tariff_plan_id", None))
    sch_name = await _scheduled_tariff_plan_label(db, getattr(c, "scheduled_tariff_plan_id", None))
    return _company_read_from_row(
        c,
        users_count=users_count,
        leads_count=leads_count,
        pipelines_count=pipelines_count,
        tariff_plan_name=plan_name,
        pending_tariff_plan_name=pend_name,
        scheduled_tariff_plan_name=sch_name,
    )


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
    users_count = int(await db.scalar(select(func.count(User.id)).where(User.company_id == c.id, User.is_active.is_(True))) or 0)
    leads_count = int(await db.scalar(select(func.count(Lead.id)).where(Lead.company_id == c.id)) or 0)
    pipelines_count = int(await db.scalar(select(func.count(Pipeline.id)).where(Pipeline.company_id == c.id)) or 0)
    plan_name = await _tariff_plan_label(db, c.tariff_plan_id)
    pend_name = await _pending_tariff_plan_label(db, getattr(c, "pending_tariff_plan_id", None))
    sch_name = await _scheduled_tariff_plan_label(db, getattr(c, "scheduled_tariff_plan_id", None))
    return _company_read_from_row(
        c,
        users_count=users_count,
        leads_count=leads_count,
        pipelines_count=pipelines_count,
        tariff_plan_name=plan_name,
        pending_tariff_plan_name=pend_name,
        scheduled_tariff_plan_name=sch_name,
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
    await record_super_owner_audit(
        db,
        actor_user_id=current_user.id,
        action="company_status",
        company_id=c.id,
        detail={"is_active": body.is_active},
    )
    users_count = int(await db.scalar(select(func.count(User.id)).where(User.company_id == c.id, User.is_active.is_(True))) or 0)
    leads_count = int(await db.scalar(select(func.count(Lead.id)).where(Lead.company_id == c.id)) or 0)
    pipelines_count = int(await db.scalar(select(func.count(Pipeline.id)).where(Pipeline.company_id == c.id)) or 0)
    plan_name = await _tariff_plan_label(db, c.tariff_plan_id)
    pend_name = await _pending_tariff_plan_label(db, getattr(c, "pending_tariff_plan_id", None))
    sch_name = await _scheduled_tariff_plan_label(db, getattr(c, "scheduled_tariff_plan_id", None))
    return _company_read_from_row(
        c,
        users_count=users_count,
        leads_count=leads_count,
        pipelines_count=pipelines_count,
        tariff_plan_name=plan_name,
        pending_tariff_plan_name=pend_name,
        scheduled_tariff_plan_name=sch_name,
    )


@router.patch("/{company_id}/tariff", response_model=CompanyRead)
async def patch_company_tariff(
    company_id: int,
    body: CompanyTariffPatchBody,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentUser,
) -> CompanyRead:
    _ensure_super_owner(current_user)
    c = await db.get(Company, company_id)
    if c is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Компания не найдена")
    data = body.model_dump(exclude_unset=True)
    if "tariff_max_active_users" in data:
        c.tariff_max_active_users = body.tariff_max_active_users
    if "tariff_max_integrations" in data:
        c.tariff_max_integrations = body.tariff_max_integrations
    await db.flush()
    await record_super_owner_audit(
        db,
        actor_user_id=current_user.id,
        action="company_tariff_patch",
        company_id=c.id,
        detail={
            "tariff_max_active_users": c.tariff_max_active_users,
            "tariff_max_integrations": c.tariff_max_integrations,
        },
    )
    users_count = int(await db.scalar(select(func.count(User.id)).where(User.company_id == c.id, User.is_active.is_(True))) or 0)
    leads_count = int(await db.scalar(select(func.count(Lead.id)).where(Lead.company_id == c.id)) or 0)
    pipelines_count = int(await db.scalar(select(func.count(Pipeline.id)).where(Pipeline.company_id == c.id)) or 0)
    plan_name = await _tariff_plan_label(db, c.tariff_plan_id)
    pend_name = await _pending_tariff_plan_label(db, getattr(c, "pending_tariff_plan_id", None))
    sch_name = await _scheduled_tariff_plan_label(db, getattr(c, "scheduled_tariff_plan_id", None))
    return _company_read_from_row(
        c,
        users_count=users_count,
        leads_count=leads_count,
        pipelines_count=pipelines_count,
        tariff_plan_name=plan_name,
        pending_tariff_plan_name=pend_name,
        scheduled_tariff_plan_name=sch_name,
    )


@router.patch("/{company_id}/tariff-plan", response_model=CompanyRead)
async def patch_company_tariff_plan(
    company_id: int,
    body: CompanyTariffPlanPatchBody,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentUser,
) -> CompanyRead:
    _ensure_super_owner(current_user)
    c = await db.get(Company, company_id)
    if c is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Компания не найдена")
    tid = body.tariff_plan_id
    if tid is not None:
        pl = await db.get(TariffPlan, tid)
        if pl is None or not pl.is_active:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Тариф не найден или отключён")
    c.tariff_plan_id = tid
    c.pending_tariff_plan_id = None
    c.scheduled_tariff_plan_id = None
    c.scheduled_tariff_effective_at = None
    if tid is not None:
        c.billing_status = "subscribed"
    else:
        c.billing_status = "active"
    await db.flush()
    await record_super_owner_audit(
        db,
        actor_user_id=current_user.id,
        action="company_tariff_plan",
        company_id=c.id,
        detail={"tariff_plan_id": tid},
    )
    users_count = int(await db.scalar(select(func.count(User.id)).where(User.company_id == c.id, User.is_active.is_(True))) or 0)
    leads_count = int(await db.scalar(select(func.count(Lead.id)).where(Lead.company_id == c.id)) or 0)
    pipelines_count = int(await db.scalar(select(func.count(Pipeline.id)).where(Pipeline.company_id == c.id)) or 0)
    plan_name = await _tariff_plan_label(db, c.tariff_plan_id)
    pend_name = await _pending_tariff_plan_label(db, getattr(c, "pending_tariff_plan_id", None))
    sch_name = await _scheduled_tariff_plan_label(db, getattr(c, "scheduled_tariff_plan_id", None))
    return _company_read_from_row(
        c,
        users_count=users_count,
        leads_count=leads_count,
        pipelines_count=pipelines_count,
        tariff_plan_name=plan_name,
        pending_tariff_plan_name=pend_name,
        scheduled_tariff_plan_name=sch_name,
    )


@router.patch("/{company_id}/billing-discount", response_model=CompanyRead)
async def patch_company_billing_discount(
    company_id: int,
    body: CompanyBillingDiscountPatchBody,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentUser,
) -> CompanyRead:
    _ensure_super_owner(current_user)
    c = await db.get(Company, company_id)
    if c is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Компания не найдена")
    c.billing_discount_percent = None if body.billing_discount_percent is None else Decimal(str(body.billing_discount_percent))
    await db.flush()
    await record_super_owner_audit(
        db,
        actor_user_id=current_user.id,
        action="company_billing_discount",
        company_id=c.id,
        detail={"billing_discount_percent": body.billing_discount_percent},
    )
    users_count = int(await db.scalar(select(func.count(User.id)).where(User.company_id == c.id, User.is_active.is_(True))) or 0)
    leads_count = int(await db.scalar(select(func.count(Lead.id)).where(Lead.company_id == c.id)) or 0)
    pipelines_count = int(await db.scalar(select(func.count(Pipeline.id)).where(Pipeline.company_id == c.id)) or 0)
    plan_name = await _tariff_plan_label(db, c.tariff_plan_id)
    pend_name = await _pending_tariff_plan_label(db, getattr(c, "pending_tariff_plan_id", None))
    sch_name = await _scheduled_tariff_plan_label(db, getattr(c, "scheduled_tariff_plan_id", None))
    return _company_read_from_row(
        c,
        users_count=users_count,
        leads_count=leads_count,
        pipelines_count=pipelines_count,
        tariff_plan_name=plan_name,
        pending_tariff_plan_name=pend_name,
        scheduled_tariff_plan_name=sch_name,
    )


@router.patch("/{company_id}/scheduled-tariff", response_model=CompanyRead)
async def patch_company_scheduled_tariff(
    company_id: int,
    body: CompanyScheduledTariffPatchBody,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentUser,
) -> CompanyRead:
    _ensure_super_owner(current_user)
    c = await db.get(Company, company_id)
    if c is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Компания не найдена")
    if body.scheduled_tariff_plan_id is not None:
        pl = await db.get(TariffPlan, body.scheduled_tariff_plan_id)
        if pl is None or not pl.is_active:
            raise HTTPException(status_code=400, detail="Отложенный тариф не найден или отключён")
        if body.scheduled_tariff_effective_at is None:
            raise HTTPException(status_code=400, detail="Укажите дату/время вступления отложенного тарифа")
        c.scheduled_tariff_plan_id = pl.id
        c.scheduled_tariff_effective_at = body.scheduled_tariff_effective_at
    else:
        c.scheduled_tariff_plan_id = None
        c.scheduled_tariff_effective_at = None
    await db.flush()
    await record_super_owner_audit(
        db,
        actor_user_id=current_user.id,
        action="company_scheduled_tariff",
        company_id=c.id,
        detail={
            "scheduled_tariff_plan_id": c.scheduled_tariff_plan_id,
            "scheduled_tariff_effective_at": c.scheduled_tariff_effective_at.isoformat() if c.scheduled_tariff_effective_at else None,
        },
    )
    users_count = int(await db.scalar(select(func.count(User.id)).where(User.company_id == c.id, User.is_active.is_(True))) or 0)
    leads_count = int(await db.scalar(select(func.count(Lead.id)).where(Lead.company_id == c.id)) or 0)
    pipelines_count = int(await db.scalar(select(func.count(Pipeline.id)).where(Pipeline.company_id == c.id)) or 0)
    plan_name = await _tariff_plan_label(db, c.tariff_plan_id)
    pend_name = await _pending_tariff_plan_label(db, getattr(c, "pending_tariff_plan_id", None))
    sch_name = await _scheduled_tariff_plan_label(db, getattr(c, "scheduled_tariff_plan_id", None))
    return _company_read_from_row(
        c,
        users_count=users_count,
        leads_count=leads_count,
        pipelines_count=pipelines_count,
        tariff_plan_name=plan_name,
        pending_tariff_plan_name=pend_name,
        scheduled_tariff_plan_name=sch_name,
    )


@router.post("/switch")
async def switch_company(
    body: SwitchCompanyBody,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentUser,
) -> dict[str, str | bool]:
    _ensure_super_owner(current_user)
    c = await db.get(Company, body.company_id)
    if c is None or not c.is_active:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Компания не найдена")
    extra = jwt_claims_for_user(current_user, company_id=body.company_id)
    token = create_access_token(str(current_user.id), extra=extra)
    await record_super_owner_audit(
        db,
        actor_user_id=current_user.id,
        action="company_switch_context",
        company_id=body.company_id,
        detail=None,
    )
    return {"access_token": token, "token_type": "bearer", "must_change_password": bool(current_user.must_change_password)}


@router.post("/{company_id}/impersonate-owner")
async def impersonate_company_owner(
    company_id: int,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentUser,
) -> dict[str, str | bool]:
    """JWT от имени владельца компании (поддержка). В токене будет impersonated_by = id super_owner."""
    _ensure_super_owner(current_user)
    c = await db.get(Company, company_id)
    if c is None or not c.is_active:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Компания не найдена или остановлена")
    row = (
        await db.execute(
            select(User)
            .where(User.company_id == company_id, User.role == UserRole.owner, User.is_active.is_(True))
            .order_by(User.id.asc())
            .limit(1)
        )
    ).scalars().first()
    if row is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Активный владелец компании не найден")
    extra = jwt_claims_for_user(row, company_id=company_id, impersonated_by=current_user.id)
    token = create_access_token(str(row.id), extra=extra)
    await record_super_owner_audit(
        db,
        actor_user_id=current_user.id,
        action="impersonate_owner",
        company_id=company_id,
        detail={"target_user_id": row.id, "target_email": row.email},
    )
    return {"access_token": token, "token_type": "bearer", "must_change_password": bool(row.must_change_password)}


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
