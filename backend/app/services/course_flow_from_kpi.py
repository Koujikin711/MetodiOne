"""Продажа «Курс» с номером потока сажает пациента в журнал куратора.

Поток N в KPI — это group_no. Протокол сюда не попадает.
Карточка пациента не создаётся и не склеивается по телефону.
"""

from __future__ import annotations

from datetime import UTC, date, datetime, timedelta
from zoneinfo import ZoneInfo

from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.models import SalesKpiManualSale, SalesKpiPlanItem
from app.models.curator_journal import (
    CuratorCourseFlow,
    CuratorFlowMembership,
    CuratorJournalComplaint,
    CuratorJournalEntry,
)
from app.services.course_program_period import COURSE_DURATION_DAYS
from app.services.patient_ltv import classify_product_kind
from app.services.phone_match import phones_equivalent

_CLOSED = ("returned", "refused", "cancelled")


def sale_local_day(sold_at: datetime | None) -> date:
    if sold_at is None:
        return datetime.now(UTC).date()
    if sold_at.tzinfo is None:
        sold_at = sold_at.replace(tzinfo=UTC)
    try:
        tz = ZoneInfo(settings.booking_timezone or "Asia/Dushanbe")
    except Exception:
        tz = ZoneInfo("Asia/Dushanbe")
    return sold_at.astimezone(tz).date()


def new_flow_period(start: date) -> tuple[date, date]:
    return start, start + timedelta(days=COURSE_DURATION_DAYS)


def _pick_flow(flows: list[CuratorCourseFlow], number: int) -> CuratorCourseFlow | None:
    active = [flow for flow in flows if (flow.status or "") != "archived"]
    exact = [flow for flow in active if int(flow.flow_number) == number]
    if exact:
        return exact[0]
    linked = [
        flow
        for flow in active
        if flow.kpi_group_no is not None and int(flow.kpi_group_no) == number
    ]
    return linked[0] if linked else None


def _sole_curator_id(flows: list[CuratorCourseFlow]) -> int | None:
    ids = {
        int(flow.curator_user_id)
        for flow in flows
        if (flow.status or "") != "archived" and flow.curator_user_id is not None
    }
    if len(ids) == 1:
        return next(iter(ids))
    return None


def _already_in_flow(members: list[CuratorFlowMembership], sale: SalesKpiManualSale) -> CuratorFlowMembership | None:
    for member in members:
        if member.left_on is not None:
            continue
        if member.kpi_sale_id is not None and int(member.kpi_sale_id) == int(sale.id):
            return member
        if sale.lead_id is not None and member.lead_id is not None and int(member.lead_id) == int(sale.lead_id):
            return member
        if sale.client_phone and member.phone and phones_equivalent(sale.client_phone, member.phone):
            return member
    return None


# Потоки, которые сбор старых продаж создал 30.09.2026. Живые №6–№8 не входят.
_BACKFILL_FLOW_NUMBERS = (1, 3, 5)
_BACKFILL_PATCH = "drop_kpi_backfill_flows_1_3_5_v1"


async def drop_backfilled_course_flows(db: AsyncSession, *, company_id: int) -> int:
    """Один раз убирает потоки №1, №3 и №5, собранные из прошлых продаж."""
    from sqlalchemy import text

    await db.execute(
        text(
            """CREATE TABLE IF NOT EXISTS app_data_patches (
                name TEXT PRIMARY KEY,
                applied_at TEXT
            )"""
        ),
    )
    seen = await db.execute(
        text("SELECT 1 FROM app_data_patches WHERE name = :n LIMIT 1"),
        {"n": _BACKFILL_PATCH},
    )
    if seen.first() is not None:
        return 0
    flows = list(
        (
            await db.execute(
                select(CuratorCourseFlow).where(
                    CuratorCourseFlow.company_id == company_id,
                    CuratorCourseFlow.flow_number.in_(_BACKFILL_FLOW_NUMBERS),
                    CuratorCourseFlow.status == "active",
                ),
            )
        ).scalars().all(),
    )
    ids = [int(flow.id) for flow in flows if flow.kpi_group_no == flow.flow_number]
    if ids:
        entry_ids = select(CuratorJournalEntry.id).where(CuratorJournalEntry.flow_id.in_(ids))
        await db.execute(
            delete(CuratorJournalComplaint).where(
                CuratorJournalComplaint.journal_entry_id.in_(entry_ids),
            ),
        )
        await db.execute(delete(CuratorJournalEntry).where(CuratorJournalEntry.flow_id.in_(ids)))
        await db.execute(delete(CuratorFlowMembership).where(CuratorFlowMembership.flow_id.in_(ids)))
        await db.execute(delete(CuratorCourseFlow).where(CuratorCourseFlow.id.in_(ids)))
    await db.execute(
        text("INSERT INTO app_data_patches (name, applied_at) VALUES (:n, :at)"),
        {"n": _BACKFILL_PATCH, "at": datetime.now(UTC).isoformat()},
    )
    await db.flush()
    return len(ids)


async def sync_course_flows_from_kpi(
    db: AsyncSession,
    *,
    company_id: int,
    sale_id: int | None = None,
) -> int:
    """Только эта продажа курса. Прошлые продажи потоки не создают."""
    if sale_id is None:
        return 0
    sale_rows = (
        await db.execute(
            select(SalesKpiManualSale, SalesKpiPlanItem.name)
            .join(SalesKpiPlanItem, SalesKpiPlanItem.id == SalesKpiManualSale.plan_item_id)
            .where(
                SalesKpiManualSale.company_id == company_id,
                SalesKpiManualSale.id == sale_id,
                SalesKpiManualSale.status.notin_(_CLOSED),
            ),
        )
    ).all()
    grouped: dict[int, list[SalesKpiManualSale]] = {}
    for sale, item_name in sale_rows:
        if classify_product_kind(item_name) != "main_course":
            continue
        if sale.group_no is None or int(sale.group_no) < 1:
            continue
        grouped.setdefault(int(sale.group_no), []).append(sale)
    if not grouped:
        return 0

    flows = list(
        (
            await db.execute(
                select(CuratorCourseFlow).where(CuratorCourseFlow.company_id == company_id),
            )
        ).scalars().all(),
    )
    members = list(
        (
            await db.execute(
                select(CuratorFlowMembership).where(
                    CuratorFlowMembership.company_id == company_id,
                    CuratorFlowMembership.left_on.is_(None),
                ),
            )
        ).scalars().all(),
    )
    by_flow: dict[int, list[CuratorFlowMembership]] = {}
    for member in members:
        by_flow.setdefault(int(member.flow_id), []).append(member)

    curator_id = _sole_curator_id(flows)
    changed = 0
    for number, sales in grouped.items():
        sales.sort(key=lambda sale: sale.sold_at or datetime.min.replace(tzinfo=UTC))
        flow = _pick_flow(flows, number)
        if flow is None:
            start, end = new_flow_period(sale_local_day(sales[0].sold_at))
            flow = CuratorCourseFlow(
                company_id=company_id,
                pipeline_id=int(sales[0].pipeline_id) if sales[0].pipeline_id is not None else None,
                course_name="Основной курс",
                flow_number=number,
                starts_on=start,
                ends_on=end,
                curator_user_id=curator_id,
                kpi_group_no=number,
                status="active",
            )
            db.add(flow)
            await db.flush()
            flows.append(flow)
            by_flow[int(flow.id)] = []
            changed += 1
        bucket = by_flow.setdefault(int(flow.id), [])
        for sale in sales:
            existing = _already_in_flow(bucket, sale)
            if existing is not None:
                if sale.lead_id is not None and existing.lead_id is None:
                    existing.lead_id = int(sale.lead_id)
                    changed += 1
                if existing.kpi_sale_id is None:
                    existing.kpi_sale_id = int(sale.id)
                    changed += 1
                continue
            joined = sale_local_day(sale.sold_at)
            if joined < flow.starts_on or joined > flow.ends_on:
                joined = flow.starts_on
            member = CuratorFlowMembership(
                company_id=company_id,
                flow_id=int(flow.id),
                lead_id=int(sale.lead_id) if sale.lead_id is not None else None,
                display_name=(sale.client_name or "").strip() or "Пациент",
                phone=(sale.client_phone or "").strip() or None,
                joined_on=joined,
                left_on=None,
                source="kpi",
                kpi_sale_id=int(sale.id),
            )
            db.add(member)
            bucket.append(member)
            changed += 1
    if changed:
        await db.flush()
    return changed
