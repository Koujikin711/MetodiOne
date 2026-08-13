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
from app.models import Lead, ManagerDeskSale, PipelineStage, SalesFieldVisit, UserRole
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


def _phone_matches(stored: str | None, needle_digits: str) -> bool:
    if not needle_digits or len(needle_digits) < 4:
        return False
    digits = _norm_phone(stored or "")
    if not digits:
        return False
    return needle_digits in digits or digits.endswith(needle_digits[-9:])


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
    """Подсказки клиентов из CRM, продаж стола и прошлых визитов."""
    _assert_access(current_user)
    await _require_sales(db, company_id)
    term = q.strip()
    like = f"%{term}%"
    phone_digits = _norm_phone(term)
    phone_only = bool(phone_digits) and phone_digits == _norm_phone(term) and len(term) == len(phone_digits)
    out: list[SalesClientSuggestItem] = []
    seen: set[str] = set()

    def _add(
        *,
        lead_id: int | None,
        name: str,
        phone: str,
        enterprise_type: str | None,
        source: str,
        last_lat: Decimal | None = None,
        last_lon: Decimal | None = None,
        last_address: str | None = None,
    ) -> None:
        name_s = (name or "").strip()
        phone_s = (phone or "").strip()
        if not name_s and not phone_s:
            return
        key = f"{_norm_phone(phone_s)}|{(name_s or '').lower()}"
        if key in seen:
            return
        seen.add(key)
        out.append(
            SalesClientSuggestItem(
                lead_id=lead_id,
                client_name=name_s or phone_s,
                client_phone=phone_s,
                enterprise_type=(enterprise_type or "").strip() or None,
                source=source,
                last_lat=last_lat,
                last_lon=last_lon,
                last_address=(last_address or "").strip() or None,
            ),
        )

    # 1) CRM-лиды
    lead_filters = [Lead.name.ilike(like), Lead.phone.ilike(like)]
    if len(phone_digits) >= 4:
        lead_filters.append(Lead.phone.ilike(f"%{phone_digits[-9:]}%"))
        lead_filters.append(Lead.phone.ilike(f"%{phone_digits}%"))
    leads = (
        await db.execute(
            select(Lead)
            .where(Lead.company_id == company_id, or_(*lead_filters))
            .order_by(Lead.id.desc())
            .limit(max(limit * 4, 40)),
        )
    ).scalars().all()
    for lead in leads:
        if phone_only and len(phone_digits) >= 4 and not _phone_matches(lead.phone, phone_digits):
            continue
        _add(
            lead_id=int(lead.id),
            name=lead.name or "",
            phone=lead.phone or "",
            enterprise_type=None,
            source="crm",
        )
        if len(out) >= limit:
            return out

    # 2) Продажи стола (часто основной источник во втором пространстве)
    sale_filters = [
        ManagerDeskSale.client_name.ilike(like),
        ManagerDeskSale.client_phone.ilike(like),
    ]
    if len(phone_digits) >= 4:
        sale_filters.append(ManagerDeskSale.client_phone.ilike(f"%{phone_digits[-9:]}%"))
        sale_filters.append(ManagerDeskSale.client_phone.ilike(f"%{phone_digits}%"))
    sales = (
        await db.execute(
            select(ManagerDeskSale)
            .where(
                ManagerDeskSale.company_id == company_id,
                ManagerDeskSale.status == "active",
                or_(*sale_filters),
            )
            .order_by(ManagerDeskSale.id.desc())
            .limit(max(limit * 4, 40)),
        )
    ).scalars().all()
    for sale in sales:
        if phone_only and len(phone_digits) >= 4 and not _phone_matches(sale.client_phone, phone_digits):
            if term.lower() not in (sale.client_name or "").lower():
                continue
        _add(
            lead_id=None,
            name=sale.client_name or "",
            phone=sale.client_phone or "",
            enterprise_type=sale.activity_sphere or None,
            source="sale",
        )
        if len(out) >= limit:
            return out

    # 3) Прошлые визиты
    visit_filters = [
        SalesFieldVisit.client_name.ilike(like),
        SalesFieldVisit.client_phone.ilike(like),
    ]
    if len(phone_digits) >= 4:
        visit_filters.append(SalesFieldVisit.client_phone.ilike(f"%{phone_digits[-9:]}%"))
        visit_filters.append(SalesFieldVisit.client_phone.ilike(f"%{phone_digits}%"))
    visits = (
        await db.execute(
            select(SalesFieldVisit)
            .where(SalesFieldVisit.company_id == company_id, or_(*visit_filters))
            .order_by(SalesFieldVisit.id.desc())
            .limit(max(limit * 4, 40)),
        )
    ).scalars().all()
    for visit in visits:
        if phone_only and len(phone_digits) >= 4 and not _phone_matches(visit.client_phone, phone_digits):
            if term.lower() not in (visit.client_name or "").lower():
                continue
        _add(
            lead_id=int(visit.lead_id) if visit.lead_id is not None else None,
            name=visit.client_name or "",
            phone=visit.client_phone or "",
            enterprise_type=visit.enterprise_type or None,
            source="visit",
            last_lat=Decimal(str(visit.lat)),
            last_lon=Decimal(str(visit.lon)),
            last_address=visit.address,
        )
        if len(out) >= limit:
            return out

    # Дополнить координатами последнего визита, если ещё нет
    need_geo = [item for item in out if item.last_lat is None or item.last_lon is None]
    if need_geo:
        recent_visits = (
            await db.execute(
                select(SalesFieldVisit)
                .where(SalesFieldVisit.company_id == company_id)
                .order_by(SalesFieldVisit.id.desc())
                .limit(200),
            )
        ).scalars().all()
        for item in need_geo:
            digits = _norm_phone(item.client_phone)
            if len(digits) < 4:
                continue
            for v in recent_visits:
                if _phone_matches(v.client_phone, digits):
                    item.last_lat = Decimal(str(v.lat))
                    item.last_lon = Decimal(str(v.lon))
                    item.last_address = v.address
                    break

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


async def _find_or_create_lead_for_visit(
    db: AsyncSession,
    *,
    company_id: int,
    current_user: CurrentUser,
    client_name: str,
    client_phone: str,
    enterprise_type: str,
) -> int | None:
    """Найти лид по телефону или создать нового — клиент сразу в базе с визитом/гео."""
    digits = _norm_phone(client_phone)
    if len(digits) >= 4:
        candidates = (
            await db.execute(
                select(Lead)
                .where(Lead.company_id == company_id)
                .order_by(Lead.id.desc())
                .limit(200),
            )
        ).scalars().all()
        for lead in candidates:
            if _phone_matches(lead.phone, digits):
                return int(lead.id)

    stage_id = (
        await db.execute(
            select(PipelineStage.id)
            .where(PipelineStage.company_id == company_id)
            .order_by(PipelineStage.order.asc(), PipelineStage.id.asc())
            .limit(1),
        )
    ).scalar_one_or_none()
    if stage_id is None:
        return None

    lead = Lead(
        company_id=company_id,
        name=client_name.strip() or client_phone.strip() or "Клиент",
        phone=digits or client_phone.strip() or None,
        email=None,
        source=f"Трекер · {enterprise_type}"[:120] if enterprise_type else "Трекер",
        status_id=int(stage_id),
        manager_id=int(current_user.id) if current_user.role == UserRole.manager else int(current_user.id),
    )
    db.add(lead)
    await db.flush()
    return int(lead.id)


@router.post("", response_model=SalesFieldVisitOut, status_code=status.HTTP_201_CREATED)
async def create_visit(
    body: SalesFieldVisitCreate,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentUser,
    company_id: CurrentCompanyId,
) -> SalesFieldVisitOut:
    _assert_access(current_user)
    await _require_sales(db, company_id)

    now = datetime.now(UTC)
    phone = _norm_phone(body.client_phone) or body.client_phone.strip()
    name = body.client_name.strip()
    enterprise = body.enterprise_type.strip()

    lead_id = body.lead_id
    if lead_id is not None:
        lead = await db.get(Lead, lead_id)
        if lead is None or lead.company_id != company_id:
            raise HTTPException(status_code=400, detail="Клиент не найден в базе этого пространства")
    else:
        lead_id = await _find_or_create_lead_for_visit(
            db,
            company_id=company_id,
            current_user=current_user,
            client_name=name,
            client_phone=phone,
            enterprise_type=enterprise,
        )

    row = SalesFieldVisit(
        company_id=company_id,
        manager_user_id=int(current_user.id),
        manager_name=body.manager_name.strip(),
        lead_id=lead_id,
        client_name=name,
        client_phone=phone,
        enterprise_type=enterprise,
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
