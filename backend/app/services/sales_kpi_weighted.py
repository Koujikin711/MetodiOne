"""Взвешенный KPI продаж: общий план, факт из записи (100%) и курсов (≥25%), возвраты."""

from __future__ import annotations

from datetime import UTC, date, datetime
import calendar
from decimal import Decimal
from zoneinfo import ZoneInfo

from sqlalchemy import ColumnElement, exists, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import aliased

from app.config import settings
from app.models import (
    BookingAppointment,
    BookingDirection,
    Lead,
    ManagerDeskSale,
    PipelineStage,
    SalesKpiManualSale,
    SalesKpiManualSalePayment,
    SalesKpiPlanItem,
    SalesKpiPlanItemService,
    SalesKpiPlanItemSpecialist,
    SalesKpiWeightedSettings,
    User,
    UserPipelineAssignment,
    UserRole,
)

MANUAL_SALE_MIN_PAID_RATIO = Decimal("0.25")
# Отказ и возврат из факта выходят. Завершённая продажа остаётся.
MANUAL_SALE_KPI_STATUSES = frozenset({"active", "completed"})
DEFAULT_BONUS_FUND = Decimal("10000")
# С отчётов за июль 2026+: июньские (и более ранние) записи в факт не входят.
# Бонус всегда в месяц явки (start_at); «записали в июле → пришли в августе» = август.
KPI_EXCLUDE_PRE_JULY_BOOKINGS_FROM = date(2026, 7, 1)


def parse_year_month(s: str) -> date:
    t = (s or "").strip()
    if len(t) == 7 and t[4] == "-":
        y, m = int(t[:4]), int(t[5:7])
        if 1 <= m <= 12:
            return date(y, m, 1)
    raise ValueError("year_month: ожидается YYYY-MM")


def month_bounds(ym: date) -> tuple[datetime, datetime]:
    start = datetime(ym.year, ym.month, 1, tzinfo=UTC)
    if ym.month == 12:
        end = datetime(ym.year + 1, 1, 1, tzinfo=UTC)
    else:
        end = datetime(ym.year, ym.month + 1, 1, tzinfo=UTC)
    return start, end


def paid_at_from_input(raw: date | datetime | None, *, fallback: datetime | None = None) -> datetime:
    """Дата платежа → UTC (полдень booking_timezone). Пусто = fallback или сейчас."""
    if isinstance(raw, datetime):
        dt = raw
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=UTC)
        return dt.astimezone(UTC)
    if isinstance(raw, date):
        tz = ZoneInfo(settings.booking_timezone or "Asia/Dushanbe")
        return datetime(raw.year, raw.month, raw.day, 12, 0, tzinfo=tz).astimezone(UTC)
    if fallback is not None:
        return fallback if fallback.tzinfo else fallback.replace(tzinfo=UTC)
    return datetime.now(UTC)


def booking_debt_cutoff(month_end: datetime, *, now: datetime | None = None) -> datetime:
    """Дебиторка записи: только прошедшее время (не будущее внутри выбранного месяца)."""
    n = now or datetime.now(UTC)
    if n.tzinfo is None:
        n = n.replace(tzinfo=UTC)
    end = month_end if month_end.tzinfo else month_end.replace(tzinfo=UTC)
    return n if n < end else end


def course_debt_is_due(first_paid_at: datetime, cutoff: datetime) -> bool:
    """Остаток курса — дебиторка через календарный месяц после первой оплаты.

    Первая оплата 14 сентября → в дебиторке с 14 октября. До этого дня остаток не долг.
    """
    tz = ZoneInfo(settings.booking_timezone or "Asia/Dushanbe")

    def local_day(dt: datetime) -> date:
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=UTC)
        return dt.astimezone(tz).date()

    start = local_day(first_paid_at)
    month = start.month + 1
    year = start.year + (month - 1) // 12
    month = (month - 1) % 12 + 1
    day = min(start.day, calendar.monthrange(year, month)[1])
    return local_day(cutoff) >= date(year, month, day)


def first_course_payment_at(sold_at: datetime, payments: list) -> datetime:
    """Дата первой оплаты: строка журнала с is_first, иначе дата продажи."""
    firsts = [
        p.paid_at
        for p in payments
        if getattr(p, "is_first", False) and getattr(p, "paid_at", None) is not None
    ]
    if firsts:
        return min(firsts)
    if sold_at.tzinfo is None:
        return sold_at.replace(tzinfo=UTC)
    return sold_at


def kpi_booking_created_cutoff(ym: date) -> datetime | None:
    """Нижняя граница created_at для факта KPI, или None если фильтр не нужен."""
    if ym < KPI_EXCLUDE_PRE_JULY_BOOKINGS_FROM:
        return None
    local = datetime(
        KPI_EXCLUDE_PRE_JULY_BOOKINGS_FROM.year,
        KPI_EXCLUDE_PRE_JULY_BOOKINGS_FROM.month,
        KPI_EXCLUDE_PRE_JULY_BOOKINGS_FROM.day,
        tzinfo=ZoneInfo(settings.booking_timezone),
    )
    return local.astimezone(UTC)


def booking_fact_filters(ym: date) -> list[ColumnElement[bool]]:
    """Фильтры онлайн-записи для факта: месяц явки + с июля 2026 без июньских созданий."""
    start, end = month_bounds(ym)
    filters: list[ColumnElement[bool]] = [
        BookingAppointment.start_at >= start,
        BookingAppointment.start_at < end,
        BookingAppointment.service_amount > 0,
        BookingAppointment.paid_amount >= BookingAppointment.service_amount,
    ]
    cutoff = kpi_booking_created_cutoff(ym)
    if cutoff is not None:
        filters.append(BookingAppointment.created_at >= cutoff)
    return filters


def earning_from_brought(brought: Decimal, percent: Decimal) -> Decimal:
    """Заработок = процент услуги × (вошло − возвраты). Отрицательная сумма уменьшает заработок."""
    brought_q = Decimal(str(brought or 0))
    percent_q = Decimal(str(percent or 0))
    if brought_q == 0 or percent_q <= 0:
        return Decimal("0.00")
    return (brought_q * percent_q / Decimal("100")).quantize(Decimal("0.01"))


async def load_brought_paid_by_service(
    db: AsyncSession,
    *,
    company_id: int,
    pipeline_id: int,
    ym: date,
) -> dict[tuple[int, int], Decimal]:
    """Оплачено по услуге у менеджера, который сам создал запись. Частичная оплата тоже считается."""
    start, end = month_bounds(ym)
    filters: list[ColumnElement[bool]] = [
        BookingAppointment.company_id == company_id,
        BookingAppointment.start_at >= start,
        BookingAppointment.start_at < end,
        BookingAppointment.status != "cancelled",
        BookingAppointment.paid_amount > 0,
        User.role == UserRole.manager,
        or_(
            BookingAppointment.pipeline_id == pipeline_id,
            PipelineStage.pipeline_id == pipeline_id,
        ),
    ]
    cutoff = kpi_booking_created_cutoff(ym)
    if cutoff is not None:
        filters.append(BookingAppointment.created_at >= cutoff)
    rows = (
        await db.execute(
            select(
                BookingAppointment.created_by_user_id,
                BookingAppointment.direction_id,
                func.coalesce(func.sum(BookingAppointment.paid_amount), 0),
            )
            .select_from(BookingAppointment)
            .join(Lead, Lead.id == BookingAppointment.lead_id, isouter=True)
            .join(PipelineStage, PipelineStage.id == Lead.status_id, isouter=True)
            .join(User, User.id == BookingAppointment.created_by_user_id)
            .where(*filters)
            .group_by(BookingAppointment.created_by_user_id, BookingAppointment.direction_id),
        )
    ).all()
    out: dict[tuple[int, int], Decimal] = {}
    for manager_id, direction_id, paid in rows:
        if manager_id is None or direction_id is None:
            continue
        amount = Decimal(str(paid or 0)).quantize(Decimal("0.01"))
        if amount <= 0:
            continue
        out[(int(manager_id), int(direction_id))] = amount
    return out


async def load_brought_paid_detail(
    db: AsyncSession,
    *,
    company_id: int,
    pipeline_id: int,
    ym: date,
) -> dict[tuple[int, int, int, Decimal], Decimal]:
    """Сколько зашло по записи: (менеджер, эксперт, направление, цена услуги).

    Это не цена услуги. Берётся любая вошедшая сумма. Возврат, уже снятый с визита,
    прибавляется обратно: в месяце возврата он вычитается отдельно.
    Менеджер — ответственный на визите, если это менеджер. Иначе тот, кто создал запись.
    """
    start, end = month_bounds(ym)
    refunds_by_appt = await _booking_refunds_by_appointment(db, company_id=company_id)
    creator = aliased(User)
    responsible = aliased(User)
    filters: list[ColumnElement[bool]] = [
        BookingAppointment.company_id == company_id,
        BookingAppointment.start_at >= start,
        BookingAppointment.start_at < end,
        or_(
            BookingAppointment.paid_amount > 0,
            BookingAppointment.id.in_(list(refunds_by_appt)) if refunds_by_appt else BookingAppointment.paid_amount > 0,
        ),
        or_(
            BookingAppointment.pipeline_id == pipeline_id,
            PipelineStage.pipeline_id == pipeline_id,
        ),
    ]
    cutoff = kpi_booking_created_cutoff(ym)
    if cutoff is not None:
        filters.append(BookingAppointment.created_at >= cutoff)
    rows = (
        await db.execute(
            select(
                BookingAppointment.id,
                BookingAppointment.created_by_user_id,
                creator.role,
                BookingAppointment.responsible_manager_id,
                responsible.role,
                BookingAppointment.specialist_id,
                BookingAppointment.direction_id,
                BookingAppointment.service_amount,
                BookingAppointment.paid_amount,
            )
            .select_from(BookingAppointment)
            .join(Lead, Lead.id == BookingAppointment.lead_id, isouter=True)
            .join(PipelineStage, PipelineStage.id == Lead.status_id, isouter=True)
            .join(creator, creator.id == BookingAppointment.created_by_user_id, isouter=True)
            .join(responsible, responsible.id == BookingAppointment.responsible_manager_id, isouter=True)
            .where(*filters),
        )
    ).all()
    out: dict[tuple[int, int, int, Decimal], Decimal] = {}
    for appt_id, created_by, created_role, responsible_id, responsible_role, specialist_id, direction_id, service_amount, paid in rows:
        manager_id = brought_booking_manager_id(created_by, created_role, responsible_id, responsible_role)
        if manager_id is None or specialist_id is None or direction_id is None:
            continue
        # paid_amount уже без возврата. Вошедшая сумма = остаток + возвраты по этой записи.
        refunded = sum((amt for _day, amt in refunds_by_appt.get(int(appt_id), [])), Decimal("0"))
        amount = (Decimal(str(paid or 0)) + refunded).quantize(Decimal("0.01"))
        if amount <= 0:
            continue
        price = Decimal(str(service_amount or 0)).quantize(Decimal("0.01"))
        key = (int(manager_id), int(specialist_id), int(direction_id), price)
        out[key] = (out.get(key, Decimal("0")) + amount).quantize(Decimal("0.01"))
    return out


def _parse_booking_refund_appointment_id(external_key: str | None) -> int | None:
    key = (external_key or "").strip()
    if not key.startswith("booking_refund:"):
        return None
    parts = key.split(":")
    if len(parts) < 2 or not parts[1].isdigit():
        return None
    return int(parts[1])


async def _booking_refunds_by_appointment(
    db: AsyncSession,
    *,
    company_id: int,
) -> dict[int, list[tuple[date, Decimal]]]:
    """Возвраты записи: id визита → (дата, сумма). В ОСВ сумма лежит со знаком минус."""
    from app.models.finance_osv import FinanceOsvRow

    rows = (
        await db.execute(
            select(FinanceOsvRow.external_key, FinanceOsvRow.txn_date, FinanceOsvRow.expense).where(
                FinanceOsvRow.company_id == company_id,
                FinanceOsvRow.source == "booking_refund",
            ),
        )
    ).all()
    out: dict[int, list[tuple[date, Decimal]]] = {}
    for external_key, txn_date, expense in rows:
        appt_id = _parse_booking_refund_appointment_id(external_key)
        if appt_id is None or txn_date is None:
            continue
        amount = abs(Decimal(str(expense or 0))).quantize(Decimal("0.01"))
        if amount <= 0:
            continue
        out.setdefault(appt_id, []).append((txn_date, amount))
    return out


async def load_booking_brought_refunds(
    db: AsyncSession,
    *,
    company_id: int,
    pipeline_id: int,
    ym: date,
) -> dict[tuple[int, int, int, Decimal], Decimal]:
    """Возвраты записи за месяц. Вычитаются из вошедшей суммы той же услуги."""
    start, end = month_bounds(ym)
    refunds_by_appt = await _booking_refunds_by_appointment(db, company_id=company_id)
    month_ids = [
        appt_id
        for appt_id, items in refunds_by_appt.items()
        if any(start.date() <= day < end.date() for day, _amt in items)
    ]
    if not month_ids:
        return {}
    creator = aliased(User)
    responsible = aliased(User)
    rows = (
        await db.execute(
            select(
                BookingAppointment.id,
                BookingAppointment.created_by_user_id,
                creator.role,
                BookingAppointment.responsible_manager_id,
                responsible.role,
                BookingAppointment.specialist_id,
                BookingAppointment.direction_id,
                BookingAppointment.service_amount,
            )
            .select_from(BookingAppointment)
            .join(Lead, Lead.id == BookingAppointment.lead_id, isouter=True)
            .join(PipelineStage, PipelineStage.id == Lead.status_id, isouter=True)
            .join(creator, creator.id == BookingAppointment.created_by_user_id, isouter=True)
            .join(responsible, responsible.id == BookingAppointment.responsible_manager_id, isouter=True)
            .where(
                BookingAppointment.company_id == company_id,
                BookingAppointment.id.in_(month_ids),
                or_(
                    BookingAppointment.pipeline_id == pipeline_id,
                    PipelineStage.pipeline_id == pipeline_id,
                ),
            ),
        )
    ).all()
    out: dict[tuple[int, int, int, Decimal], Decimal] = {}
    for appt_id, created_by, created_role, responsible_id, responsible_role, specialist_id, direction_id, service_amount in rows:
        manager_id = brought_booking_manager_id(created_by, created_role, responsible_id, responsible_role)
        if manager_id is None or specialist_id is None or direction_id is None:
            continue
        month_sum = sum(
            (amt for day, amt in refunds_by_appt.get(int(appt_id), []) if start.date() <= day < end.date()),
            Decimal("0"),
        ).quantize(Decimal("0.01"))
        if month_sum <= 0:
            continue
        price = Decimal(str(service_amount or 0)).quantize(Decimal("0.01"))
        key = (int(manager_id), int(specialist_id), int(direction_id), price)
        out[key] = (out.get(key, Decimal("0")) + month_sum).quantize(Decimal("0.01"))
    return out


def _is_manager_role(role) -> bool:
    if role is None:
        return False
    value = getattr(role, "value", role)
    return str(value) == UserRole.manager.value


def brought_booking_manager_id(
    created_by: int | None,
    created_role,
    responsible_id: int | None,
    responsible_role,
) -> int | None:
    """Оплата услуги: ответственный менеджер, иначе менеджер, который создал запись."""
    if responsible_id is not None and _is_manager_role(responsible_role):
        return int(responsible_id)
    if created_by is not None and _is_manager_role(created_role):
        return int(created_by)
    return None


async def load_booking_direction_names(
    db: AsyncSession,
    *,
    company_id: int,
) -> dict[int, str]:
    rows = (
        await db.execute(
            select(BookingDirection.id, BookingDirection.name).where(
                BookingDirection.company_id == company_id,
            ),
        )
    ).all()
    return {int(did): str(name or "") for did, name in rows if did is not None}


def _labels_same_service(left: str | None, right: str | None) -> bool:
    """Имя услуги в плане и имя направления записи. Одна замена буквы тоже сходится.

    В каталоге направление называется «Остиопат», в плане — «Остеопат».
    «Курс» и «Курс 15» дальше одной буквы и не склеиваются.
    """
    a = _norm_kpi_label(left)
    b = _norm_kpi_label(right)
    if not a or not b:
        return False
    if a == b:
        return True
    if abs(len(a) - len(b)) > 1:
        return False
    if len(a) == len(b):
        return sum(x != y for x, y in zip(a, b)) == 1
    if len(a) > len(b):
        a, b = b, a
    i = j = skipped = 0
    while i < len(a) and j < len(b):
        if a[i] != b[j]:
            skipped += 1
            if skipped > 1:
                return False
            j += 1
            continue
        i += 1
        j += 1
    return True


def service_direction_ids(name: str, direction_names: dict[int, str] | None) -> list[int]:
    """Направления записи с тем же именем, что услуга в плане. Кабинет эксперта сюда не входит."""
    if not direction_names:
        return []
    return [int(did) for did, label in direction_names.items() if _labels_same_service(label, name)]


def _detail_row(key: tuple) -> tuple[int, int, int, Decimal | None]:
    if len(key) >= 4:
        mid, sid, did, amt = key[0], key[1], key[2], key[3]
        amount = Decimal(str(amt)).quantize(Decimal("0.01")) if amt is not None else None
        return int(mid), int(sid), int(did), amount
    mid, sid, did = key
    return int(mid), int(sid), int(did), None


def brought_for_plan_item(
    *,
    manager_id: int,
    source_type: str,
    name: str,
    direction_id: int | None,
    direction_ids: list[int],
    specialist_ids: list[int],
    detail: dict,
    manual: dict[tuple[int, str], Decimal],
    direction_names: dict[int, str] | None = None,
    unit_price: Decimal | None = None,
    refund_detail: dict | None = None,
    manual_refunds: dict[tuple[int, str], Decimal] | None = None,
) -> Decimal:
    """Вошло по услуге минус возвраты. Не цена услуги и не полная оплата.

    direction_id строки — кабинет эксперта (консультация, массаж), не сама услуга.
    Если услуги явно не выбраны, берём вошедшие суммы направления с именем услуги
    либо визит этого эксперта с её ценой. Курс и протокол: форма и такая же запись.
    """
    incoming = _matched_brought(
        manager_id=manager_id,
        source_type=source_type,
        name=name,
        direction_id=direction_id,
        direction_ids=direction_ids,
        specialist_ids=specialist_ids,
        detail=detail,
        manual=manual,
        direction_names=direction_names,
        unit_price=unit_price,
    )
    refunded = _matched_brought(
        manager_id=manager_id,
        source_type=source_type,
        name=name,
        direction_id=direction_id,
        direction_ids=direction_ids,
        specialist_ids=specialist_ids,
        detail=refund_detail or {},
        manual=manual_refunds or {},
        direction_names=direction_names,
        unit_price=unit_price,
    )
    return (incoming - refunded).quantize(Decimal("0.01"))


def _matched_brought(
    *,
    manager_id: int,
    source_type: str,
    name: str,
    direction_id: int | None,
    direction_ids: list[int],
    specialist_ids: list[int],
    detail: dict,
    manual: dict[tuple[int, str], Decimal],
    direction_names: dict[int, str] | None = None,
    unit_price: Decimal | None = None,
) -> Decimal:
    named = service_direction_ids(name, direction_names)
    if (source_type or "manual") != "direction":
        total = manual.get((manager_id, _norm_kpi_label(name)), Decimal("0"))
        if named:
            for key, amount in detail.items():
                mid, _sid, did, _service_amount = _detail_row(key)
                if mid == manager_id and did in named:
                    total += amount
        return total.quantize(Decimal("0.01"))
    explicit = [int(d) for d in direction_ids]
    specs = {int(s) for s in specialist_ids}
    price = Decimal(str(unit_price or 0))
    total = Decimal("0")
    for key, amount in detail.items():
        mid, sid, did, service_amount = _detail_row(key)
        if mid != manager_id:
            continue
        if explicit:
            if did not in explicit:
                continue
            if specs and sid not in specs:
                continue
        elif named or specs:
            name_ok = did in named
            price_ok = (
                sid in specs
                and service_amount is not None
                and price > 0
                and amounts_match_unit_price(service_amount, price)
            )
            if not name_ok and not price_ok:
                continue
        elif direction_id is not None and did == int(direction_id):
            pass
        else:
            continue
        total += amount
    return total.quantize(Decimal("0.01"))


async def load_manual_brought_by_label(
    db: AsyncSession,
    *,
    company_id: int,
    pipeline_id: int,
    ym: date,
) -> dict[tuple[int, str], Decimal]:
    """Любая вошедшая сумма курса и протокола за месяц, без порога и без цены услуги."""
    start, end = month_bounds(ym)
    rows = (
        await db.execute(
            select(
                SalesKpiManualSale.manager_user_id,
                SalesKpiPlanItem.name,
                func.coalesce(func.sum(SalesKpiManualSalePayment.amount), 0),
            )
            .select_from(SalesKpiManualSalePayment)
            .join(SalesKpiManualSale, SalesKpiManualSale.id == SalesKpiManualSalePayment.sale_id)
            .join(SalesKpiPlanItem, SalesKpiPlanItem.id == SalesKpiManualSale.plan_item_id)
            .where(
                SalesKpiManualSale.company_id == company_id,
                SalesKpiManualSale.pipeline_id == pipeline_id,
                SalesKpiManualSalePayment.paid_at >= start,
                SalesKpiManualSalePayment.paid_at < end,
                SalesKpiManualSalePayment.amount > 0,
            )
            .group_by(SalesKpiManualSale.manager_user_id, SalesKpiPlanItem.name),
        )
    ).all()
    out: dict[tuple[int, str], Decimal] = {}
    for manager_id, name, paid in rows:
        if manager_id is None:
            continue
        label = _norm_kpi_label(str(name or ""))
        if not label:
            continue
        amount = Decimal(str(paid or 0)).quantize(Decimal("0.01"))
        if amount <= 0:
            continue
        key = (int(manager_id), label)
        out[key] = (out.get(key, Decimal("0")) + amount).quantize(Decimal("0.01"))

    # Продажа месяца без строк журнала: оплата всё равно считается в месяц заведения.
    legacy_rows = (
        await db.execute(
            select(
                SalesKpiManualSale.manager_user_id,
                SalesKpiPlanItem.name,
                SalesKpiManualSale.paid_amount,
            )
            .join(SalesKpiPlanItem, SalesKpiPlanItem.id == SalesKpiManualSale.plan_item_id)
            .where(
                SalesKpiManualSale.company_id == company_id,
                SalesKpiManualSale.pipeline_id == pipeline_id,
                SalesKpiManualSale.sold_at >= start,
                SalesKpiManualSale.sold_at < end,
                SalesKpiManualSale.paid_amount > 0,
                ~exists(
                    select(SalesKpiManualSalePayment.id).where(
                        SalesKpiManualSalePayment.sale_id == SalesKpiManualSale.id,
                    ),
                ),
            ),
        )
    ).all()
    for manager_id, name, paid in legacy_rows:
        if manager_id is None:
            continue
        label = _norm_kpi_label(str(name or ""))
        if not label:
            continue
        amount = Decimal(str(paid or 0)).quantize(Decimal("0.01"))
        if amount <= 0:
            continue
        key = (int(manager_id), label)
        out[key] = (out.get(key, Decimal("0")) + amount).quantize(Decimal("0.01"))
    return out


async def load_manual_refunds_by_label(
    db: AsyncSession,
    *,
    company_id: int,
    pipeline_id: int,
    ym: date,
) -> dict[tuple[int, str], Decimal]:
    """Возврат курса или протокола в месяц returned_at. Вычитается из вошедшей суммы."""
    start, end = month_bounds(ym)
    rows = (
        await db.execute(
            select(
                SalesKpiManualSale.manager_user_id,
                SalesKpiPlanItem.name,
                func.coalesce(func.sum(SalesKpiManualSale.paid_amount), 0),
            )
            .join(SalesKpiPlanItem, SalesKpiPlanItem.id == SalesKpiManualSale.plan_item_id)
            .where(
                SalesKpiManualSale.company_id == company_id,
                SalesKpiManualSale.pipeline_id == pipeline_id,
                SalesKpiManualSale.status == "returned",
                SalesKpiManualSale.returned_at.is_not(None),
                SalesKpiManualSale.returned_at >= start,
                SalesKpiManualSale.returned_at < end,
                SalesKpiManualSale.paid_amount > 0,
            )
            .group_by(SalesKpiManualSale.manager_user_id, SalesKpiPlanItem.name),
        )
    ).all()
    out: dict[tuple[int, str], Decimal] = {}
    for manager_id, name, paid in rows:
        if manager_id is None:
            continue
        label = _norm_kpi_label(str(name or ""))
        if not label:
            continue
        amount = Decimal(str(paid or 0)).quantize(Decimal("0.01"))
        if amount <= 0:
            continue
        key = (int(manager_id), label)
        out[key] = (out.get(key, Decimal("0")) + amount).quantize(Decimal("0.01"))
    return out


def manager_expr():
    """Кто получает факт онлайн-записи: только менеджер, который сам создал запись.

    Админ и администратор могут поставить ответственным менеджера — в его KPI это не идёт.
    """
    return BookingAppointment.created_by_user_id


def completion_ratio(fact: int, plan_qty: int) -> Decimal | None:
    if plan_qty <= 0:
        return None
    return min(Decimal(fact) / Decimal(plan_qty), Decimal("1"))


def contribution(completion: Decimal | None, weight_percent: Decimal) -> Decimal:
    if completion is None:
        return Decimal("0")
    # вес хранится как 25 (=25%), вклад = выполнен. × вес × 0.01
    return (completion * Decimal(str(weight_percent)) * Decimal("0.01")).quantize(Decimal("0.0001"))


def bonus_amount(total_contribution: Decimal, bonus_fund: Decimal) -> Decimal:
    return (Decimal(str(bonus_fund)) * total_contribution).quantize(Decimal("0.01"))


async def load_bonus_fund(
    db: AsyncSession,
    *,
    company_id: int,
    pipeline_id: int,
    ym: date,
) -> Decimal:
    row = (
        await db.execute(
            select(SalesKpiWeightedSettings.bonus_fund).where(
                SalesKpiWeightedSettings.company_id == company_id,
                SalesKpiWeightedSettings.pipeline_id == pipeline_id,
                SalesKpiWeightedSettings.year_month == ym,
            ),
        )
    ).scalar_one_or_none()
    if row is None:
        return DEFAULT_BONUS_FUND
    return Decimal(str(row))


async def load_plan_items(
    db: AsyncSession,
    *,
    company_id: int,
    pipeline_id: int,
    ym: date,
) -> list[SalesKpiPlanItem]:
    rows = (
        await db.execute(
            select(SalesKpiPlanItem)
            .where(
                SalesKpiPlanItem.company_id == company_id,
                SalesKpiPlanItem.pipeline_id == pipeline_id,
                SalesKpiPlanItem.year_month == ym,
            )
            .order_by(SalesKpiPlanItem.sort_order.asc(), SalesKpiPlanItem.id.asc()),
        )
    ).scalars().all()
    return list(rows)


def shift_year_month(ym: date, months: int) -> date:
    """Сдвиг YYYY-MM-01 на N месяцев (months может быть отрицательным)."""
    idx = ym.year * 12 + (ym.month - 1) + months
    return date(idx // 12, idx % 12 + 1, 1)


async def ensure_plan_carried_forward(
    db: AsyncSession,
    *,
    company_id: int,
    pipeline_id: int,
    ym: date,
) -> tuple[list[SalesKpiPlanItem], bool]:
    """Если в выбранном месяце плана нет — копируем последний сохранённый.

    Возвращает (items, carried): carried=True если только что скопировали.
    """
    items = await load_plan_items(db, company_id=company_id, pipeline_id=pipeline_id, ym=ym)
    if items:
        return items, False

    prev_ym = (
        await db.execute(
            select(SalesKpiPlanItem.year_month)
            .where(
                SalesKpiPlanItem.company_id == company_id,
                SalesKpiPlanItem.pipeline_id == pipeline_id,
                SalesKpiPlanItem.year_month < ym,
            )
            .order_by(SalesKpiPlanItem.year_month.desc())
            .limit(1),
        )
    ).scalar_one_or_none()
    if prev_ym is None:
        return [], False

    prev_items = await load_plan_items(db, company_id=company_id, pipeline_id=pipeline_id, ym=prev_ym)
    if not prev_items:
        return [], False

    prev_ids = [int(i.id) for i in prev_items]
    prev_specs = await load_plan_item_specialists(db, plan_item_ids=prev_ids)
    prev_services = await load_plan_item_services(db, plan_item_ids=prev_ids)
    bonus = await load_bonus_fund(db, company_id=company_id, pipeline_id=pipeline_id, ym=prev_ym)

    existing_settings = (
        await db.execute(
            select(SalesKpiWeightedSettings).where(
                SalesKpiWeightedSettings.company_id == company_id,
                SalesKpiWeightedSettings.pipeline_id == pipeline_id,
                SalesKpiWeightedSettings.year_month == ym,
            ),
        )
    ).scalar_one_or_none()
    if existing_settings is None:
        db.add(
            SalesKpiWeightedSettings(
                company_id=company_id,
                pipeline_id=pipeline_id,
                year_month=ym,
                bonus_fund=bonus,
            ),
        )
    else:
        existing_settings.bonus_fund = bonus

    for src in prev_items:
        dst = SalesKpiPlanItem(
            company_id=company_id,
            pipeline_id=pipeline_id,
            year_month=ym,
            name=src.name,
            plan_qty=int(src.plan_qty or 0),
            weight_percent=Decimal(str(src.weight_percent or 0)),
            manager_percent=Decimal(str(src.manager_percent or 0)),
            source_type=src.source_type or "manual",
            direction_id=src.direction_id,
            sort_order=int(src.sort_order or 0),
        )
        db.add(dst)
        await db.flush()
        for sid in prev_specs.get(int(src.id), []):
            db.add(
                SalesKpiPlanItemSpecialist(
                    plan_item_id=int(dst.id),
                    specialist_id=int(sid),
                ),
            )
        for did in prev_services.get(int(src.id), []):
            db.add(
                SalesKpiPlanItemService(
                    plan_item_id=int(dst.id),
                    direction_id=int(did),
                ),
            )

    await db.commit()
    items = await load_plan_items(db, company_id=company_id, pipeline_id=pipeline_id, ym=ym)
    return items, True


async def load_managers(
    db: AsyncSession,
    *,
    company_id: int,
    pipeline_id: int,
) -> list[tuple[int, str]]:
    """Активные менеджеры воронки — блоки KPI создаются автоматически."""
    rows = (
        await db.execute(
            select(User.id, User.full_name, User.email)
            .join(
                UserPipelineAssignment,
                (UserPipelineAssignment.user_id == User.id)
                & (UserPipelineAssignment.pipeline_id == pipeline_id)
                & (UserPipelineAssignment.company_id == company_id),
            )
            .where(
                User.company_id == company_id,
                User.is_active.is_(True),
                User.role == UserRole.manager,
            )
            .order_by(User.full_name.asc().nulls_last(), User.email.asc()),
        )
    ).all()
    out: list[tuple[int, str]] = []
    for uid, full_name, email in rows:
        out.append((int(uid), str(full_name or email or f"#{uid}")))
    return out


async def load_direction_facts_full_paid(
    db: AsyncSession,
    *,
    company_id: int,
    pipeline_id: int,
    ym: date,
) -> dict[tuple[int, int], int]:
    """Факт по направлениям записи: 100% оплата и запись создал сам менеджер."""
    rows = (
        await db.execute(
            select(
                manager_expr(),
                BookingAppointment.direction_id,
                func.count(BookingAppointment.id),
            )
            .select_from(BookingAppointment)
            .join(Lead, Lead.id == BookingAppointment.lead_id, isouter=True)
            .join(PipelineStage, PipelineStage.id == Lead.status_id, isouter=True)
            .join(User, User.id == BookingAppointment.created_by_user_id)
            .where(
                BookingAppointment.company_id == company_id,
                User.role == UserRole.manager,
                *booking_fact_filters(ym),
                or_(
                    BookingAppointment.pipeline_id == pipeline_id,
                    PipelineStage.pipeline_id == pipeline_id,
                ),
            )
            .group_by(manager_expr(), BookingAppointment.direction_id),
        )
    ).all()
    out: dict[tuple[int, int], int] = {}
    for manager_id, direction_id, cnt in rows:
        if manager_id is None or direction_id is None:
            continue
        out[(int(manager_id), int(direction_id))] = int(cnt or 0)
    return out


async def load_specialist_facts_full_paid(
    db: AsyncSession,
    *,
    company_id: int,
    pipeline_id: int,
    ym: date,
) -> dict[tuple[int, int, Decimal], int]:
    """Факт по экспертам: (manager_id, specialist_id, service_amount) → шт при 100% оплате.

    Сумма услуги нужна, чтобы «Курс 15» (1300) не смешивать с разовой консультацией (150)
    или полным «Курсом» (16000) у того же эксперта.
    В факт менеджера входит только запись, которую создал он сам.
    """
    rows = (
        await db.execute(
            select(
                manager_expr(),
                BookingAppointment.specialist_id,
                BookingAppointment.service_amount,
                func.count(BookingAppointment.id),
            )
            .select_from(BookingAppointment)
            .join(Lead, Lead.id == BookingAppointment.lead_id, isouter=True)
            .join(PipelineStage, PipelineStage.id == Lead.status_id, isouter=True)
            .join(User, User.id == BookingAppointment.created_by_user_id)
            .where(
                BookingAppointment.company_id == company_id,
                User.role == UserRole.manager,
                *booking_fact_filters(ym),
                or_(
                    BookingAppointment.pipeline_id == pipeline_id,
                    PipelineStage.pipeline_id == pipeline_id,
                ),
            )
            .group_by(manager_expr(), BookingAppointment.specialist_id, BookingAppointment.service_amount),
        )
    ).all()
    out: dict[tuple[int, int, Decimal], int] = {}
    for manager_id, specialist_id, service_amount, cnt in rows:
        if manager_id is None or specialist_id is None:
            continue
        amt = Decimal(str(service_amount or 0)).quantize(Decimal("0.01"))
        out[(int(manager_id), int(specialist_id), amt)] = int(cnt or 0)
    return out


async def load_specialist_facts_company_full_paid(
    db: AsyncSession,
    *,
    company_id: int,
    pipeline_id: int,
    ym: date,
) -> dict[tuple[int, Decimal], int]:
    """Факт компании по экспертам: (specialist_id, service_amount) → шт, 100% оплата."""
    rows = (
        await db.execute(
            select(
                BookingAppointment.specialist_id,
                BookingAppointment.service_amount,
                func.count(BookingAppointment.id),
            )
            .select_from(BookingAppointment)
            .join(Lead, Lead.id == BookingAppointment.lead_id, isouter=True)
            .join(PipelineStage, PipelineStage.id == Lead.status_id, isouter=True)
            .where(
                BookingAppointment.company_id == company_id,
                *booking_fact_filters(ym),
                or_(
                    BookingAppointment.pipeline_id == pipeline_id,
                    PipelineStage.pipeline_id == pipeline_id,
                ),
            )
            .group_by(BookingAppointment.specialist_id, BookingAppointment.service_amount),
        )
    ).all()
    out: dict[tuple[int, Decimal], int] = {}
    for specialist_id, service_amount, cnt in rows:
        if specialist_id is None:
            continue
        amt = Decimal(str(service_amount or 0)).quantize(Decimal("0.01"))
        out[(int(specialist_id), amt)] = int(cnt or 0)
    return out


async def load_kpi_unit_prices_by_label(
    db: AsyncSession,
    *,
    company_id: int,
    pipeline_id: int | None = None,
    ym: date | None = None,
) -> dict[str, Decimal]:
    """Цена показателя по имени направления (напр. «Курс 15» → 1300).

    Берём цену месяца отчёта; если для направления в этом месяце нет — последнюю
    известную цену по тому же направлению (чтобы фильтр сумм не отключался).
    """
    from app.models import SalesKpiServicePrice

    price_q = select(
        SalesKpiServicePrice.direction_id,
        SalesKpiServicePrice.year_month,
        SalesKpiServicePrice.unit_price,
    ).where(SalesKpiServicePrice.company_id == company_id)
    if pipeline_id is not None:
        price_q = price_q.where(SalesKpiServicePrice.pipeline_id == pipeline_id)
    price_q = price_q.order_by(SalesKpiServicePrice.year_month.asc())
    price_rows = (await db.execute(price_q)).all()

    preferred: dict[int, Decimal] = {}
    fallback: dict[int, Decimal] = {}
    for did, year_month, up in price_rows:
        price = Decimal(str(up or 0))
        if price <= 0:
            continue
        did_i = int(did)
        if ym is not None and year_month == ym:
            preferred[did_i] = price
        else:
            fallback[did_i] = price

    dir_rows = (
        await db.execute(
            select(BookingDirection.id, BookingDirection.name).where(
                BookingDirection.company_id == company_id,
            ),
        )
    ).all()
    out: dict[str, Decimal] = {}
    for did, name in dir_rows:
        key = _norm_kpi_label(str(name or ""))
        if not key:
            continue
        price = preferred.get(int(did)) or fallback.get(int(did)) or Decimal("0")
        if price > 0:
            out[key] = price
    return out


def amounts_match_unit_price(amount: Decimal, unit_price: Decimal, *, tol: Decimal = Decimal("1")) -> bool:
    if unit_price <= 0:
        return True
    return abs(Decimal(str(amount)) - Decimal(str(unit_price))) <= tol


def sum_specialist_facts_for_manager(
    specialist_facts: dict[tuple[int, int, Decimal], int],
    *,
    manager_id: int,
    specialist_ids: list[int],
    unit_price: Decimal | None,
) -> int:
    total = 0
    sid_set = set(int(s) for s in specialist_ids)
    for (mid, sid, amt), cnt in specialist_facts.items():
        if mid != manager_id or sid not in sid_set:
            continue
        if unit_price is not None and unit_price > 0 and not amounts_match_unit_price(amt, unit_price):
            continue
        total += int(cnt or 0)
    return total


def sum_specialist_facts_company(
    specialist_company_facts: dict[tuple[int, Decimal], int],
    *,
    specialist_ids: list[int],
    unit_price: Decimal | None,
) -> int:
    total = 0
    sid_set = set(int(s) for s in specialist_ids)
    for (sid, amt), cnt in specialist_company_facts.items():
        if sid not in sid_set:
            continue
        if unit_price is not None and unit_price > 0 and not amounts_match_unit_price(amt, unit_price):
            continue
        total += int(cnt or 0)
    return total


async def load_booking_service_facts(
    db: AsyncSession,
    *,
    company_id: int,
    pipeline_id: int,
    ym: date,
) -> dict[tuple[int, int, int], int]:
    """Факт онлайн-записи: (manager_id, specialist_id, direction_id) → шт при 100% оплате."""
    rows = (
        await db.execute(
            select(
                manager_expr(),
                BookingAppointment.specialist_id,
                BookingAppointment.direction_id,
                func.count(BookingAppointment.id),
            )
            .select_from(BookingAppointment)
            .join(Lead, Lead.id == BookingAppointment.lead_id, isouter=True)
            .join(PipelineStage, PipelineStage.id == Lead.status_id, isouter=True)
            .join(User, User.id == BookingAppointment.created_by_user_id)
            .where(
                BookingAppointment.company_id == company_id,
                User.role == UserRole.manager,
                *booking_fact_filters(ym),
                or_(
                    BookingAppointment.pipeline_id == pipeline_id,
                    PipelineStage.pipeline_id == pipeline_id,
                ),
            )
            .group_by(manager_expr(), BookingAppointment.specialist_id, BookingAppointment.direction_id),
        )
    ).all()
    out: dict[tuple[int, int, int], int] = {}
    for manager_id, specialist_id, direction_id, cnt in rows:
        if manager_id is None or specialist_id is None or direction_id is None:
            continue
        out[(int(manager_id), int(specialist_id), int(direction_id))] = int(cnt or 0)
    return out


def sum_service_facts_for_manager(
    service_facts: dict[tuple[int, int, int], int],
    *,
    manager_id: int,
    specialist_ids: list[int],
    direction_ids: list[int],
) -> int:
    did_set = {int(d) for d in direction_ids}
    sid_set = {int(s) for s in specialist_ids}
    total = 0
    for (mid, sid, did), cnt in service_facts.items():
        if mid != manager_id or did not in did_set:
            continue
        if sid_set and sid not in sid_set:
            continue
        total += int(cnt or 0)
    return total


def sum_service_facts_company(
    service_facts: dict[tuple[int, int, int], int],
    *,
    specialist_ids: list[int],
    direction_ids: list[int],
) -> int:
    did_set = {int(d) for d in direction_ids}
    sid_set = {int(s) for s in specialist_ids}
    total = 0
    for (_mid, sid, did), cnt in service_facts.items():
        if did not in did_set:
            continue
        if sid_set and sid not in sid_set:
            continue
        total += int(cnt or 0)
    return total


async def load_plan_item_specialists(
    db: AsyncSession,
    *,
    plan_item_ids: list[int],
) -> dict[int, list[int]]:
    if not plan_item_ids:
        return {}
    rows = (
        await db.execute(
            select(SalesKpiPlanItemSpecialist.plan_item_id, SalesKpiPlanItemSpecialist.specialist_id).where(
                SalesKpiPlanItemSpecialist.plan_item_id.in_(plan_item_ids),
            ),
        )
    ).all()
    out: dict[int, list[int]] = {int(pid): [] for pid in plan_item_ids}
    for plan_item_id, specialist_id in rows:
        out.setdefault(int(plan_item_id), []).append(int(specialist_id))
    return out


async def load_plan_item_services(
    db: AsyncSession,
    *,
    plan_item_ids: list[int],
) -> dict[int, list[int]]:
    if not plan_item_ids:
        return {}
    rows = (
        await db.execute(
            select(SalesKpiPlanItemService.plan_item_id, SalesKpiPlanItemService.direction_id).where(
                SalesKpiPlanItemService.plan_item_id.in_(plan_item_ids),
            ),
        )
    ).all()
    out: dict[int, list[int]] = {int(pid): [] for pid in plan_item_ids}
    for plan_item_id, direction_id in rows:
        out.setdefault(int(plan_item_id), []).append(int(direction_id))
    return out


def manual_sale_counts_in_kpi(service_amount: Decimal, paid_amount: Decimal, status: str) -> bool:
    """Одна продажа, как только накопленная оплата достигла 25%. Дальше доплаты счётчик не растят."""
    if status not in MANUAL_SALE_KPI_STATUSES:
        return False
    sa = Decimal(str(service_amount or 0))
    if sa <= 0:
        return False
    return Decimal(str(paid_amount or 0)) >= (sa * MANUAL_SALE_MIN_PAID_RATIO)


def _as_utc(when: datetime) -> datetime:
    if when.tzinfo is None:
        return when.replace(tzinfo=UTC)
    return when.astimezone(UTC)


def manual_sale_threshold_crossed_at(
    *,
    service_amount: Decimal,
    paid_amount: Decimal,
    sold_at: datetime,
    payments: list[tuple[datetime, Decimal]],
) -> datetime | None:
    """Момент, когда накопленная оплата впервые дошла до 25%. None — порог ещё не взят.

    Платежи без строки журнала стоят на sold_at. Если порог взят платежом раньше продажи, факт ставится в день заведения.
    """
    sa = Decimal(str(service_amount or 0))
    if sa <= 0 or sold_at is None:
        return None
    threshold = sa * MANUAL_SALE_MIN_PAID_RATIO
    events: list[tuple[datetime, Decimal]] = []
    covered = Decimal("0")
    for paid_at, amount in payments:
        amt = Decimal(str(amount or 0))
        if paid_at is None or amt <= 0:
            continue
        events.append((_as_utc(paid_at), amt))
        covered += amt
    gap = Decimal(str(paid_amount or 0)) - covered
    if gap > 0:
        events.append((_as_utc(sold_at), gap))
    events.sort(key=lambda item: item[0])
    opened = _as_utc(sold_at)
    running = Decimal("0")
    crossed: datetime | None = None
    for paid_at, amt in events:
        running += amt
        if running >= threshold:
            crossed = paid_at
            break
    if crossed is None:
        return None
    # Продажи ещё не было — факт встаёт в день заведения, а не в месяц задним числом.
    if crossed < opened:
        return opened
    return crossed


async def load_manual_facts(
    db: AsyncSession,
    *,
    company_id: int,
    pipeline_id: int,
    ym: date,
) -> dict[tuple[int, int], int]:
    """Факт курса/протокола: +1 в месяц, когда оплата впервые дошла до 25%. Доплаты после порога не считаются."""
    sales = (
        await db.execute(
            select(
                SalesKpiManualSale.id,
                SalesKpiManualSale.manager_user_id,
                SalesKpiManualSale.plan_item_id,
                SalesKpiManualSale.service_amount,
                SalesKpiManualSale.paid_amount,
                SalesKpiManualSale.sold_at,
            ).where(
                SalesKpiManualSale.company_id == company_id,
                SalesKpiManualSale.pipeline_id == pipeline_id,
                SalesKpiManualSale.status.in_(tuple(MANUAL_SALE_KPI_STATUSES)),
            ),
        )
    ).all()
    if not sales:
        return {}
    pay_rows = (
        await db.execute(
            select(
                SalesKpiManualSalePayment.sale_id,
                SalesKpiManualSalePayment.paid_at,
                SalesKpiManualSalePayment.amount,
            ).where(SalesKpiManualSalePayment.sale_id.in_([int(row[0]) for row in sales])),
        )
    ).all()
    payments_by_sale: dict[int, list[tuple[datetime, Decimal]]] = {}
    for sale_id, paid_at, amount in pay_rows:
        payments_by_sale.setdefault(int(sale_id), []).append((paid_at, Decimal(str(amount or 0))))

    target = date(ym.year, ym.month, 1)
    out: dict[tuple[int, int], int] = {}
    for sale_id, manager_id, plan_item_id, service_amount, paid_amount, sold_at in sales:
        crossed = manual_sale_threshold_crossed_at(
            service_amount=Decimal(str(service_amount or 0)),
            paid_amount=Decimal(str(paid_amount or 0)),
            sold_at=sold_at,
            payments=payments_by_sale.get(int(sale_id), []),
        )
        if crossed is None:
            continue
        crossed_utc = _as_utc(crossed)
        if date(crossed_utc.year, crossed_utc.month, 1) != target:
            continue
        key = (int(manager_id), int(plan_item_id))
        out[key] = out.get(key, 0) + 1
    return out


def _norm_kpi_label(value: str | None) -> str:
    return " ".join((value or "").strip().casefold().split())


async def load_desk_sale_facts_full_paid(
    db: AsyncSession,
    *,
    company_id: int,
    pipeline_id: int,
    ym: date,
    plan_items: list[SalesKpiPlanItem],
) -> dict[tuple[int, int], int]:
    """
    Полностью оплаченные продажи из окна «Продажи» (crm_mode=sales).
    Сопоставляются с показателем KPI по имени (activity_sphere ≈ plan item / direction name).
    """
    if not plan_items:
        return {}
    start, end = month_bounds(ym)

    name_to_item: dict[str, int] = {}
    direction_ids = [int(i.direction_id) for i in plan_items if i.direction_id is not None]
    dir_names: dict[int, str] = {}
    if direction_ids:
        drows = (
            await db.execute(
                select(BookingDirection.id, BookingDirection.name).where(BookingDirection.id.in_(direction_ids)),
            )
        ).all()
        dir_names = {int(i): str(n or "") for i, n in drows}

    for item in plan_items:
        pid = int(item.id)
        for label in (item.name, dir_names.get(int(item.direction_id)) if item.direction_id else None):
            key = _norm_kpi_label(label)
            if key and key not in name_to_item:
                name_to_item[key] = pid

    # Если в плане один показатель — все полные оплаты desk идут в него (типичный sales setup).
    sole_item_id = int(plan_items[0].id) if len(plan_items) == 1 else None

    rows = (
        await db.execute(
            select(
                ManagerDeskSale.manager_user_id,
                ManagerDeskSale.activity_sphere,
                ManagerDeskSale.service_amount,
                ManagerDeskSale.paid_amount,
            ).where(
                ManagerDeskSale.company_id == company_id,
                ManagerDeskSale.status == "active",
                ManagerDeskSale.sold_at >= start,
                ManagerDeskSale.sold_at < end,
                ManagerDeskSale.service_amount > 0,
                ManagerDeskSale.paid_amount >= ManagerDeskSale.service_amount,
                or_(
                    ManagerDeskSale.pipeline_id == pipeline_id,
                    ManagerDeskSale.pipeline_id.is_(None),
                ),
            ),
        )
    ).all()

    out: dict[tuple[int, int], int] = {}
    for manager_id, sphere, service_amount, paid_amount in rows:
        if manager_id is None:
            continue
        sa = Decimal(str(service_amount or 0))
        pa = Decimal(str(paid_amount or 0))
        if sa <= 0 or pa < sa:
            continue
        plan_item_id = name_to_item.get(_norm_kpi_label(sphere))
        if plan_item_id is None:
            plan_item_id = sole_item_id
        if plan_item_id is None:
            continue
        key = (int(manager_id), int(plan_item_id))
        out[key] = out.get(key, 0) + 1
    return out


def merge_fact_maps(
    *maps: dict[tuple[int, int], int],
) -> dict[tuple[int, int], int]:
    out: dict[tuple[int, int], int] = {}
    for m in maps:
        for k, v in m.items():
            out[k] = out.get(k, 0) + int(v or 0)
    return out


def build_manager_lines(
    *,
    manager_id: int,
    manager_name: str,
    items: list[SalesKpiPlanItem],
    direction_facts: dict[tuple[int, int], int],
    specialist_facts: dict[tuple[int, int, Decimal], int],
    item_specialists: dict[int, list[int]],
    manual_facts: dict[tuple[int, int], int],
    bonus_fund: Decimal,
    desk_facts: dict[tuple[int, int], int] | None = None,
    unit_price_by_label: dict[str, Decimal] | None = None,
    item_direction_ids: dict[int, list[int]] | None = None,
    service_facts: dict[tuple[int, int, int], int] | None = None,
) -> dict:
    lines = []
    total_contrib = Decimal("0")
    desk = desk_facts or {}
    prices = unit_price_by_label or {}
    services_by_item = item_direction_ids or {}
    svc_facts = service_facts or {}
    for item in items:
        specialist_ids = item_specialists.get(int(item.id), [])
        chosen_services = services_by_item.get(int(item.id), [])
        if item.source_type == "direction" and chosen_services:
            fact = sum_service_facts_for_manager(
                svc_facts,
                manager_id=manager_id,
                specialist_ids=specialist_ids,
                direction_ids=chosen_services,
            )
        elif item.source_type == "direction":
            if specialist_ids:
                unit_price = prices.get(_norm_kpi_label(item.name))
                fact = sum_specialist_facts_for_manager(
                    specialist_facts,
                    manager_id=manager_id,
                    specialist_ids=specialist_ids,
                    unit_price=unit_price,
                )
            elif item.direction_id is not None:
                fact = direction_facts.get((manager_id, int(item.direction_id)), 0)
            else:
                fact = 0
        else:
            fact = manual_facts.get((manager_id, int(item.id)), 0)
        # Полные оплаты из окна «Продажи» (sales) — в факт показателя по имени.
        fact += desk.get((manager_id, int(item.id)), 0)
        plan_qty = int(item.plan_qty or 0)
        weight = Decimal(str(item.weight_percent or 0))
        comp = completion_ratio(fact, plan_qty)
        contrib = contribution(comp, weight)
        total_contrib += contrib
        lines.append(
            {
                "plan_item_id": int(item.id),
                "name": item.name,
                "source_type": item.source_type,
                "direction_id": int(item.direction_id) if item.direction_id is not None else None,
                "specialist_ids": list(specialist_ids),
                "plan_qty": plan_qty,
                "weight_percent": weight,
                "fact_qty": fact,
                "completion": float(comp) if comp is not None else None,
                "contribution": contrib,
            },
        )
    return {
        "manager_id": manager_id,
        "manager_name": manager_name,
        "lines": lines,
        "total_contribution": total_contrib,
        "bonus": bonus_amount(total_contrib, bonus_fund),
        "bonus_fund": bonus_fund,
    }
