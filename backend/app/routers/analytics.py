from datetime import UTC, datetime, timedelta
from decimal import Decimal
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import case, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import CurrentCompanyId, CurrentUser
from app.database import get_db
from app.models import BookingAppointment, Lead, Pipeline, PipelineStage, User, UserRole
from app.schemas.analytics import (
    CustomerValueRead,
    DetailedAnalyticsRead,
    FullAnalyticsRead,
    ManagerDetailedAnalyticsItem,
    PipelineFullAnalyticsItem,
)

router = APIRouter(prefix="/analytics", tags=["analytics"])


def _period_bounds(period: str, date_from: str | None, date_to: str | None) -> tuple[datetime, datetime]:
    now = datetime.now(UTC)
    if period == "day":
        start = datetime(now.year, now.month, now.day, tzinfo=UTC)
        return start, start + timedelta(days=1)
    if period == "month":
        start = datetime(now.year, now.month, 1, tzinfo=UTC)
        if now.month == 12:
            end = datetime(now.year + 1, 1, 1, tzinfo=UTC)
        else:
            end = datetime(now.year, now.month + 1, 1, tzinfo=UTC)
        return start, end
    if period == "custom":
        if not date_from or not date_to:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Укажите date_from и date_to")
        try:
            d_from = datetime.strptime(date_from, "%Y-%m-%d")
            d_to = datetime.strptime(date_to, "%Y-%m-%d")
        except ValueError:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Неверный формат дат")
        start = d_from.replace(tzinfo=UTC)
        end = (d_to + timedelta(days=1)).replace(tzinfo=UTC)
        if end <= start:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Период задан неверно")
        return start, end
    raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="period: day | month | custom")


def _assert_owner(current_user: CurrentUser) -> None:
    if current_user.role != UserRole.owner:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Только владелец")


@router.get("/full", response_model=FullAnalyticsRead)
async def analytics_full(
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentUser,
    company_id: CurrentCompanyId,
    period: str = Query("day"),
    date_from: str | None = Query(default=None),
    date_to: str | None = Query(default=None),
) -> FullAnalyticsRead:
    _assert_owner(current_user)
    start, end = _period_bounds(period, date_from, date_to)

    total_leads = int(
        await db.scalar(
            select(func.count(Lead.id)).where(
                Lead.company_id == company_id,
                Lead.created_at >= start,
                Lead.created_at < end,
            ),
        )
        or 0
    )

    leads_with_manager_expr = case((Lead.manager_id.is_not(None), Lead.id), else_=None)
    rows = (
        await db.execute(
            select(
                Pipeline.id,
                Pipeline.name,
                func.count(func.distinct(Lead.id)),
                func.count(func.distinct(leads_with_manager_expr)),
                func.coalesce(func.sum(BookingAppointment.paid_amount), 0),
                func.coalesce(func.sum(BookingAppointment.service_amount - BookingAppointment.paid_amount), 0),
            )
            .select_from(Lead)
            .join(PipelineStage, PipelineStage.id == Lead.status_id, isouter=True)
            .join(Pipeline, Pipeline.id == PipelineStage.pipeline_id, isouter=True)
            .join(
                BookingAppointment,
                (BookingAppointment.lead_id == Lead.id) & (BookingAppointment.company_id == company_id),
                isouter=True,
            )
            .where(
                Lead.company_id == company_id,
                Lead.created_at >= start,
                Lead.created_at < end,
            )
            .group_by(Pipeline.id, Pipeline.name)
            .order_by(Pipeline.name.asc().nulls_last()),
        )
    ).all()

    by_pipeline: list[PipelineFullAnalyticsItem] = []
    total_received = Decimal("0")
    total_debt = Decimal("0")
    for pid, pname, leads_count, processed, received, debt in rows:
        rec = Decimal(str(received or 0))
        deb = Decimal(str(debt or 0))
        total_received += rec
        total_debt += deb
        by_pipeline.append(
            PipelineFullAnalyticsItem(
                pipeline_id=pid,
                pipeline_name=pname or "Без воронки",
                leads_count=int(leads_count or 0),
                processed_by_manager_count=int(processed or 0),
                received_amount=rec,
                debt_amount=deb,
            )
        )
    return FullAnalyticsRead(
        total_leads=total_leads,
        total_received_amount=total_received,
        total_debt_amount=total_debt,
        by_pipeline=by_pipeline,
    )


@router.get("/detailed", response_model=DetailedAnalyticsRead)
async def analytics_detailed(
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentUser,
    company_id: CurrentCompanyId,
    period: str = Query("day"),
    date_from: str | None = Query(default=None),
    date_to: str | None = Query(default=None),
) -> DetailedAnalyticsRead:
    _assert_owner(current_user)
    start, end = _period_bounds(period, date_from, date_to)

    total_leads = int(
        await db.scalar(
            select(func.count(Lead.id)).where(
                Lead.company_id == company_id,
                Lead.created_at >= start,
                Lead.created_at < end,
            ),
        )
        or 0
    )

    rows = (
        await db.execute(
            select(
                User.id,
                User.full_name,
                User.email,
                func.count(func.distinct(Lead.id)),
                func.coalesce(func.sum(BookingAppointment.service_amount), 0),
                func.coalesce(func.sum(BookingAppointment.service_amount - BookingAppointment.paid_amount), 0),
            )
            .select_from(Lead)
            .join(User, User.id == Lead.manager_id, isouter=True)
            .join(
                BookingAppointment,
                (BookingAppointment.lead_id == Lead.id) & (BookingAppointment.company_id == company_id),
                isouter=True,
            )
            .where(
                Lead.company_id == company_id,
                Lead.created_at >= start,
                Lead.created_at < end,
            )
            .group_by(User.id, User.full_name, User.email)
            .order_by(User.full_name.asc().nulls_last(), User.email.asc().nulls_last()),
        )
    ).all()

    by_manager: list[ManagerDetailedAnalyticsItem] = []
    total_sold = Decimal("0")
    total_unpaid = Decimal("0")
    for uid, full_name, email, leads_count, sold, unpaid in rows:
        sold_dec = Decimal(str(sold or 0))
        unpaid_dec = Decimal(str(unpaid or 0))
        total_sold += sold_dec
        total_unpaid += unpaid_dec
        by_manager.append(
            ManagerDetailedAnalyticsItem(
                manager_id=uid,
                manager_name=(full_name or email or "Без менеджера"),
                leads_count=int(leads_count or 0),
                sold_amount=sold_dec,
                unpaid_amount=unpaid_dec,
            )
        )
    return DetailedAnalyticsRead(
        total_leads=total_leads,
        total_sold_amount=total_sold,
        total_unpaid_amount=total_unpaid,
        by_manager=by_manager,
    )


@router.get("/customer-value/{customer_id}", response_model=CustomerValueRead)
async def analytics_customer_value(
    customer_id: int,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentUser,
    company_id: CurrentCompanyId,
) -> CustomerValueRead:
    _assert_owner(current_user)
    total = await db.scalar(
        select(func.coalesce(func.sum(BookingAppointment.service_amount), 0)).where(
            BookingAppointment.company_id == company_id,
            BookingAppointment.lead_id == customer_id,
        ),
    )
    total = total if total is not None else Decimal("0")
    return CustomerValueRead(customer_id=customer_id, value=Decimal(str(total)))
