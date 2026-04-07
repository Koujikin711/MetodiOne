from datetime import UTC, datetime, timedelta
from decimal import Decimal
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import distinct, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import CurrentUser
from app.database import get_db
from app.models import BookingAppointment, BookingSpecialist, Lead, LeadAuditEvent, Pipeline, PipelineStage, User, UserRole
from app.schemas.reports import ExpertReportsResponse, ExpertSalesItem, PipelineExpertReport

router = APIRouter(prefix="/reports", tags=["reports"])


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


@router.get("/expert", response_model=ExpertReportsResponse)
async def expert_reports(
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentUser,
    period: str = Query("day"),
    date_from: str | None = Query(default=None),
    date_to: str | None = Query(default=None),
) -> ExpertReportsResponse:
    if current_user.role not in (UserRole.owner, UserRole.expert):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Expert only")

    start, end = _period_bounds(period, date_from, date_to)

    # Owner can view all; expert only own pipelines
    pipes_q = select(Pipeline).order_by(Pipeline.id.asc())
    if current_user.role == UserRole.expert:
        pipes_q = pipes_q.where(Pipeline.expert_user_id == current_user.id)
    pipes = (await db.execute(pipes_q)).scalars().all()

    items: list[PipelineExpertReport] = []
    for pipe in pipes:
        # Leads created in pipeline during period
        leads_created = int(
            await db.scalar(
                select(func.count(Lead.id))
                .join(PipelineStage, PipelineStage.id == Lead.status_id)
                .where(
                    PipelineStage.pipeline_id == pipe.id,
                    Lead.created_at.is_not(None),
                    Lead.created_at >= start,
                    Lead.created_at < end,
                )
            )
            or 0
        )

        # Processed by managers/admins: count distinct leads whose card was opened by a manager/admin in period.
        opened = int(
            await db.scalar(
                select(func.count(distinct(LeadAuditEvent.lead_id)))
                .join(Lead, Lead.id == LeadAuditEvent.lead_id)
                .join(PipelineStage, PipelineStage.id == Lead.status_id)
                .join(User, User.id == LeadAuditEvent.user_id)
                .where(
                    PipelineStage.pipeline_id == pipe.id,
                    LeadAuditEvent.action == "card_opened",
                    LeadAuditEvent.created_at >= start,
                    LeadAuditEvent.created_at < end,
                    User.role.in_([UserRole.manager, UserRole.admin]),
                )
            )
            or 0
        )

        # Sales from online booking: use appointment pipeline snapshot (stable even after lead moves).
        rows = (
            await db.execute(
                select(
                    BookingSpecialist.id,
                    BookingSpecialist.full_name,
                    BookingSpecialist.specialization,
                    func.count(BookingAppointment.id).label("appt_cnt"),
                    func.count(distinct(BookingAppointment.patient_phone)).label("patients_cnt"),
                    func.coalesce(func.sum(BookingAppointment.paid_amount), 0).label("paid_sum"),
                )
                .join(BookingSpecialist, BookingSpecialist.id == BookingAppointment.specialist_id)
                .where(
                    BookingAppointment.pipeline_id == pipe.id,
                    BookingAppointment.status == "completed",
                    BookingAppointment.start_at >= start,
                    BookingAppointment.start_at < end,
                )
                .group_by(BookingSpecialist.id, BookingSpecialist.full_name, BookingSpecialist.specialization)
                .order_by(func.count(BookingAppointment.id).desc(), BookingSpecialist.id.asc())
            )
        ).all()

        sales: list[ExpertSalesItem] = []
        for sid, full_name, spec, appt_cnt, patients_cnt, paid_sum in rows:
            sales.append(
                ExpertSalesItem(
                    specialist_id=int(sid),
                    specialist_name=str(full_name),
                    specialization=(str(spec).strip() if spec else None),
                    appointments_completed=int(appt_cnt or 0),
                    patients_count=int(patients_cnt or 0),
                    paid_amount_sum=Decimal(str(paid_sum or 0)),
                )
            )

        items.append(
            PipelineExpertReport(
                pipeline_id=pipe.id,
                pipeline_name=pipe.name,
                leads_created=leads_created,
                leads_opened_by_managers=opened,
                sales_by_expert=sales,
            )
        )

    return ExpertReportsResponse(
        period_start=start.isoformat(),
        period_end=end.isoformat(),
        items=items,
    )

