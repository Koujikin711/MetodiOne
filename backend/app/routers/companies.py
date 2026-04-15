from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import CurrentCompanyId, CurrentUser
from app.core.security import create_access_token
from app.database import get_db
from app.models import Company, Lead, Pipeline, Task, User, UserRole

router = APIRouter(prefix="/companies", tags=["companies"])


class CompanyRead(BaseModel):
    id: int
    name: str
    is_active: bool
    users_count: int = 0
    leads_count: int = 0
    pipelines_count: int = 0


class CompanyCreate(BaseModel):
    name: str = Field(..., min_length=2, max_length=255)


class SwitchCompanyBody(BaseModel):
    company_id: int = Field(..., ge=1)


def _ensure_super_owner(user: User) -> None:
    if user.role != UserRole.super_owner:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Только super_owner")


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
    c = Company(name=body.name.strip(), is_active=True)
    db.add(c)
    await db.flush()
    await db.refresh(c)
    return CompanyRead(id=c.id, name=c.name, is_active=c.is_active)


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
