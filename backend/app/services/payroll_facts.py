"""Факты месяца для ведомости: касса записи и продажи курсов."""

from __future__ import annotations

from datetime import UTC, date, datetime, time, timedelta
from decimal import Decimal
from zoneinfo import ZoneInfo

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.models import (
    BookingAppointment,
    BookingDirection,
    BookingSpecialist,
    SalesKpiManualSale,
    SalesKpiManualSalePayment,
    SalesKpiPlanItem,
)
from app.services.patient_ltv import classify_product_kind
from app.services.payroll_rules import (
    PayrollFacts,
    is_free_gift_session,
    referral_procedure_line,
    service_line,
)


def _tz() -> ZoneInfo:
    try:
        return ZoneInfo(settings.booking_timezone or "Asia/Dushanbe")
    except Exception:
        return ZoneInfo("Asia/Dushanbe")


def _day(dt: datetime | None, tz: ZoneInfo) -> date | None:
    if dt is None:
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=UTC)
    return dt.astimezone(tz).date()


def _in_month(dt: datetime | None, tz: ZoneInfo, day_from: date, day_to: date) -> bool:
    day = _day(dt, tz)
    return day is not None and day_from <= day <= day_to


async def load_payroll_facts(
    db: AsyncSession,
    *,
    company_id: int,
    day_from: date,
    day_to: date,
    user_ids: set[int],
) -> dict[int, PayrollFacts]:
    tz = _tz()
    start = datetime.combine(day_from, time.min, tzinfo=tz).astimezone(UTC) - timedelta(days=1)
    end = datetime.combine(day_to, time.max, tzinfo=tz).astimezone(UTC) + timedelta(days=1)

    single = Decimal("0")
    sessions: dict[int, int] = {uid: 0 for uid in user_ids}
    own_osteo: dict[int, Decimal] = {uid: Decimal("0") for uid in user_ids}
    ref_osteo: dict[int, Decimal] = {uid: Decimal("0") for uid in user_ids}
    ref_tms: dict[int, Decimal] = {uid: Decimal("0") for uid in user_ids}
    ref_lab: dict[int, Decimal] = {uid: Decimal("0") for uid in user_ids}
    ref_massage: dict[int, Decimal] = {uid: Decimal("0") for uid in user_ids}

    visits = (
        await db.execute(
            select(
                BookingAppointment.service_amount,
                BookingAppointment.paid_amount,
                BookingAppointment.start_at,
                BookingAppointment.service_title,
                BookingAppointment.comment,
                BookingAppointment.referred_by_user_id,
                BookingDirection.name,
                BookingSpecialist.crm_user_id,
            )
            .join(BookingDirection, BookingDirection.id == BookingAppointment.direction_id)
            .join(BookingSpecialist, BookingSpecialist.id == BookingAppointment.specialist_id)
            .where(
                BookingAppointment.company_id == company_id,
                BookingAppointment.status == "completed",
                BookingAppointment.start_at >= start,
                BookingAppointment.start_at <= end,
            )
        )
    ).all()
    for service, paid, start_at, title, comment, referred_by, direction_name, crm_user_id in visits:
        if not _in_month(start_at, tz, day_from, day_to):
            continue
        amount = Decimal(str(paid or 0))
        service_amount = Decimal(str(service or 0))
        label = direction_name or title or ""
        line = service_line(label)
        gift = is_free_gift_session(service_amount, amount, title, comment, direction_name)
        bonus_line = line in ("massage", "speech_massage", "tms")
        if gift and bonus_line:
            continue
        if classify_product_kind(label) == "other_service":
            single += amount
        ref_line = referral_procedure_line(direction_name, title)
        rid = int(referred_by) if referred_by is not None else None
        if rid is not None and rid in user_ids and amount > 0 and ref_line is not None:
            bucket = {
                "osteopath": ref_osteo,
                "tms": ref_tms,
                "lab": ref_lab,
                "massage": ref_massage,
            }[ref_line]
            bucket[rid] = bucket.get(rid, Decimal("0")) + amount
        uid = int(crm_user_id) if crm_user_id is not None else None
        if uid is None or uid not in user_ids:
            continue
        if line in ("massage", "speech_massage"):
            sessions[uid] = sessions.get(uid, 0) + 1
        if line == "osteopath":
            own_osteo[uid] = own_osteo.get(uid, Decimal("0")) + amount

    referred: dict[int, int] = {uid: 0 for uid in user_ids}
    first_paid: dict[int, Decimal] = {uid: Decimal("0") for uid in user_ids}
    open_debt: dict[int, Decimal] = {uid: Decimal("0") for uid in user_ids}
    sales = (
        await db.execute(
            select(
                SalesKpiManualSale.manager_user_id,
                SalesKpiManualSale.service_amount,
                SalesKpiManualSale.paid_amount,
                SalesKpiManualSale.first_paid_amount,
                SalesKpiManualSale.sold_at,
                SalesKpiManualSale.status,
                SalesKpiPlanItem.name,
            )
            .join(SalesKpiPlanItem, SalesKpiPlanItem.id == SalesKpiManualSale.plan_item_id)
            .where(SalesKpiManualSale.company_id == company_id)
        )
    ).all()
    for manager_id, sa, pa, first, sold_at, status, item_name in sales:
        uid = int(manager_id) if manager_id is not None else None
        if uid is None or uid not in user_ids:
            continue
        kind = classify_product_kind(item_name)
        st = (status or "").strip()
        closed = st in ("returned", "cancelled", "refused")
        if not closed:
            gap = Decimal(str(sa or 0)) - Decimal(str(pa or 0))
            if gap > 0:
                open_debt[uid] = open_debt.get(uid, Decimal("0")) + gap
        if closed or not _in_month(sold_at, tz, day_from, day_to):
            continue
        if kind == "main_course":
            referred[uid] = referred.get(uid, 0) + 1
        if kind in ("main_course", "course_15"):
            first_paid[uid] = first_paid.get(uid, Decimal("0")) + Decimal(str(first or 0))

    collected = Decimal("0")
    payments = (
        await db.execute(
            select(SalesKpiManualSalePayment.amount, SalesKpiManualSalePayment.paid_at, SalesKpiManualSalePayment.is_first)
            .where(
                SalesKpiManualSalePayment.company_id == company_id,
                SalesKpiManualSalePayment.paid_at >= start,
                SalesKpiManualSalePayment.paid_at <= end,
            )
        )
    ).all()
    for amount, paid_at, is_first in payments:
        if is_first or not _in_month(paid_at, tz, day_from, day_to):
            continue
        amt = Decimal(str(amount or 0))
        if amt > 0:
            collected += amt

    out: dict[int, PayrollFacts] = {}
    for uid in user_ids:
        out[uid] = PayrollFacts(
            osteopath_paid=ref_osteo.get(uid, Decimal("0")),
            tms_paid=ref_tms.get(uid, Decimal("0")),
            lab_paid=ref_lab.get(uid, Decimal("0")),
            massage_paid=ref_massage.get(uid, Decimal("0")),
            own_sessions=sessions.get(uid, 0),
            own_osteopath_paid=own_osteo.get(uid, Decimal("0")),
            referred_main_courses=referred.get(uid, 0),
            first_course_payments=first_paid.get(uid, Decimal("0")),
            debt_collected=collected,
            open_debt=open_debt.get(uid, Decimal("0")),
            single_procedure_paid=single,
        )
    return out
