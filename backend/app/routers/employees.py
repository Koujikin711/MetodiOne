import secrets
import string
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy import delete, select
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
    temp_password_debug: str | None = None


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
    r = await db.execute(select(User).order_by(User.id.desc()))
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
    )
    db.add(u)
    await db.flush()

    await db.execute(delete(UserPipelineAssignment).where(UserPipelineAssignment.user_id == u.id))
    for pid in body.pipeline_ids:
        db.add(UserPipelineAssignment(user_id=u.id, pipeline_id=pid))

    await db.flush()
    await db.refresh(u)

    invite_url = _build_invite_url(invite_token)
    sent = send_email(
        email,
        "Приглашение в CRM",
        f"Ваша ссылка: {invite_url}\nЛогин: {email} или {phone}\nПароль: {temp_password}\n",
    )

    return InviteEmployeeResult(
        employee=await _employee_read(db, u),
        invite_url=invite_url,
        temp_password_sent_to_email=sent,
        temp_password_debug=None if sent else temp_password,
    )

