from datetime import UTC, datetime, timedelta
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import case, distinct, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import CurrentUser
from app.database import get_db
from app.models import BookingAppointment, BookingSpecialist, Pipeline, UserRole
from app.schemas.reports import ExpertBookingItem, ExpertReportsResponse, PipelineExpertReport

router = APIRouter(prefix="/reports", tags=["reports"])


def _period_bounds(period: str, date_from: str | None, date_to: str | None) -> tuple[datetime, datetime]:
    now = datetime.now(UTC)
    if period == "day":
        start = datetime(now.year, now.month, now.day, tzinfo=UTC)
        return start, start + timedelta(days=1)
    if period == "week":
        day_start = datetime(now.year, now.month, now.day, tzinfo=UTC)
        start = day_start - timedelta(days=day_start.weekday())
        end = start + timedelta(days=7)
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
    raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="period: day | week | custom")


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
        # Отчёт эксперта: только данные таблицы онлайн-записи.
        rows = (
            await db.execute(
                select(
                    BookingSpecialist.id,
                    BookingSpecialist.full_name,
                    BookingSpecialist.specialization,
                    func.count(distinct(BookingAppointment.patient_phone)).label("patients_booked"),
                    func.count(
                        distinct(
                            case(
                                (BookingAppointment.status == "completed", BookingAppointment.patient_phone),
                            )
                        )
                    ).label("patients_arrived"),
                )
                .join(BookingSpecialist, BookingSpecialist.id == BookingAppointment.specialist_id)
                .where(
                    BookingAppointment.pipeline_id == pipe.id,
                    BookingAppointment.start_at >= start,
                    BookingAppointment.start_at < end,
                )
                .group_by(BookingSpecialist.id, BookingSpecialist.full_name, BookingSpecialist.specialization)
                .order_by(func.count(distinct(BookingAppointment.patient_phone)).desc(), BookingSpecialist.id.asc())
            )
        ).all()

        experts: list[ExpertBookingItem] = []
        total_booked = 0
        total_arrived = 0
        for sid, full_name, spec, patients_booked, patients_arrived in rows:
            pb = int(patients_booked or 0)
            pa = int(patients_arrived or 0)
            total_booked += pb
            total_arrived += pa
            experts.append(
                ExpertBookingItem(
                    specialist_id=int(sid),
                    specialist_name=str(full_name),
                    specialization=(str(spec).strip() if spec else None),
                    patients_booked=pb,
                    patients_arrived=pa,
                )
            )

        items.append(
            PipelineExpertReport(
                pipeline_id=pipe.id,
                pipeline_name=pipe.name,
                patients_booked=total_booked,
                patients_arrived=total_arrived,
                experts=experts,
            )
        )

    return ExpertReportsResponse(
        period_start=start.isoformat(),
        period_end=end.isoformat(),
        items=items,
    )

