"""Автовыдача демо-доступа с лендинга: компания, владелец, воронка, письма."""

from __future__ import annotations

import html
import secrets
import string
from datetime import UTC, datetime, timedelta
from urllib.parse import urlparse, urlunparse

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.core.security import hash_password
from app.models import Company, Pipeline, PipelineStage, PlatformSettings, User, UserPipelineAssignment, UserRole
from app.services.default_pipeline_stages import default_pipeline_stage_creates
from app.services.mail import send_email


def _rand_password() -> str:
    alphabet = string.ascii_letters + string.digits
    return "".join(secrets.choice(alphabet) for _ in range(14))


def _public_app_base() -> str:
    raw = (settings.public_app_url or "").strip()
    if not raw:
        return ""
    if not raw.startswith(("http://", "https://")):
        raw = "https://" + raw
    p = urlparse(raw)
    if p.scheme not in ("http", "https") or not p.netloc:
        return ""
    path = (p.path or "").rstrip("/")
    if path == "/":
        path = ""
    return urlunparse((p.scheme, p.netloc, path, "", "", "")).rstrip("/")


async def _demo_trial_days(db: AsyncSession) -> int:
    row = await db.get(PlatformSettings, 1)
    if row is None:
        return 14
    d = int(row.demo_trial_days or 14)
    return max(1, min(d, 365))


async def provision_demo_account(
    db: AsyncSession,
    *,
    full_name: str,
    phone: str,
    email: str,
    message: str | None,
) -> None:
    email_norm = str(email).strip().lower()
    exists_u = await db.scalar(select(User.id).where(User.email == email_norm))
    if exists_u is not None:
        raise ValueError("Этот email уже зарегистрирован. Войдите через «Вход» или используйте другой email.")

    days = await _demo_trial_days(db)
    trial_end = datetime.now(UTC) + timedelta(days=days)
    pwd = _rand_password()

    base_name = f"Демо {email_norm.split('@')[0][:40]}"
    company_name = base_name
    for n in range(20):
        taken = await db.scalar(select(Company.id).where(Company.name == company_name))
        if taken is None:
            break
        company_name = f"{base_name} ({n + 1})"

    comp = Company(
        name=company_name,
        contact_email=email_norm,
        is_active=True,
        billing_status="demo_trial",
        trial_ends_at=trial_end,
        tariff_plan_id=None,
        pending_tariff_plan_id=None,
    )
    db.add(comp)
    await db.flush()

    owner = User(
        email=email_norm,
        full_name=full_name.strip(),
        phone="".join(ch for ch in phone if ch.isdigit()) or None,
        hashed_password=hash_password(pwd),
        role=UserRole.owner,
        company_id=comp.id,
        is_active=True,
        must_change_password=False,
    )
    db.add(owner)
    await db.flush()

    pipe = Pipeline(
        name=f"Воронка #{comp.id}",
        type="sales",
        company_id=comp.id,
    )
    db.add(pipe)
    await db.flush()
    for idx, st in enumerate(default_pipeline_stage_creates()):
        db.add(
            PipelineStage(
                name=st.name,
                order=st.order if st.order is not None else idx,
                color=st.color,
                pipeline_id=pipe.id,
                company_id=comp.id,
            ),
        )
    await db.flush()
    db.add(
        UserPipelineAssignment(
            user_id=owner.id,
            pipeline_id=pipe.id,
            company_id=comp.id,
        ),
    )
    await db.flush()

    login_url = f"{_public_app_base()}/login" if _public_app_base() else "/login"
    safe_email = html.escape(email_norm)
    safe_pw = html.escape(pwd)
    safe_url = html.escape(login_url, quote=True)
    plain_user = (
        f"Здравствуйте, {full_name.strip()}!\n\n"
        f"Вам открыт бесплатный демо-доступ MetodiOne на {days} дней (до {trial_end.date().isoformat()} UTC).\n"
        f"Компания в CRM: {company_name}\n"
        f"Логин: {email_norm}\n"
        f"Пароль: {pwd}\n"
        f"Вход: {login_url}\n\n"
        "После окончания демо выберите тариф в разделе «Оплата и тариф» внутри CRM.\n"
    )
    html_user = f"""<!DOCTYPE html><html><body style="font-family:system-ui,sans-serif;background:#0f172b;color:#e2e8f0;padding:24px;">
<h1 style="color:#a5b4fc;">Демо-доступ MetodiOne</h1>
<p>Срок: <b>{days} дней</b> (до {trial_end.strftime("%d.%m.%Y")}).</p>
<p><b>Компания:</b> {html.escape(company_name)}</p>
<p><b>Логин:</b> {safe_email}<br/><b>Пароль:</b> <code style="background:#1e293b;padding:4px 8px;border-radius:6px;">{safe_pw}</code></p>
<p><a href="{safe_url}" style="display:inline-block;margin-top:12px;background:linear-gradient(135deg,#6366f1,#8b5cf6);color:#fff;padding:12px 22px;border-radius:12px;text-decoration:none;font-weight:600;">Войти в CRM</a></p>
</body></html>"""
    ok_user = send_email(email_norm, "Ваш демо-доступ MetodiOne", plain_user, html_body=html_user)
    if not ok_user:
        raise RuntimeError("Не удалось отправить письмо с доступом на указанный email. Проверьте SMTP.")

    admin = (settings.demo_request_to_email or "").strip().lower()
    if admin:
        plain_admin = (
            "Создано автодемо MetodiOne.\n\n"
            f"Компания: {company_name} (id={comp.id})\n"
            f"Владелец: {email_norm}\n"
            f"Телефон: {phone.strip()}\n"
            f"ФИО: {full_name.strip()}\n"
            f"Сообщение: {(message or '').strip() or '-'}\n"
            f"Демо до: {trial_end.isoformat()}\n"
        )
        send_email(admin, f"[MetodiOne] Автодемо: {company_name}", plain_admin)
