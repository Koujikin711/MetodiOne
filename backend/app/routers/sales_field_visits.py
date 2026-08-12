"""Трекер полевых визитов менеджеров (пространство crm_mode=sales)."""

from __future__ import annotations

from datetime import UTC, datetime
from decimal import Decimal
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import CurrentCompanyId, CurrentUser
from app.database import get_db
from app.models import Lead, SalesFieldVisit, UserRole
from app.schemas.sales_field_visits import (
    SalesClientSuggestItem,
    SalesFieldVisitCreate,
    SalesFieldVisitOut,
)
from app.services.crm_space import company_is_sales_mode

router = APIRouter(prefix="/sales-visits", tags=["sales-visits"])


def _assert_access(user: CurrentUser) -> None:
    if user.role not in (UserRole.owner, UserRole.super_owner, UserRole.manager, UserRole.admin):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Нет доступа к трекеру")


async def _require_sales(db: AsyncSession, company_id: int) -> None:
    if not await company_is_sales_mode(db, company_id):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Трекер доступен только во втором пространстве (продажи)",
        )


def _norm_phone(raw: str) -> str:
    return "".join(ch for ch in (raw or "") if ch.isdigit())


def _visit_out(row: SalesFieldVisit) -> SalesFieldVisitOut:
    return SalesFieldVisitOut(
        id=int(row.id),
        company_id=int(row.company_id),
        manager_user_id=int(row.manager_user_id),
        manager_name=row.manager_name,
        lead_id=int(row.lead_id) if row.lead_id is not None else None,
        client_name=row.client_name,
        client_phone=row.client_phone or "",
        enterprise_type=row.enterprise_type or "",
        lat=Decimal(str(row.lat)),
        lon=Decimal(str(row.lon)),
        accuracy_m=Decimal(str(row.accuracy_m)) if row.accuracy_m is not None else None,
        address=row.address,
        note=row.note,
        visited_at=row.visited_at,
        created_at=row.created_at,
    )


@router.get("/client-suggest", response_model=list[SalesClientSuggestItem])
async def client_suggest(
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentUser,
    company_id: CurrentCompanyId,
    q: str = Query(..., min_length=2, max_length=120),
    limit: int = Query(12, ge=1, le=30),
) -> list[SalesClientSuggestItem]:
    _assert_access(current_user)
    await _require_sales(db, company_id)
    term = q.strip()
    like = f"%{term}%"
    phone_digits = _norm_phone(term)
    filters = [Lead.name.ilike(like), Lead.phone.ilike(like)]
    if len(phone_digits) >= 4:
        filters.append(Lead.phone.ilike(f"%{phone_digits[-9:]}%"))
    rows = (
        await db.execute(
            select(Lead)
            .where(Lead.company_id == company_id, or_(*filters))
            .order_by(Lead.id.desc())
            .limit(limit),
        )
    ).scalars().all()
    out: list[SalesClientSuggestItem] = []
    seen: set[str] = set()
    for lead in rows:
        key = f"{(lead.phone or '').strip()}|{(lead.name or '').strip().lower()}"
        if key in seen:
            continue
        seen.add(key)
        # вид предприятия пока из note/extra нет — оставляем пустым, менеджер дополнит
        out.append(
            SalesClientSuggestItem(
                lead_id=int(lead.id),
                client_name=lead.name,
                client_phone=lead.phone or "",
                enterprise_type=None,
                source="crm",
            ),
        )
    return out


@router.get("", response_model=list[SalesFieldVisitOut])
async def list_visits(
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentUser,
    company_id: CurrentCompanyId,
    limit: int = Query(100, ge=1, le=300),
) -> list[SalesFieldVisitOut]:
    _assert_access(current_user)
    await _require_sales(db, company_id)
    q = select(SalesFieldVisit).where(SalesFieldVisit.company_id == company_id)
    if current_user.role == UserRole.manager:
        q = q.where(SalesFieldVisit.manager_user_id == current_user.id)
    q = q.order_by(SalesFieldVisit.visited_at.desc(), SalesFieldVisit.id.desc()).limit(limit)
    rows = (await db.execute(q)).scalars().all()
    return [_visit_out(r) for r in rows]


@router.post("", response_model=SalesFieldVisitOut, status_code=status.HTTP_201_CREATED)
async def create_visit(
    body: SalesFieldVisitCreate,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentUser,
    company_id: CurrentCompanyId,
) -> SalesFieldVisitOut:
    _assert_access(current_user)
    await _require_sales(db, company_id)

    lead_id = body.lead_id
    if lead_id is not None:
        lead = await db.get(Lead, lead_id)
        if lead is None or lead.company_id != company_id:
            raise HTTPException(status_code=400, detail="Клиент не найден в базе этого пространства")

    now = datetime.now(UTC)
    phone = _norm_phone(body.client_phone) or body.client_phone.strip()
    row = SalesFieldVisit(
        company_id=company_id,
        manager_user_id=int(current_user.id),
        manager_name=body.manager_name.strip(),
        lead_id=lead_id,
        client_name=body.client_name.strip(),
        client_phone=phone,
        enterprise_type=body.enterprise_type.strip(),
        lat=Decimal(str(body.lat)),
        lon=Decimal(str(body.lon)),
        accuracy_m=Decimal(str(body.accuracy_m)) if body.accuracy_m is not None else None,
        address=(body.address or "").strip() or None,
        note=(body.note or "").strip() or None,
        visited_at=body.visited_at or now,
        created_at=now,
    )
    db.add(row)
    await db.flush()
    await db.refresh(row)
    return _visit_out(row)
