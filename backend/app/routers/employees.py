import html
import secrets
import string
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Response, status
from pydantic import BaseModel, Field
from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.core.deps import CurrentUser
from app.core.security import hash_password
from app.database import get_db
from app.models import Pipeline, User, UserPipelineAssignment, UserRole
from app.services.mail import send_email

router = APIRouter(prefix="/employees", tags=["employees"])


class EmployeeRead(BaseModel):
    id: int
    email: str
    phone: str | None = None
    full_name: str | None = None
    role: UserRole
    pipeline_ids: list[int] = Field(default_factory=list)


class InviteEmployeeBody(BaseModel):
    email: str = Field(..., min_length=3, max_length=320)
    phone: str = Field(..., min_length=7, max_length=32)
    full_name: str = Field(..., min_length=2, max_length=255)
    role: UserRole = UserRole.manager
    pipeline_ids: list[int] = Field(default_factory=list)


class InviteEmployeeResult(BaseModel):
    employee: EmployeeRead
    invite_url: str
    temp_password_sent_to_email: bool


def _rand_password() -> str:
    alphabet = string.ascii_letters + string.digits
    return "".join(secrets.choice(alphabet) for _ in range(12))


def _norm_phone(raw: str) -> str:
    digits = "".join(ch for ch in raw if ch.isdigit())
    return digits


async def _employee_read(db: AsyncSession, u: User) -> EmployeeRead:
    rows = await db.execute(select(UserPipelineAssignment.pipeline_id).where(UserPipelineAssignment.user_id == u.id))
    pids = [r[0] for r in rows.all()]
    return EmployeeRead(
        id=u.id,
        email=u.email,
        phone=u.phone,
        full_name=u.full_name,
        role=u.role,
        pipeline_ids=pids,
    )


def _build_invite_url(invite_token: str) -> str:
    base = (settings.public_app_url or "").rstrip("/")
    if base:
        return f"{base}/login?invite={invite_token}"
    return f"/login?invite={invite_token}"


@router.get("", response_model=list[EmployeeRead])
async def list_employees(
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentUser,
) -> list[EmployeeRead]:
    if current_user.role != UserRole.admin:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Admin only")
    r = await db.execute(select(User).where(User.is_active.is_(True)).order_by(User.id.desc()))
    users = r.scalars().all()
    return [await _employee_read(db, u) for u in users]


@router.post("/invite", response_model=InviteEmployeeResult, status_code=status.HTTP_201_CREATED)
async def invite_employee(
    body: InviteEmployeeBody,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentUser,
) -> InviteEmployeeResult:
    if current_user.role != UserRole.admin:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Admin only")

    email = body.email.strip().lower()
    phone = _norm_phone(body.phone)
    if len(phone) < 7:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Bad phone")

    if (await db.scalar(select(User.id).where(User.email == email))) is not None:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Email already registered")
    if (await db.scalar(select(User.id).where(User.phone == phone))) is not None:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Phone already registered")

    # validate pipelines
    if body.pipeline_ids:
        r = await db.execute(select(Pipeline.id).where(Pipeline.id.in_(body.pipeline_ids)))
        ok = {x[0] for x in r.all()}
        if set(body.pipeline_ids) != ok:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Unknown pipeline_id in list")

    temp_password = _rand_password()
    invite_token = secrets.token_urlsafe(32)

    u = User(
        email=email,
        phone=phone,
        full_name=body.full_name.strip(),
        role=body.role,
        hashed_password=hash_password(temp_password),
        invite_token=invite_token,
        is_active=True,
    )
    db.add(u)
    await db.flush()

    await db.execute(delete(UserPipelineAssignment).where(UserPipelineAssignment.user_id == u.id))
    for pid in body.pipeline_ids:
        db.add(UserPipelineAssignment(user_id=u.id, pipeline_id=pid))

    await db.flush()
    await db.refresh(u)

    invite_url = _build_invite_url(invite_token)
    safe_email = html.escape(email)
    safe_pw = html.escape(temp_password)
    safe_url = html.escape(invite_url, quote=True)
    plain = (
        "Здравствуйте!\n\n"
        "Вас пригласили в CRM.\n"
        f"Логин: {email}\n"
        f"Пароль: {temp_password}\n"
        f"Вход: {invite_url}\n\n"
        "После входа рекомендуем сменить пароль."
    )
    html_body = f"""<!DOCTYPE html>
<html><body style="font-family:system-ui,Segoe UI,sans-serif;line-height:1.5;color:#1e293b;background:#f8fafc;padding:24px;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:520px;margin:0 auto;background:#fff;border-radius:16px;box-shadow:0 4px 24px rgba(15,23,42,.08);overflow:hidden;">
    <tr><td style="padding:28px 28px 8px;">
      <h1 style="margin:0;font-size:20px;color:#0f172a;">Приглашение в CRM</h1>
      <p style="margin:16px 0 0;font-size:15px;">Вам создан доступ. Данные для входа:</p>
    </td></tr>
    <tr><td style="padding:8px 28px;">
      <p style="margin:8px 0;"><strong>Логин:</strong> {safe_email}</p>
      <p style="margin:8px 0;"><strong>Пароль:</strong> <code style="background:#f1f5f9;padding:2px 8px;border-radius:6px;">{safe_pw}</code></p>
    </td></tr>
    <tr><td style="padding:16px 28px 28px;">
      <a href="{safe_url}" style="display:inline-block;background:linear-gradient(135deg,#6366f1,#8b5cf6);color:#fff;text-decoration:none;padding:12px 24px;border-radius:12px;font-weight:600;font-size:15px;">Войти в CRM</a>
      <p style="margin:20px 0 0;font-size:13px;color:#64748b;">Если кнопка не открывается, скопируйте ссылку:<br/><span style="word-break:break-all;color:#475569;">{safe_url}</span></p>
    </td></tr>
  </table>
</body></html>"""
    sent = send_email(
        email,
        "Приглашение в CRM",
        plain,
        html_body=html_body,
    )
    if not sent:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=(
                "Не удалось отправить письмо приглашения. "
                "Проверьте SMTP_HOST/PORT/USER/PASSWORD/FROM (должно отправляться с metoditj@gmail.com)."
            ),
        )

    return InviteEmployeeResult(
        employee=await _employee_read(db, u),
        invite_url=invite_url,
        temp_password_sent_to_email=sent,
    )


@router.delete("/{employee_id}", status_code=status.HTTP_204_NO_CONTENT)
async def terminate_employee(
    employee_id: int,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentUser,
) -> Response:
    if current_user.role != UserRole.admin:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Admin only")
    if employee_id == current_user.id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Нельзя уволить самого себя")

    target = await db.get(User, employee_id)
    if target is None or not target.is_active:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Сотрудник не найден")

    if target.role == UserRole.admin:
        admins = await db.scalar(
            select(func.count()).select_from(User).where(User.role == UserRole.admin, User.is_active.is_(True))
        )
        if admins is not None and admins <= 1:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Нельзя уволить последнего администратора",
            )

    target.is_active = False
    target.invite_token = None
    await db.execute(delete(UserPipelineAssignment).where(UserPipelineAssignment.user_id == target.id))
    await db.flush()
    return Response(status_code=status.HTTP_204_NO_CONTENT)

