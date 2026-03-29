from decimal import Decimal
from typing import Annotated

from fastapi import APIRouter, Depends
from sqlalchemy import and_, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import CurrentUser
from app.database import get_db
from app.models import Deal, Lead, PipelineStage
from app.schemas.analytics import AnalyticsSummary

router = APIRouter(prefix="/analytics", tags=["analytics"])


def _success_stage_condition():
    """Этапы «успех»: оплачено или успешно реализован (по имени)."""
    nm = func.lower(func.trim(PipelineStage.name))
    return or_(
        nm == "оплачено",
        and_(
            PipelineStage.name.ilike("%успешно%"),
            PipelineStage.name.ilike("%реализован%"),
        ),
    )


@router.get("/summary", response_model=AnalyticsSummary)
async def analytics_summary(
    db: Annotated[AsyncSession, Depends(get_db)],
    _: CurrentUser,
) -> AnalyticsSummary:
    total_leads = await db.scalar(select(func.count(Lead.id)))
    total_leads = int(total_leads or 0)

    deals_sum = await db.scalar(select(func.coalesce(func.sum(Deal.amount), 0)))
    deals_sum = deals_sum if deals_sum is not None else Decimal("0")

    converted = await db.scalar(
        select(func.count(Lead.id))
        .select_from(Lead)
        .join(PipelineStage, Lead.status_id == PipelineStage.id)
        .where(_success_stage_condition()),
    )
    converted = int(converted or 0)

    conversion_percent = round(100.0 * converted / total_leads, 1) if total_leads else 0.0

    return AnalyticsSummary(
        total_leads=total_leads,
        deals_total_amount=Decimal(str(deals_sum)),
        conversion_percent=conversion_percent,
    )
