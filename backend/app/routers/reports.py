from collections import defaultdict
from datetime import UTC, datetime, timedelta
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import case, distinct, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import CurrentUser
from app.database import get_db
from app.models import (
    BookingAppointment,
    BookingDirection,
    BookingSpecialist,
    PatientServiceEnrollment,
    PaymentInstallment,
    Pipeline,
    UserRole,
)
from app.routers.booking import _visit_group_key, _visit_labels_for_ids
from app.services.booking_visit_labels import VisitLabelInfo
from app.schemas.reports import (
    DirectionPaymentSummary,
    ExpertBookingItem,
    ExpertReportsResponse,
    PipelineExpertReport,
)

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


def _aggregate_expert_visit_stats(
    rows: list[tuple],
    visit_map: dict[int, VisitLabelInfo],
) -> dict[int, dict[str, int | set[tuple[str, int]]]]:
    """rows: (appt_id, specialist_id, patient_phone, status) in period."""
    stats: dict[int, dict] = defaultdict(
        lambda: {
            "first_phones": set(),
            "repeat_phones": set(),
        },
    )
    for appt_id, sid, phone, st in rows:
        if str(st) == "cancelled":
            continue
        sid = int(sid)
        li = visit_map.get(int(appt_id)) or VisitLabelInfo(visit_number=1, visit_label="1")
        key = _visit_group_key(phone, sid)
        if li.visit_stream is not None and li.visit_stream_day is not None:
            if int(li.visit_stream) == 1 and int(li.visit_stream_day) == 1:
                stats[sid]["first_phones"].add(key)
            if int(li.visit_stream) >= 2 or (
                int(li.visit_stream) == 1 and int(li.visit_stream_day) > 1
            ):
                stats[sid]["repeat_phones"].add(key)
        else:
            vn = int(li.visit_number or 1)
            if vn <= 1:
                stats[sid]["first_phones"].add(key)
            if vn >= 2:
                stats[sid]["repeat_phones"].add(key)
    return stats


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

    company_id = int(current_user.company_id)
    start, end = _period_bounds(period, date_from, date_to)

    pipes_q = select(Pipeline).order_by(Pipeline.id.asc())
    if current_user.role == UserRole.expert:
        pipes_q = pipes_q.where(Pipeline.expert_user_id == current_user.id)
    pipes = (await db.execute(pipes_q)).scalars().all()

    items: list[PipelineExpertReport] = []
    for pipe in pipes:
        appt_rows = (
            await db.execute(
                select(
                    BookingAppointment.id,
                    BookingAppointment.specialist_id,
                    BookingAppointment.patient_phone,
                    BookingAppointment.status,
                )
                .join(BookingSpecialist, BookingSpecialist.id == BookingAppointment.specialist_id)
                .join(
                    BookingDirection,
                    BookingAppointment.direction_id == BookingDirection.id,
                )
                .where(
                    or_(
                        BookingAppointment.pipeline_id == pipe.id,
                        BookingDirection.pipeline_id == pipe.id,
                    ),
                    BookingAppointment.company_id == company_id,
                    BookingAppointment.start_at >= start,
                    BookingAppointment.start_at < end,
                )
            )
        ).all()

        appt_ids = [int(r[0]) for r in appt_rows]
        visit_map = await _visit_labels_for_ids(db, company_id=company_id, appointment_ids=appt_ids)
        visit_stats = _aggregate_expert_visit_stats(appt_rows, visit_map)

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
                .join(
                    BookingDirection,
                    BookingAppointment.direction_id == BookingDirection.id,
                )
                .where(
                    or_(
                        BookingAppointment.pipeline_id == pipe.id,
                        BookingDirection.pipeline_id == pipe.id,
                    ),
                    BookingAppointment.company_id == company_id,
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
        total_first = 0
        total_repeat = 0
        total_sessions = 0
        for sid, full_name, spec, patients_booked, patients_arrived in rows:
            sid_int = int(sid)
            pb = int(patients_booked or 0)
            pa = int(patients_arrived or 0)
            vs = visit_stats.get(sid_int, {})
            first_n = len(vs.get("first_phones", set()))
            repeat_n = len(vs.get("repeat_phones", set()))
            sessions_n = pa  # Сеансы = Пришло (уникальные пациенты со статусом completed)
            total_booked += pb
            total_arrived += pa
            total_first += first_n
            total_repeat += repeat_n
            total_sessions += sessions_n
            experts.append(
                ExpertBookingItem(
                    specialist_id=sid_int,
                    specialist_name=str(full_name),
                    specialization=(str(spec).strip() if spec else None),
                    patients_booked=pb,
                    patients_arrived=pa,
                    first_visit_patients=first_n,
                    repeat_patients=repeat_n,
                    sessions_total=sessions_n,
                )
            )

        appt_pay_rows = (
            await db.execute(
                select(
                    BookingDirection.id,
                    BookingDirection.name,
                    func.coalesce(func.sum(BookingAppointment.paid_amount), 0),
                    func.coalesce(func.sum(BookingAppointment.service_amount), 0),
                )
                .join(BookingDirection, BookingAppointment.direction_id == BookingDirection.id)
                .where(
                    or_(
                        BookingAppointment.pipeline_id == pipe.id,
                        BookingDirection.pipeline_id == pipe.id,
                    ),
                    BookingAppointment.company_id == company_id,
                    BookingAppointment.start_at >= start,
                    BookingAppointment.start_at < end,
                    BookingAppointment.status != "cancelled",
                )
                .group_by(BookingDirection.id, BookingDirection.name)
                .order_by(BookingDirection.name.asc()),
            )
        ).all()

        inst_pay_rows = (
            await db.execute(
                select(
                    BookingDirection.id,
                    BookingDirection.name,
                    func.coalesce(func.sum(PaymentInstallment.amount), 0),
                )
                .join(PatientServiceEnrollment, PatientServiceEnrollment.id == PaymentInstallment.enrollment_id)
                .join(BookingDirection, BookingDirection.id == PatientServiceEnrollment.direction_id)
                .where(
                    PatientServiceEnrollment.company_id == company_id,
                    PatientServiceEnrollment.pipeline_id == pipe.id,
                    PaymentInstallment.status == "paid",
                    PaymentInstallment.paid_at >= start,
                    PaymentInstallment.paid_at < end,
                )
                .group_by(BookingDirection.id, BookingDirection.name)
            )
        ).all()

        pay_map: dict[int, DirectionPaymentSummary] = {}
        for did, dname, paid, billed in appt_pay_rows:
            pay_map[int(did)] = DirectionPaymentSummary(
                direction_id=int(did),
                direction_name=str(dname),
                appointments_paid=float(paid or 0),
                appointments_billed=float(billed or 0),
                installments_paid=0.0,
            )
        for did, dname, inst_paid in inst_pay_rows:
            key = int(did)
            if key in pay_map:
                pay_map[key].installments_paid = float(inst_paid or 0)
            else:
                pay_map[key] = DirectionPaymentSummary(
                    direction_id=key,
                    direction_name=str(dname),
                    installments_paid=float(inst_paid or 0),
                )

        items.append(
            PipelineExpertReport(
                pipeline_id=pipe.id,
                pipeline_name=pipe.name,
                patients_booked=total_booked,
                patients_arrived=total_arrived,
                first_visit_patients=total_first,
                repeat_patients=total_repeat,
                sessions_total=total_sessions,
                direction_payments=sorted(pay_map.values(), key=lambda x: x.direction_name),
                experts=experts,
            )
        )

    return ExpertReportsResponse(
        period_start=start.isoformat(),
        period_end=end.isoformat(),
        items=items,
    )
