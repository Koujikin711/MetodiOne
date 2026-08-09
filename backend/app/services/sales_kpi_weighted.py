"""Взвешенный KPI продаж: общий план, факт из записи (100%) и курсов (≥25%), возвраты."""

from __future__ import annotations

from datetime import UTC, date, datetime
from decimal import Decimal

from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import (
    BookingAppointment,
    Lead,
    PipelineStage,
    SalesKpiManualSale,
    SalesKpiPlanItem,
    SalesKpiPlanItemSpecialist,
    SalesKpiWeightedSettings,
    User,
    UserPipelineAssignment,
    UserRole,
)

MANUAL_SALE_MIN_PAID_RATIO = Decimal("0.25")
DEFAULT_BONUS_FUND = Decimal("10000")


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


def manager_expr():
    return func.coalesce(BookingAppointment.responsible_manager_id, Lead.manager_id)


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
    """Факт по направлениям записи: только 100% оплата (fallback, если эксперты не привязаны)."""
    start, end = month_bounds(ym)
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
            .where(
                BookingAppointment.company_id == company_id,
                BookingAppointment.start_at >= start,
                BookingAppointment.start_at < end,
                BookingAppointment.service_amount > 0,
                BookingAppointment.paid_amount >= BookingAppointment.service_amount,
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
) -> dict[tuple[int, int], int]:
    """Факт по экспертам онлайн-записи: (manager_id, specialist_id) → шт при 100% оплате."""
    start, end = month_bounds(ym)
    rows = (
        await db.execute(
            select(
                manager_expr(),
                BookingAppointment.specialist_id,
                func.count(BookingAppointment.id),
            )
            .select_from(BookingAppointment)
            .join(Lead, Lead.id == BookingAppointment.lead_id, isouter=True)
            .join(PipelineStage, PipelineStage.id == Lead.status_id, isouter=True)
            .where(
                BookingAppointment.company_id == company_id,
                BookingAppointment.start_at >= start,
                BookingAppointment.start_at < end,
                BookingAppointment.service_amount > 0,
                BookingAppointment.paid_amount >= BookingAppointment.service_amount,
                or_(
                    BookingAppointment.pipeline_id == pipeline_id,
                    PipelineStage.pipeline_id == pipeline_id,
                ),
            )
            .group_by(manager_expr(), BookingAppointment.specialist_id),
        )
    ).all()
    out: dict[tuple[int, int], int] = {}
    for manager_id, specialist_id, cnt in rows:
        if manager_id is None or specialist_id is None:
            continue
        out[(int(manager_id), int(specialist_id))] = int(cnt or 0)
    return out


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


async def load_manual_facts(
    db: AsyncSession,
    *,
    company_id: int,
    pipeline_id: int,
    ym: date,
) -> dict[tuple[int, int], int]:
    """Факт по курсам/протоколам: ≥25% оплаты, не возврат."""
    start, end = month_bounds(ym)
    rows = (
        await db.execute(
            select(
                SalesKpiManualSale.manager_user_id,
                SalesKpiManualSale.plan_item_id,
                SalesKpiManualSale.service_amount,
                SalesKpiManualSale.paid_amount,
            ).where(
                SalesKpiManualSale.company_id == company_id,
                SalesKpiManualSale.pipeline_id == pipeline_id,
                SalesKpiManualSale.sold_at >= start,
                SalesKpiManualSale.sold_at < end,
                SalesKpiManualSale.status == "active",
            ),
        )
    ).all()
    out: dict[tuple[int, int], int] = {}
    for manager_id, plan_item_id, service_amount, paid_amount in rows:
        sa = Decimal(str(service_amount or 0))
        pa = Decimal(str(paid_amount or 0))
        if sa <= 0:
            continue
        if pa < (sa * MANUAL_SALE_MIN_PAID_RATIO):
            continue
        key = (int(manager_id), int(plan_item_id))
        out[key] = out.get(key, 0) + 1
    return out


def build_manager_lines(
    *,
    manager_id: int,
    manager_name: str,
    items: list[SalesKpiPlanItem],
    direction_facts: dict[tuple[int, int], int],
    specialist_facts: dict[tuple[int, int], int],
    item_specialists: dict[int, list[int]],
    manual_facts: dict[tuple[int, int], int],
    bonus_fund: Decimal,
) -> dict:
    lines = []
    total_contrib = Decimal("0")
    for item in items:
        specialist_ids = item_specialists.get(int(item.id), [])
        if item.source_type == "direction":
            if specialist_ids:
                fact = sum(specialist_facts.get((manager_id, sid), 0) for sid in specialist_ids)
            elif item.direction_id is not None:
                fact = direction_facts.get((manager_id, int(item.direction_id)), 0)
            else:
                fact = 0
        else:
            fact = manual_facts.get((manager_id, int(item.id)), 0)
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
