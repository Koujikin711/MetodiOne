import html
import secrets
import string
from typing import Annotated
from urllib.parse import urlparse, urlunparse

from fastapi import APIRouter, Depends, HTTPException, Response, status
from pydantic import BaseModel, Field
from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.services.tariff import count_company_active_users
from app.services.tariff_effective import effective_tariff_max_active_users
from app.core.deps import CurrentCompanyId, CurrentUser
from app.core.security import hash_password
from app.database import get_db
from app.models import BookingDirection, BookingSpecialist, Pipeline, User, UserPipelineAssignment, UserRole
from app.services.audit import write_audit_event
from app.services.mail import send_email

router = APIRouter(prefix="/employees", tags=["employees"])


class EmployeeRead(BaseModel):
    id: int
    email: str
    phone: str | None = None
    full_name: str | None = None
    role: UserRole
    pipeline_ids: list[int] = Field(default_factory=list)
    specialization: str | None = None
    booking_direction_id: int | None = None


class InviteEmployeeBody(BaseModel):
    email: str = Field(..., min_length=3, max_length=320)
    phone: str = Field(..., min_length=7, max_length=32)
    full_name: str = Field(..., min_length=2, max_length=255)
    role: UserRole = UserRole.manager
    pipeline_ids: list[int] = Field(default_factory=list)
    """Для эксперта: подпись в календаре под ФИО (например Невролог)."""
    specialization: str | None = Field(default=None, max_length=255)
    """Для эксперта: направление онлайн-записи (тип слота / колонка календаря)."""
    booking_direction_id: int | None = Field(default=None, ge=1)
    course_streams_enabled: bool = False
    course_stream_max_days: int = Field(15, ge=5, le=90)
    course_stream_min_day_for_next: int = Field(10, ge=1, le=60)
    course_stream_gap_days: int = Field(10, ge=1, le=60)


class InviteEmployeeResult(BaseModel):
    employee: EmployeeRead
    invite_url: str
    temp_password_sent_to_email: bool


class PatchEmployeePipelinesBody(BaseModel):
    pipeline_ids: list[int] = Field(default_factory=list)


class PatchEmployeeContactBody(BaseModel):
    email: str | None = Field(default=None, min_length=3, max_length=320)
    phone: str | None = Field(default=None, min_length=7, max_length=32)


class PatchEmployeeContactResult(BaseModel):
    employee: EmployeeRead
    email_changed: bool = False
    credentials_email_sent: bool = False


def _rand_password() -> str:
    alphabet = string.ascii_letters + string.digits
    return "".join(secrets.choice(alphabet) for _ in range(12))


def _norm_phone(raw: str) -> str:
    digits = "".join(ch for ch in raw if ch.isdigit())
    return digits


async def _employee_read(db: AsyncSession, u: User) -> EmployeeRead:
    rows = await db.execute(
        select(UserPipelineAssignment.pipeline_id).where(
            UserPipelineAssignment.user_id == u.id,
            UserPipelineAssignment.company_id == u.company_id,
        )
    )
    pids = [r[0] for r in rows.all()]
    spec_row = (
        await db.execute(select(BookingSpecialist).where(BookingSpecialist.crm_user_id == u.id).limit(1))
    ).scalars().first()
    sp_text = (spec_row.specialization or "").strip() if spec_row else ""
    return EmployeeRead(
        id=u.id,
        email=u.email,
        phone=u.phone,
        full_name=u.full_name,
        role=u.role,
        pipeline_ids=pids,
        specialization=sp_text or None,
        booking_direction_id=spec_row.direction_id if spec_row else None,
    )


async def _sync_expert_calendar_profile(
    db: AsyncSession,
    *,
    user: User,
    full_name: str,
    phone_norm: str,
    specialization: str,
    booking_direction_id: int,
    course_streams_enabled: bool = False,
    course_stream_max_days: int = 15,
    course_stream_min_day_for_next: int = 10,
    course_stream_gap_days: int = 10,
) -> None:
    d = await db.get(BookingDirection, booking_direction_id)
    if d is None or not d.is_active:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Неизвестное или неактивное направление онлайн-записи",
        )

    if d.pipeline_id is None and user.company_id is not None:
        assign_rows = (
            await db.execute(
                select(UserPipelineAssignment.pipeline_id).where(
                    UserPipelineAssignment.user_id == user.id,
                    UserPipelineAssignment.company_id == user.company_id,
                ),
            )
        ).all()
        assigned = {int(r[0]) for r in assign_rows}
        if len(assigned) == 1:
            d.pipeline_id = next(iter(assigned))

    r = await db.execute(select(BookingSpecialist).where(BookingSpecialist.crm_user_id == user.id))
    spec = r.scalars().first()
    if spec is not None:
        spec.full_name = full_name.strip()
        spec.phone = phone_norm or None
        spec.specialization = specialization.strip()
        spec.direction_id = booking_direction_id
        spec.is_active = True
        spec.course_streams_enabled = course_streams_enabled
        spec.course_stream_max_days = course_stream_max_days
        spec.course_stream_min_day_for_next = course_stream_min_day_for_next
        spec.course_stream_gap_days = course_stream_gap_days
        await db.flush()
        return

    mx = await db.scalar(select(func.coalesce(func.max(BookingSpecialist.sort_order), -1)))
    next_sort = int(mx if mx is not None else -1) + 1
    spec = BookingSpecialist(
        full_name=full_name.strip(),
        direction_id=booking_direction_id,
        phone=phone_norm or None,
        specialization=specialization.strip(),
        is_active=True,
        sort_order=next_sort,
        work_start_hour=9,
        work_end_hour=18,
        slot_duration_min=30,
        work_weekdays=[0, 1, 2, 3, 4],
        crm_user_id=user.id,
        course_streams_enabled=course_streams_enabled,
        course_stream_max_days=course_stream_max_days,
        course_stream_min_day_for_next=course_stream_min_day_for_next,
        course_stream_gap_days=course_stream_gap_days,
    )
    db.add(spec)
    await db.flush()


def _invite_app_base() -> str:
    """
    Абсолютный URL фронта (без завершающего /).
    В письмах нельзя использовать относительные ссылки — Gmail даёт битый вид http:///login.
    """
    raw = (settings.public_app_url or "").strip()
    if not raw:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=(
                "Задайте переменную окружения PUBLIC_APP_URL с полным адресом фронта, "
                "например https://ваш-проект.vercel.app (без слэша в конце). "
                "Иначе ссылка в письме приглашения будет недействительной."
            ),
        )
    if not raw.startswith(("http://", "https://")):
        raw = "https://" + raw
    p = urlparse(raw)
    if p.scheme not in ("http", "https") or not p.netloc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="PUBLIC_APP_URL указан неверно. Пример: https://metodi.vercel.app",
        )
    path = (p.path or "").rstrip("/")
    if path == "/":
        path = ""
    base = urlunparse((p.scheme, p.netloc, path, "", "", "")).rstrip("/")
    if not base:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="PUBLIC_APP_URL указан неверно (нет домена). Пример: https://metodi.vercel.app",
        )
    return base


def _build_invite_url(invite_token: str) -> str:
    return f"{_invite_app_base()}/login?invite={invite_token}"


def _credentials_email_bodies(
    *,
    email: str,
    temp_password: str,
    invite_url: str,
    intro: str,
    heading: str = "Доступ к CRM",
) -> tuple[str, str]:
    safe_email = html.escape(email)
    safe_pw = html.escape(temp_password)
    safe_url = html.escape(invite_url, quote=True)
    plain = (
        "Здравствуйте!\n\n"
        f"{intro}\n"
        f"Логин: {email}\n"
        f"Пароль: {temp_password}\n"
        f"Вход: {invite_url}\n\n"
        "Старый логин и пароль больше не действуют. После входа рекомендуем сменить пароль."
    )
    html_body = f"""<!DOCTYPE html>
<html><body style="font-family:system-ui,Segoe UI,sans-serif;line-height:1.5;color:#1e293b;background:#f8fafc;padding:24px;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:520px;margin:0 auto;background:#fff;border-radius:16px;box-shadow:0 4px 24px rgba(15,23,42,.08);overflow:hidden;">
    <tr><td style="padding:28px 28px 8px;">
      <h1 style="margin:0;font-size:20px;color:#0f172a;">{html.escape(heading)}</h1>
      <p style="margin:16px 0 0;font-size:15px;">{html.escape(intro)}</p>
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
    return plain, html_body


def _send_employee_credentials_email(
    to_email: str,
    temp_password: str,
    invite_token: str,
    *,
    intro: str,
    subject: str = "Доступ к CRM",
    heading: str = "Доступ к CRM",
) -> bool:
    invite_url = _build_invite_url(invite_token)
    plain, html_body = _credentials_email_bodies(
        email=to_email,
        temp_password=temp_password,
        invite_url=invite_url,
        intro=intro,
        heading=heading,
    )
    return send_email(to_email, subject, plain, html_body=html_body)


async def _user_with_phone_except(
    db: AsyncSession,
    phone: str,
    company_id: int,
    *,
    except_user_id: int | None,
) -> User | None:
    q = select(User).where(User.company_id == company_id, User.phone == phone)
    if except_user_id is not None:
        q = q.where(User.id != except_user_id)
    return (await db.execute(q.limit(1))).scalars().first()


@router.get("", response_model=list[EmployeeRead])
async def list_employees(
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentUser,
    company_id: CurrentCompanyId,
) -> list[EmployeeRead]:
    if current_user.role not in (UserRole.owner, UserRole.admin):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Только владелец")
    r = await db.execute(select(User).where(User.company_id == company_id, User.is_active.is_(True)).order_by(User.id.desc()))
    users = r.scalars().all()
    return [await _employee_read(db, u) for u in users]


@router.post("/invite", response_model=InviteEmployeeResult, status_code=status.HTTP_201_CREATED)
async def invite_employee(
    body: InviteEmployeeBody,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentUser,
    company_id: CurrentCompanyId,
) -> InviteEmployeeResult:
    if current_user.role != UserRole.owner:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Только владелец")

    if body.role == UserRole.admin and not body.pipeline_ids:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Для роли «Админ» укажите хотя бы одну воронку (онлайн-запись и лиды по направлению)",
        )
    if body.role == UserRole.expert:
        if not body.pipeline_ids:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Для эксперта укажите хотя бы одну воронку CRM",
            )
        spec_s = (body.specialization or "").strip()
        if len(spec_s) < 2:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Укажите специальность эксперта (под ФИО в календаре записи, например Невролог)",
            )
        if body.booking_direction_id is None:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Выберите направление онлайн-записи (колонка календаря: Консультация и т.п.)",
            )

    email = body.email.strip().lower()
    phone = _norm_phone(body.phone)
    if len(phone) < 7:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Bad phone")

    # validate pipelines
    if body.pipeline_ids:
        r = await db.execute(
            select(Pipeline.id).where(Pipeline.company_id == company_id, Pipeline.id.in_(body.pipeline_ids))
        )
        ok = {x[0] for x in r.all()}
        if set(body.pipeline_ids) != ok:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Unknown pipeline_id in list")

    _invite_app_base()

    existing_by_email = (
        await db.execute(select(User).where(User.company_id == company_id, User.email == email).limit(1))
    ).scalars().first()
    if existing_by_email is not None and existing_by_email.is_active:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Email already registered")

    rehire = existing_by_email is not None and not existing_by_email.is_active
    u = existing_by_email if rehire else None

    other_phone = await _user_with_phone_except(db, phone, company_id, except_user_id=u.id if u else None)
    if other_phone is not None:
        if other_phone.is_active:
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Phone already registered")
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=(
                "Этот телефон привязан к другому уволенному аккаунту. "
                "Пригласите с тем email, что был у того сотрудника, или укажите другой телефон."
            ),
        )

    if not rehire:
        mx = await effective_tariff_max_active_users(db, company_id)
        if mx > 0:
            n_active = await count_company_active_users(db, company_id)
            if n_active >= mx:
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail=f"Достигнут лимит активных пользователей по тарифу ({mx}).",
                )

    temp_password = _rand_password()
    invite_token = secrets.token_urlsafe(32)

    if rehire and u is not None:
        u.phone = phone
        u.full_name = body.full_name.strip()
        u.role = body.role
        u.hashed_password = hash_password(temp_password)
        u.invite_token = invite_token
        u.is_active = True
        await db.flush()
    else:
        u = User(
            company_id=company_id,
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

    await db.execute(
        delete(UserPipelineAssignment).where(
            UserPipelineAssignment.user_id == u.id,
            UserPipelineAssignment.company_id == company_id,
        )
    )
    for pid in body.pipeline_ids:
        db.add(UserPipelineAssignment(company_id=company_id, user_id=u.id, pipeline_id=pid))

    await db.flush()
    await db.refresh(u)

    if u.role == UserRole.expert:
        assert body.booking_direction_id is not None
        await _sync_expert_calendar_profile(
            db,
            user=u,
            full_name=u.full_name or body.full_name.strip(),
            phone_norm=phone,
            specialization=(body.specialization or "").strip(),
            booking_direction_id=body.booking_direction_id,
            course_streams_enabled=body.course_streams_enabled,
            course_stream_max_days=body.course_stream_max_days,
            course_stream_min_day_for_next=body.course_stream_min_day_for_next,
            course_stream_gap_days=body.course_stream_gap_days,
        )

    invite_url = _build_invite_url(invite_token)
    intro = "Вам восстановили доступ к CRM." if rehire else "Вас пригласили в CRM."
    sent = _send_employee_credentials_email(
        email,
        temp_password,
        invite_token,
        intro=intro,
        subject="Приглашение в CRM",
        heading="Приглашение в CRM",
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


async def _validate_pipeline_ids(db: AsyncSession, company_id: int, pipeline_ids: list[int]) -> list[int]:
    if not pipeline_ids:
        return []
    unique = sorted(set(int(x) for x in pipeline_ids))
    r = await db.execute(
        select(Pipeline.id).where(Pipeline.company_id == company_id, Pipeline.id.in_(unique)),
    )
    ok = {int(x[0]) for x in r.all()}
    if set(unique) != ok:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Unknown pipeline_id in list")
    return unique


def _validate_pipelines_for_role(role: UserRole, pipeline_ids: list[int]) -> None:
    if role in (UserRole.admin, UserRole.expert, UserRole.manager) and not pipeline_ids:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Укажите хотя бы одну воронку для менеджера, админа или эксперта",
        )


@router.patch("/{employee_id}", response_model=PatchEmployeeContactResult)
async def patch_employee_contact(
    employee_id: int,
    body: PatchEmployeeContactBody,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentUser,
    company_id: CurrentCompanyId,
) -> PatchEmployeeContactResult:
    """Обновить email и/или телефон. При смене email — новый пароль на новую почту, старый логин отключается."""
    if current_user.role != UserRole.owner:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Только владелец")

    if body.email is None and body.phone is None:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Укажите email или телефон")

    target = await db.get(User, employee_id)
    if target is None or target.company_id != company_id or not target.is_active:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Сотрудник не найден")

    if target.role == UserRole.owner and target.id != current_user.id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Контакты другого владельца нельзя изменить",
        )

    email_changed = False
    credentials_sent = False
    changed = False
    new_email = target.email
    new_phone = target.phone

    if body.email is not None:
        normalized = body.email.strip().lower()
        if normalized != (target.email or "").strip().lower():
            changed = True
            conflict = (
                await db.execute(select(User).where(User.email == normalized, User.id != target.id).limit(1))
            ).scalars().first()
            if conflict is not None:
                raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Email уже занят")

            _invite_app_base()
            temp_password = _rand_password()
            invite_token = secrets.token_urlsafe(32)
            target.email = normalized
            target.hashed_password = hash_password(temp_password)
            target.invite_token = invite_token
            target.must_change_password = True
            new_email = normalized
            email_changed = True

            intro = "Для вашего аккаунта в CRM изменён email. Используйте новые данные для входа."
            credentials_sent = _send_employee_credentials_email(
                normalized,
                temp_password,
                invite_token,
                intro=intro,
                subject="Новый логин для CRM",
                heading="Смена email в CRM",
            )
            if not credentials_sent:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="Не удалось отправить письмо на новый email. Проверьте SMTP.",
                )

    if body.phone is not None:
        phone = _norm_phone(body.phone)
        if len(phone) < 7:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Некорректный телефон")
        if phone != (target.phone or ""):
            changed = True
            other_phone = await _user_with_phone_except(db, phone, company_id, except_user_id=target.id)
            if other_phone is not None:
                raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Телефон уже занят")
            target.phone = phone
            new_phone = phone
            if target.role == UserRole.expert:
                spec = (
                    await db.execute(
                        select(BookingSpecialist).where(BookingSpecialist.crm_user_id == target.id).limit(1),
                    )
                ).scalars().first()
                if spec is not None:
                    spec.phone = phone

    if not changed:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Нет изменений")

    await db.flush()
    await write_audit_event(
        db,
        entity_type="employee",
        entity_id=target.id,
        action="employee_contact_updated",
        current_user=current_user,
        details=f"email_changed={email_changed}, email={new_email}, phone={new_phone}",
    )
    await db.refresh(target)
    return PatchEmployeeContactResult(
        employee=await _employee_read(db, target),
        email_changed=email_changed,
        credentials_email_sent=credentials_sent,
    )


@router.patch("/{employee_id}/pipelines", response_model=EmployeeRead)
async def patch_employee_pipelines(
    employee_id: int,
    body: PatchEmployeePipelinesBody,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentUser,
    company_id: CurrentCompanyId,
) -> EmployeeRead:
    if current_user.role != UserRole.owner:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Только владелец")

    target = await db.get(User, employee_id)
    if target is None or target.company_id != company_id or not target.is_active:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Сотрудник не найден")

    if target.role == UserRole.owner:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Воронки владельца не редактируются — у владельца доступ ко всем воронкам",
        )

    pipeline_ids = await _validate_pipeline_ids(db, company_id, body.pipeline_ids)
    _validate_pipelines_for_role(target.role, pipeline_ids)

    old_rows = (
        await db.execute(
            select(UserPipelineAssignment.pipeline_id).where(
                UserPipelineAssignment.user_id == target.id,
                UserPipelineAssignment.company_id == company_id,
            ),
        )
    ).all()
    old_ids = {int(r[0]) for r in old_rows}
    new_ids = set(pipeline_ids)

    removed = old_ids - new_ids
    if removed:
        pipes_to_clear = (
            await db.execute(
                select(Pipeline).where(
                    Pipeline.company_id == company_id,
                    Pipeline.id.in_(removed),
                    Pipeline.intake_manager_user_id == target.id,
                ),
            )
        ).scalars().all()
        for pipe in pipes_to_clear:
            pipe.intake_manager_user_id = None

    await db.execute(
        delete(UserPipelineAssignment).where(
            UserPipelineAssignment.user_id == target.id,
            UserPipelineAssignment.company_id == company_id,
        ),
    )
    for pid in pipeline_ids:
        db.add(UserPipelineAssignment(company_id=company_id, user_id=target.id, pipeline_id=pid))
    await db.flush()

    await write_audit_event(
        db,
        entity_type="employee",
        entity_id=target.id,
        action="employee_pipelines_updated",
        current_user=current_user,
        details=f"pipeline_ids={pipeline_ids}",
    )

    await db.refresh(target)
    return await _employee_read(db, target)


@router.delete("/{employee_id}", status_code=status.HTTP_204_NO_CONTENT)
async def terminate_employee(
    employee_id: int,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentUser,
    company_id: CurrentCompanyId,
) -> Response:
    if current_user.role != UserRole.owner:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Только владелец")
    if employee_id == current_user.id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Нельзя уволить самого себя")

    target = await db.get(User, employee_id)
    if target is None or target.company_id != company_id or not target.is_active:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Сотрудник не найден")

    if target.role == UserRole.owner:
        owners = await db.scalar(
            select(func.count()).select_from(User).where(User.role == UserRole.owner, User.is_active.is_(True))
            .where(User.company_id == company_id)
        )
        if owners is not None and owners <= 1:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Нельзя уволить последнего владельца",
            )

    target.is_active = False
    target.invite_token = None
    await db.execute(
        delete(UserPipelineAssignment).where(
            UserPipelineAssignment.user_id == target.id,
            UserPipelineAssignment.company_id == company_id,
        )
    )
    if target.role == UserRole.expert:
        for sp in (
            await db.execute(select(BookingSpecialist).where(BookingSpecialist.crm_user_id == target.id))
        ).scalars().all():
            sp.is_active = False
    await db.flush()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/experts")
async def list_experts(
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentUser,
    company_id: CurrentCompanyId,
) -> list[dict[str, object]]:
    if current_user.role != UserRole.owner:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Только владелец")
    rows = (
        await db.execute(
            select(User.id, User.email, User.full_name)
            .where(User.company_id == company_id, User.is_active.is_(True), User.role == UserRole.expert)
            .order_by(User.id.desc())
        )
    ).all()
    return [
        {"id": int(uid), "email": str(email), "full_name": (str(fn) if fn else None)}
        for uid, email, fn in rows
    ]

