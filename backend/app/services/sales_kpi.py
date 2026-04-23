from __future__ import annotations

from datetime import date, datetime
from decimal import Decimal

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import SalesKpiServicePrice


def month_start_from_datetime(dt: datetime) -> date:
    return date(dt.year, dt.month, 1)


async def get_kpi_service_price(
    db: AsyncSession,
    *,
    company_id: int,
    pipeline_id: int,
    direction_id: int,
    at_datetime: datetime,
) -> Decimal | None:
    ym = month_start_from_datetime(at_datetime)
    row = (
        await db.execute(
            select(SalesKpiServicePrice.unit_price).where(
                SalesKpiServicePrice.company_id == company_id,
                SalesKpiServicePrice.pipeline_id == pipeline_id,
                SalesKpiServicePrice.direction_id == direction_id,
                SalesKpiServicePrice.year_month == ym,
            ),
        )
    ).scalar_one_or_none()
    if row is None:
        return None
    return Decimal(str(row))
