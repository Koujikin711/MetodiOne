"""Окно продаж менеджера (пространство crm_mode=sales)."""

from __future__ import annotations

from datetime import UTC, datetime
from decimal import Decimal
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import CurrentCompanyId, CurrentUser
from app.database import get_db
from app.models import ManagerDeskSale, Pipeline, User, UserPipelineAssignment, UserRole
from app.schemas.manager_desk_sales import (
    ManagerDeskSaleCreate,
    ManagerDeskSaleOut,
    ManagerDeskSalePaymentPatch,
)
from app.services.crm_space import company_is_sales_mode

router = APIRouter(prefix="/desk-sales", tags=["desk-sales"])


def _assert_sales_access(user: CurrentUser) -> None:
    if user.role not in (UserRole.owner, UserRole.super_owner, UserRole.manager, UserRole.admin):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Нет доступа к продажам")


async def _require_sales_space(db: AsyncSession, company_id: int) -> None:
    if not await company_is_sales_mode(db, company_id):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Окно продаж доступно только в пространстве без онлайн-записи",
        )


def _sale_out(row: ManagerDeskSale, manager_name: str | None = None) -> ManagerDeskSaleOut:
    return ManagerDeskSaleOut(
        id=int(row.id),
        company_id=int(row.company_id),
        pipeline_id=int(row.pipeline_id) if row.pipeline_id is not None else None,
        manager_user_id=int(row.manager_user_id),
        manager_name=manager_name,
        client_name=row.client_name,
        client_phone=row.client_phone,
        activity_sphere=row.activity_sphere or "",
        service_amount=Decimal(str(row.service_amount or 0)),
        paid_amount=Decimal(str(row.paid_amount or 0)),
        sold_at=row.sold_at,
        status=row.status,
        note=row.note,
        created_by_user_id=int(row.created_by_user_id) if row.created_by_user_id is not None else None,
        created_at=row.created_at,
        updated_at=row.updated_at,
    )


@router.get("", response_model=list[ManagerDeskSaleOut])
async def list_desk_sales(
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentUser,
    company_id: CurrentCompanyId,
    pipeline_id: int | None = Query(default=None, ge=1),
    limit: int = Query(200, ge=1, le=500),
) -> list[ManagerDeskSaleOut]:
    _assert_sales_access(current_user)
    await _require_sales_space(db, company_id)
    q = select(ManagerDeskSale, User.full_name, User.email).join(
        User, User.id == ManagerDeskSale.manager_user_id, isouter=True,
    ).where(
        ManagerDeskSale.company_id == company_id,
        ManagerDeskSale.status == "active",
    )
    if pipeline_id is not None:
        q = q.where(ManagerDeskSale.pipeline_id == pipeline_id)
    if current_user.role == UserRole.manager:
        q = q.where(ManagerDeskSale.manager_user_id == current_user.id)
    q = q.order_by(ManagerDeskSale.sold_at.desc(), ManagerDeskSale.id.desc()).limit(limit)
    rows = (await db.execute(q)).all()
    out: list[ManagerDeskSaleOut] = []
    for sale, full_name, email in rows:
        name = (full_name or "").strip() or (email or None)
        out.append(_sale_out(sale, name))
    return out


@router.post("", response_model=ManagerDeskSaleOut, status_code=status.HTTP_201_CREATED)
async def create_desk_sale(
    body: ManagerDeskSaleCreate,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentUser,
    company_id: CurrentCompanyId,
) -> ManagerDeskSaleOut:
    _assert_sales_access(current_user)
    await _require_sales_space(db, company_id)

    manager_id = int(current_user.id)
    if current_user.role in (UserRole.owner, UserRole.super_owner, UserRole.admin):
        # владелец/админ тоже могут вносить от своего имени
        manager_id = int(current_user.id)

    pipeline_id = body.pipeline_id
    if pipeline_id is not None:
        pipe = await db.get(Pipeline, pipeline_id)
        if pipe is None or pipe.company_id != company_id:
            raise HTTPException(status_code=400, detail="Неизвестная воронка")
    elif current_user.role == UserRole.manager:
        assigned = (
            await db.execute(
                select(UserPipelineAssignment.pipeline_id)
                .where(
                    UserPipelineAssignment.company_id == company_id,
                    UserPipelineAssignment.user_id == current_user.id,
                )
                .order_by(UserPipelineAssignment.pipeline_id.asc())
                .limit(1),
            )
        ).scalar_one_or_none()
        pipeline_id = int(assigned) if assigned is not None else None
    if pipeline_id is None:
        first_pipe = (
            await db.execute(
                select(Pipeline.id).where(Pipeline.company_id == company_id).order_by(Pipeline.id.asc()).limit(1),
            )
        ).scalar_one_or_none()
        pipeline_id = int(first_pipe) if first_pipe is not None else None

    paid = Decimal(str(body.paid_amount))
    service = Decimal(str(body.service_amount))
    if paid > service and service > 0:
        raise HTTPException(status_code=400, detail="Оплата не может превышать стоимость")

    now = datetime.now(UTC)
    row = ManagerDeskSale(
        company_id=company_id,
        pipeline_id=pipeline_id,
        manager_user_id=manager_id,
        client_name=body.client_name.strip(),
        client_phone="".join(ch for ch in body.client_phone if ch.isdigit() or ch == "+") or body.client_phone.strip(),
        activity_sphere=body.activity_sphere.strip(),
        service_amount=service,
        paid_amount=paid,
        sold_at=body.sold_at or now,
        status="active",
        note=(body.note or "").strip() or None,
        created_by_user_id=int(current_user.id),
        created_at=now,
        updated_at=now,
    )
    db.add(row)
    await db.flush()
    await db.refresh(row)
    return _sale_out(row, current_user.full_name or current_user.email)


@router.patch("/{sale_id}", response_model=ManagerDeskSaleOut)
async def patch_desk_sale(
    sale_id: int,
    body: ManagerDeskSalePaymentPatch,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentUser,
    company_id: CurrentCompanyId,
) -> ManagerDeskSaleOut:
    _assert_sales_access(current_user)
    await _require_sales_space(db, company_id)
    row = await db.get(ManagerDeskSale, sale_id)
    if row is None or int(row.company_id) != company_id or row.status != "active":
        raise HTTPException(status_code=404, detail="Продажа не найдена")
    if current_user.role == UserRole.manager and int(row.manager_user_id) != int(current_user.id):
        raise HTTPException(status_code=403, detail="Можно менять только свои продажи")

    if body.service_amount is not None:
        row.service_amount = Decimal(str(body.service_amount))
    row.paid_amount = Decimal(str(body.paid_amount))
    if Decimal(str(row.paid_amount)) > Decimal(str(row.service_amount or 0)) and Decimal(str(row.service_amount or 0)) > 0:
        raise HTTPException(status_code=400, detail="Оплата не может превышать стоимость")
    if body.activity_sphere is not None:
        row.activity_sphere = body.activity_sphere.strip()
    if body.note is not None:
        row.note = body.note.strip() or None
    row.updated_at = datetime.now(UTC)
    await db.flush()
    await db.refresh(row)
    return _sale_out(row)


@router.post("/{sale_id}/cancel", response_model=ManagerDeskSaleOut)
async def cancel_desk_sale(
    sale_id: int,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentUser,
    company_id: CurrentCompanyId,
) -> ManagerDeskSaleOut:
    _assert_sales_access(current_user)
    await _require_sales_space(db, company_id)
    row = await db.get(ManagerDeskSale, sale_id)
    if row is None or int(row.company_id) != company_id:
        raise HTTPException(status_code=404, detail="Продажа не найдена")
    if current_user.role == UserRole.manager and int(row.manager_user_id) != int(current_user.id):
        raise HTTPException(status_code=403, detail="Можно отменять только свои продажи")
    row.status = "cancelled"
    row.updated_at = datetime.now(UTC)
    await db.flush()
    await db.refresh(row)
    return _sale_out(row)
