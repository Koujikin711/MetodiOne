"""Доп. услуги: настройки %, журнал, отчёты."""

from __future__ import annotations

from datetime import UTC, date, datetime, time
from decimal import ROUND_HALF_UP, Decimal
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import and_, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import CurrentCompanyId, CurrentUser
from app.database import get_db
from app.models import ExtraServiceSale, ExtraServiceType, User, UserRole
from app.schemas.extra_services import (
    ExtraServiceReportByClient,
    ExtraServiceReportByType,
    ExtraServiceReportOut,
    ExtraServiceSaleCreate,
    ExtraServiceSaleOut,
    ExtraServiceTypeCreate,
    ExtraServiceTypeOut,
    ExtraServiceTypeUpdate,
)

router = APIRouter(prefix="/extra-services", tags=["extra-services"])

_MONEY = Decimal("0.01")
# Только главный (owner) и администратор (admin / administrator).
_ACCESS_ROLES = (
    UserRole.owner,
    UserRole.super_owner,
    UserRole.admin,
    UserRole.administrator,
)


def _assert_access(user: CurrentUser) -> None:
    if user.role not in _ACCESS_ROLES:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Нет доступа к доп. услугам")


def _assert_settings(user: CurrentUser) -> None:
    _assert_access(user)


def _money(v: Decimal | float | int | str) -> Decimal:
    return Decimal(str(v)).quantize(_MONEY, rounding=ROUND_HALF_UP)


def _validate_percents(keep: Decimal, payout: Decimal) -> None:
    keep_q = _money(keep)
    payout_q = _money(payout)
    if keep_q < 0 or payout_q < 0 or keep_q > 100 or payout_q > 100:
        raise HTTPException(status_code=400, detail="Проценты должны быть от 0 до 100")
    if abs(keep_q + payout_q - Decimal("100")) > Decimal("0.01"):
        raise HTTPException(status_code=400, detail="Сумма % нам и % отдаём должна быть 100")


def _split_amount(amount: Decimal, keep_percent: Decimal, payout_percent: Decimal) -> tuple[Decimal, Decimal]:
    amount_q = _money(amount)
    keep = _money(amount_q * _money(keep_percent) / Decimal("100"))
    payout = _money(amount_q - keep)
    # если payout_percent задан явно и отличается из‑за округления — оставляем remainder на keep
    _ = payout_percent
    return keep, payout


def _type_out(row: ExtraServiceType) -> ExtraServiceTypeOut:
    return ExtraServiceTypeOut(
        id=int(row.id),
        company_id=int(row.company_id),
        name=row.name,
        keep_percent=_money(row.keep_percent),
        payout_percent=_money(row.payout_percent),
        is_active=bool(row.is_active),
        sort_order=int(row.sort_order or 0),
        created_at=row.created_at,
        updated_at=row.updated_at,
    )


def _sale_out(
    row: ExtraServiceSale,
    service_name: str,
    created_by_name: str | None = None,
) -> ExtraServiceSaleOut:
    return ExtraServiceSaleOut(
        id=int(row.id),
        company_id=int(row.company_id),
        service_type_id=int(row.service_type_id),
        service_name=service_name,
        client_name=row.client_name,
        client_phone=row.client_phone or "",
        amount=_money(row.amount),
        keep_percent=_money(row.keep_percent),
        payout_percent=_money(row.payout_percent),
        keep_amount=_money(row.keep_amount),
        payout_amount=_money(row.payout_amount),
        sold_at=row.sold_at,
        note=row.note,
        status=row.status,
        created_by_user_id=int(row.created_by_user_id) if row.created_by_user_id is not None else None,
        created_by_name=created_by_name,
        created_at=row.created_at,
    )


def _day_start(d: date) -> datetime:
    return datetime.combine(d, time.min, tzinfo=UTC)


def _day_end(d: date) -> datetime:
    return datetime.combine(d, time.max, tzinfo=UTC)


# ─── Types (settings) ───────────────────────────────────────────────────────


@router.get("/types", response_model=list[ExtraServiceTypeOut])
async def list_types(
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentUser,
    company_id: CurrentCompanyId,
    active_only: bool = Query(False),
) -> list[ExtraServiceTypeOut]:
    _assert_access(current_user)
    q = select(ExtraServiceType).where(ExtraServiceType.company_id == company_id)
    if active_only:
        q = q.where(ExtraServiceType.is_active.is_(True))
    q = q.order_by(ExtraServiceType.sort_order.asc(), ExtraServiceType.name.asc(), ExtraServiceType.id.asc())
    rows = (await db.execute(q)).scalars().all()
    return [_type_out(r) for r in rows]


@router.post("/types", response_model=ExtraServiceTypeOut, status_code=status.HTTP_201_CREATED)
async def create_type(
    body: ExtraServiceTypeCreate,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentUser,
    company_id: CurrentCompanyId,
) -> ExtraServiceTypeOut:
    _assert_settings(current_user)
    _validate_percents(body.keep_percent, body.payout_percent)
    name = body.name.strip()
    if not name:
        raise HTTPException(status_code=400, detail="Укажите название услуги")
    now = datetime.now(UTC)
    row = ExtraServiceType(
        company_id=company_id,
        name=name,
        keep_percent=_money(body.keep_percent),
        payout_percent=_money(body.payout_percent),
        is_active=body.is_active,
        sort_order=int(body.sort_order or 0),
        created_at=now,
        updated_at=now,
    )
    db.add(row)
    await db.commit()
    await db.refresh(row)
    return _type_out(row)


@router.patch("/types/{type_id}", response_model=ExtraServiceTypeOut)
async def update_type(
    type_id: int,
    body: ExtraServiceTypeUpdate,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentUser,
    company_id: CurrentCompanyId,
) -> ExtraServiceTypeOut:
    _assert_settings(current_user)
    row = await db.get(ExtraServiceType, type_id)
    if row is None or row.company_id != company_id:
        raise HTTPException(status_code=404, detail="Услуга не найдена")
    keep = body.keep_percent if body.keep_percent is not None else row.keep_percent
    payout = body.payout_percent if body.payout_percent is not None else row.payout_percent
    _validate_percents(Decimal(str(keep)), Decimal(str(payout)))
    if body.name is not None:
        name = body.name.strip()
        if not name:
            raise HTTPException(status_code=400, detail="Укажите название услуги")
        row.name = name
    row.keep_percent = _money(keep)
    row.payout_percent = _money(payout)
    if body.is_active is not None:
        row.is_active = body.is_active
    if body.sort_order is not None:
        row.sort_order = int(body.sort_order)
    row.updated_at = datetime.now(UTC)
    await db.commit()
    await db.refresh(row)
    return _type_out(row)


@router.delete("/types/{type_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_type(
    type_id: int,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentUser,
    company_id: CurrentCompanyId,
) -> None:
    _assert_settings(current_user)
    row = await db.get(ExtraServiceType, type_id)
    if row is None or row.company_id != company_id:
        raise HTTPException(status_code=404, detail="Услуга не найдена")
    used = (
        await db.execute(
            select(func.count())
            .select_from(ExtraServiceSale)
            .where(
                ExtraServiceSale.company_id == company_id,
                ExtraServiceSale.service_type_id == type_id,
                ExtraServiceSale.status == "active",
            ),
        )
    ).scalar_one()
    if int(used or 0) > 0:
        # мягко: деактивируем, чтобы не ломать журнал
        row.is_active = False
        row.updated_at = datetime.now(UTC)
        await db.commit()
        return
    await db.delete(row)
    await db.commit()


# ─── Sales (journal) ────────────────────────────────────────────────────────


@router.get("/sales", response_model=list[ExtraServiceSaleOut])
async def list_sales(
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentUser,
    company_id: CurrentCompanyId,
    q: str | None = Query(None, max_length=200),
    service_type_id: int | None = Query(None, ge=1),
    date_from: date | None = Query(None),
    date_to: date | None = Query(None),
    limit: int = Query(300, ge=1, le=1000),
) -> list[ExtraServiceSaleOut]:
    _assert_access(current_user)
    stmt = (
        select(ExtraServiceSale, ExtraServiceType.name, User.full_name, User.email)
        .join(ExtraServiceType, ExtraServiceType.id == ExtraServiceSale.service_type_id)
        .outerjoin(User, User.id == ExtraServiceSale.created_by_user_id)
        .where(
            ExtraServiceSale.company_id == company_id,
            ExtraServiceSale.status == "active",
        )
    )
    if service_type_id is not None:
        stmt = stmt.where(ExtraServiceSale.service_type_id == service_type_id)
    if date_from is not None:
        stmt = stmt.where(ExtraServiceSale.sold_at >= _day_start(date_from))
    if date_to is not None:
        stmt = stmt.where(ExtraServiceSale.sold_at <= _day_end(date_to))
    needle = (q or "").strip()
    if needle:
        like = f"%{needle}%"
        stmt = stmt.where(
            or_(
                ExtraServiceSale.client_name.ilike(like),
                ExtraServiceSale.client_phone.ilike(like),
                ExtraServiceType.name.ilike(like),
            ),
        )
    stmt = stmt.order_by(ExtraServiceSale.sold_at.desc(), ExtraServiceSale.id.desc()).limit(limit)
    rows = (await db.execute(stmt)).all()
    out: list[ExtraServiceSaleOut] = []
    for sale, service_name, full_name, email in rows:
        by_name = (full_name or "").strip() or (email or None)
        out.append(_sale_out(sale, service_name, by_name))
    return out


@router.post("/sales", response_model=ExtraServiceSaleOut, status_code=status.HTTP_201_CREATED)
async def create_sale(
    body: ExtraServiceSaleCreate,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentUser,
    company_id: CurrentCompanyId,
) -> ExtraServiceSaleOut:
    _assert_access(current_user)
    stype = await db.get(ExtraServiceType, body.service_type_id)
    if stype is None or stype.company_id != company_id or not stype.is_active:
        raise HTTPException(status_code=400, detail="Выберите активную доп. услугу")
    name = body.client_name.strip()
    if not name:
        raise HTTPException(status_code=400, detail="Укажите ФИО клиента")
    amount = _money(body.amount)
    if amount <= 0:
        raise HTTPException(status_code=400, detail="Сумма должна быть больше 0")
    keep_pct = _money(stype.keep_percent)
    payout_pct = _money(stype.payout_percent)
    keep_amt, payout_amt = _split_amount(amount, keep_pct, payout_pct)
    sold_at = body.sold_at or datetime.now(UTC)
    if sold_at.tzinfo is None:
        sold_at = sold_at.replace(tzinfo=UTC)
    phone = "".join(ch for ch in (body.client_phone or "") if ch.isdigit() or ch == "+") or (body.client_phone or "").strip()
    row = ExtraServiceSale(
        company_id=company_id,
        service_type_id=int(stype.id),
        client_name=name,
        client_phone=phone,
        amount=amount,
        keep_percent=keep_pct,
        payout_percent=payout_pct,
        keep_amount=keep_amt,
        payout_amount=payout_amt,
        sold_at=sold_at,
        note=(body.note or "").strip() or None,
        status="active",
        created_by_user_id=int(current_user.id),
        created_at=datetime.now(UTC),
    )
    db.add(row)
    await db.commit()
    await db.refresh(row)
    by_name = (getattr(current_user, "full_name", None) or "").strip() or getattr(current_user, "email", None)
    return _sale_out(row, stype.name, by_name)


@router.delete("/sales/{sale_id}", status_code=status.HTTP_204_NO_CONTENT)
async def cancel_sale(
    sale_id: int,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentUser,
    company_id: CurrentCompanyId,
) -> None:
    _assert_access(current_user)
    row = await db.get(ExtraServiceSale, sale_id)
    if row is None or row.company_id != company_id:
        raise HTTPException(status_code=404, detail="Запись не найдена")
    row.status = "cancelled"
    await db.commit()


# ─── Report ─────────────────────────────────────────────────────────────────


@router.get("/report", response_model=ExtraServiceReportOut)
async def report(
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentUser,
    company_id: CurrentCompanyId,
    date_from: date | None = Query(None),
    date_to: date | None = Query(None),
    service_type_id: int | None = Query(None, ge=1),
) -> ExtraServiceReportOut:
    _assert_access(current_user)
    filters = [
        ExtraServiceSale.company_id == company_id,
        ExtraServiceSale.status == "active",
    ]
    if date_from is not None:
        filters.append(ExtraServiceSale.sold_at >= _day_start(date_from))
    if date_to is not None:
        filters.append(ExtraServiceSale.sold_at <= _day_end(date_to))
    if service_type_id is not None:
        filters.append(ExtraServiceSale.service_type_id == service_type_id)

    totals = (
        await db.execute(
            select(
                func.count(ExtraServiceSale.id),
                func.coalesce(func.sum(ExtraServiceSale.amount), 0),
                func.coalesce(func.sum(ExtraServiceSale.keep_amount), 0),
                func.coalesce(func.sum(ExtraServiceSale.payout_amount), 0),
            ).where(and_(*filters)),
        )
    ).one()
    count = int(totals[0] or 0)
    amount_total = _money(totals[1] or 0)
    keep_total = _money(totals[2] or 0)
    payout_total = _money(totals[3] or 0)

    by_type_rows = (
        await db.execute(
            select(
                ExtraServiceSale.service_type_id,
                ExtraServiceType.name,
                func.count(ExtraServiceSale.id),
                func.coalesce(func.sum(ExtraServiceSale.amount), 0),
                func.coalesce(func.sum(ExtraServiceSale.keep_amount), 0),
                func.coalesce(func.sum(ExtraServiceSale.payout_amount), 0),
            )
            .join(ExtraServiceType, ExtraServiceType.id == ExtraServiceSale.service_type_id)
            .where(and_(*filters))
            .group_by(ExtraServiceSale.service_type_id, ExtraServiceType.name)
            .order_by(func.sum(ExtraServiceSale.amount).desc()),
        )
    ).all()
    by_type = [
        ExtraServiceReportByType(
            service_type_id=int(r[0]),
            service_name=r[1],
            count=int(r[2] or 0),
            amount_total=_money(r[3] or 0),
            keep_total=_money(r[4] or 0),
            payout_total=_money(r[5] or 0),
        )
        for r in by_type_rows
    ]

    by_client_rows = (
        await db.execute(
            select(
                ExtraServiceSale.client_name,
                ExtraServiceSale.client_phone,
                func.count(ExtraServiceSale.id),
                func.coalesce(func.sum(ExtraServiceSale.amount), 0),
                func.coalesce(func.sum(ExtraServiceSale.keep_amount), 0),
                func.coalesce(func.sum(ExtraServiceSale.payout_amount), 0),
            )
            .where(and_(*filters))
            .group_by(ExtraServiceSale.client_name, ExtraServiceSale.client_phone)
            .order_by(func.sum(ExtraServiceSale.keep_amount).desc())
            .limit(200),
        )
    ).all()
    by_client = [
        ExtraServiceReportByClient(
            client_name=r[0],
            client_phone=r[1] or "",
            count=int(r[2] or 0),
            amount_total=_money(r[3] or 0),
            keep_total=_money(r[4] or 0),
            payout_total=_money(r[5] or 0),
        )
        for r in by_client_rows
    ]

    return ExtraServiceReportOut(
        count=count,
        amount_total=amount_total,
        keep_total=keep_total,
        payout_total=payout_total,
        by_type=by_type,
        by_client=by_client,
    )
