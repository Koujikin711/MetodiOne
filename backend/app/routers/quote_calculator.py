"""Калькуляция модулей → сумма заказа → продажа (пространство sales)."""

from __future__ import annotations

from datetime import UTC, datetime
from decimal import Decimal
from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import CurrentCompanyId, CurrentUser
from app.database import get_db
from app.models import ManagerDeskSale, Pipeline, UserPipelineAssignment, UserRole
from app.schemas.manager_desk_sales import ManagerDeskSaleOut
from app.schemas.quote_calculator import QuoteCommitBody, QuoteComputeBody, QuoteComputeOut
from app.services.crm_space import company_is_sales_mode
from app.services.quote_calculator import catalog, compute_quote

router = APIRouter(prefix="/quote-calculator", tags=["quote-calculator"])


def _assert_access(user: CurrentUser) -> None:
    if user.role not in (UserRole.owner, UserRole.super_owner, UserRole.manager, UserRole.admin):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Нет доступа к калькулятору")


async def _require_sales(db: AsyncSession, company_id: int) -> None:
    if not await company_is_sales_mode(db, company_id):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Калькулятор доступен только во втором пространстве (продажи)",
        )


@router.get("/catalog")
async def get_catalog(
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentUser,
    company_id: CurrentCompanyId,
) -> dict[str, Any]:
    _assert_access(current_user)
    await _require_sales(db, company_id)
    return catalog()


@router.post("/compute", response_model=QuoteComputeOut)
async def post_compute(
    body: QuoteComputeBody,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentUser,
    company_id: CurrentCompanyId,
) -> QuoteComputeOut:
    _assert_access(current_user)
    await _require_sales(db, company_id)
    result = compute_quote(body.model_dump())
    return QuoteComputeOut(**result)


@router.post("/commit", response_model=ManagerDeskSaleOut, status_code=status.HTTP_201_CREATED)
async def commit_quote_to_sale(
    body: QuoteCommitBody,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentUser,
    company_id: CurrentCompanyId,
) -> ManagerDeskSaleOut:
    _assert_access(current_user)
    await _require_sales(db, company_id)

    result = compute_quote(body.model_dump())
    if not result["ok"]:
        raise HTTPException(status_code=400, detail="; ".join(result["errors"]) or "Некорректная калькуляция")

    total = Decimal(str(result["total"]))
    paid = Decimal(str(body.paid_amount))
    if paid > total and total > 0:
        raise HTTPException(status_code=400, detail="Оплата не может превышать сумму заказа")

    pipeline_id = body.pipeline_id
    if pipeline_id is not None:
        pipe = await db.get(Pipeline, pipeline_id)
        if pipe is None or pipe.company_id != company_id:
            raise HTTPException(status_code=400, detail="Неизвестная воронка")
    else:
        if current_user.role == UserRole.manager:
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

    now = datetime.now(UTC)
    note = result["summary_text"]
    row = ManagerDeskSale(
        company_id=company_id,
        pipeline_id=pipeline_id,
        manager_user_id=int(current_user.id),
        client_name=body.client_name.strip(),
        client_phone="".join(ch for ch in body.client_phone if ch.isdigit() or ch == "+")
        or body.client_phone.strip(),
        activity_sphere=(body.activity_sphere or "CRM модули").strip() or "CRM модули",
        service_amount=total,
        paid_amount=paid,
        sold_at=now,
        status="active",
        note=note,
        created_by_user_id=int(current_user.id),
        created_at=now,
        updated_at=now,
    )
    db.add(row)
    await db.flush()
    await db.refresh(row)
    return ManagerDeskSaleOut(
        id=int(row.id),
        company_id=int(row.company_id),
        pipeline_id=int(row.pipeline_id) if row.pipeline_id is not None else None,
        manager_user_id=int(row.manager_user_id),
        manager_name=current_user.full_name or current_user.email,
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
