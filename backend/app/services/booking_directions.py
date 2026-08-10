"""Booking directions: case-insensitive names, safe archive names, duplicate merge."""

from __future__ import annotations

import logging
import re

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import (
    BookingAppointment,
    BookingDirection,
    BookingSpecialist,
    PatientServiceEnrollment,
    SalesKpiPlanItem,
    SalesKpiServicePlan,
    SalesKpiServicePrice,
    ServiceTemplate,
)

logger = logging.getLogger("crm.booking_directions")

_ARCHIVE_SUFFIX_RE = re.compile(r"\s*\[архив #\d+\]\s*$", re.IGNORECASE)


def normalize_direction_name(name: str) -> str:
    return " ".join((name or "").strip().split())


def direction_base_name(name: str) -> str:
    return normalize_direction_name(_ARCHIVE_SUFFIX_RE.sub("", name or ""))


def direction_name_key(name: str) -> str:
    return direction_base_name(name).casefold()


def archived_direction_name(name: str, direction_id: int) -> str:
    base = direction_base_name(name) or "направление"
    suffix = f" [архив #{direction_id}]"
    full = f"{base}{suffix}"
    if len(full) <= 255:
        return full
    return f"{base[: max(1, 255 - len(suffix))]}{suffix}"


async def find_direction_name_conflict(
    db: AsyncSession,
    *,
    company_id: int,
    name: str,
    exclude_id: int | None = None,
) -> BookingDirection | None:
    key = direction_name_key(name)
    if not key:
        return None
    rows = (
        await db.execute(
            select(BookingDirection).where(
                (BookingDirection.company_id == company_id) | (BookingDirection.company_id.is_(None))
            )
        )
    ).scalars().all()
    for row in rows:
        if exclude_id is not None and row.id == exclude_id:
            continue
        if direction_name_key(row.name) == key:
            return row
    return None


async def _repoint_direction_fks(db: AsyncSession, *, donor_id: int, keeper_id: int) -> None:
    if donor_id == keeper_id:
        return

    await db.execute(
        update(BookingSpecialist)
        .where(BookingSpecialist.direction_id == donor_id)
        .values(direction_id=keeper_id)
    )
    await db.execute(
        update(BookingAppointment)
        .where(BookingAppointment.direction_id == donor_id)
        .values(direction_id=keeper_id)
    )
    await db.execute(
        update(ServiceTemplate)
        .where(ServiceTemplate.direction_id == donor_id)
        .values(direction_id=keeper_id)
    )
    await db.execute(
        update(PatientServiceEnrollment)
        .where(PatientServiceEnrollment.direction_id == donor_id)
        .values(direction_id=keeper_id)
    )
    await db.execute(
        update(SalesKpiPlanItem)
        .where(SalesKpiPlanItem.direction_id == donor_id)
        .values(direction_id=keeper_id)
    )

    # Unique-scoped KPI rows: drop donor duplicates, then move the rest.
    # Best-effort: KPI tables may be absent/partial on older DBs.
    try:
        keeper_price_keys = {
            (r.pipeline_id, r.year_month)
            for r in (
                await db.execute(select(SalesKpiServicePrice).where(SalesKpiServicePrice.direction_id == keeper_id))
            ).scalars().all()
        }
        donor_prices = (
            await db.execute(select(SalesKpiServicePrice).where(SalesKpiServicePrice.direction_id == donor_id))
        ).scalars().all()
        for row in donor_prices:
            key = (row.pipeline_id, row.year_month)
            if key in keeper_price_keys:
                await db.delete(row)
            else:
                row.direction_id = keeper_id
                keeper_price_keys.add(key)

        keeper_plan_keys = {
            (r.pipeline_id, r.year_month, r.manager_user_id)
            for r in (
                await db.execute(select(SalesKpiServicePlan).where(SalesKpiServicePlan.direction_id == keeper_id))
            ).scalars().all()
        }
        donor_plans = (
            await db.execute(select(SalesKpiServicePlan).where(SalesKpiServicePlan.direction_id == donor_id))
        ).scalars().all()
        for row in donor_plans:
            key = (row.pipeline_id, row.year_month, row.manager_user_id)
            if key in keeper_plan_keys:
                await db.delete(row)
            else:
                row.direction_id = keeper_id
                keeper_plan_keys.add(key)
    except Exception:  # noqa: BLE001
        logger.exception("KPI direction repoint skipped donor=%s keeper=%s", donor_id, keeper_id)


async def archive_direction_row(db: AsyncSession, direction: BookingDirection) -> None:
    direction.name = archived_direction_name(direction.name, int(direction.id))
    direction.is_active = False
    await db.flush()


async def absorb_direction(
    db: AsyncSession,
    *,
    donor: BookingDirection,
    keeper: BookingDirection,
    keeper_name: str | None = None,
) -> BookingDirection:
    """Move specialists/appointments from donor into keeper, then archive donor.

    Archives the donor first so the global unique ``name`` slot is freed before
    renaming the keeper (avoids IntegrityError on flush).
    """
    if donor.id == keeper.id:
        if keeper_name is not None:
            keeper.name = normalize_direction_name(keeper_name) or keeper.name
            keeper.is_active = True
        return keeper
    await _repoint_direction_fks(db, donor_id=int(donor.id), keeper_id=int(keeper.id))
    await archive_direction_row(db, donor)
    await db.flush()
    if keeper_name is not None:
        keeper.name = normalize_direction_name(keeper_name) or direction_base_name(keeper.name) or keeper.name
    keeper.is_active = True
    await db.flush()
    logger.info(
        "absorbed booking direction donor=%s into keeper=%s company_id=%s",
        donor.id,
        keeper.id,
        keeper.company_id,
    )
    return keeper


def prefer_direction_keeper(candidates: list[BookingDirection]) -> BookingDirection:
    """Prefer active, then oldest id (canonical seed rows)."""
    return sorted(candidates, key=lambda d: (0 if d.is_active else 1, d.id))[0]


async def consolidate_duplicate_directions(db: AsyncSession, company_id: int) -> int:
    """Merge case-insensitive duplicate direction names within a company. Returns merges count."""
    rows = (
        await db.execute(select(BookingDirection).where(BookingDirection.company_id == company_id))
    ).scalars().all()
    groups: dict[str, list[BookingDirection]] = {}
    for row in rows:
        key = direction_name_key(row.name)
        if not key:
            continue
        groups.setdefault(key, []).append(row)

    merges = 0
    for group in groups.values():
        if len(group) < 2:
            continue
        keeper = prefer_direction_keeper(group)
        # Canonical display name without archive suffix when keeper stays/becomes active.
        if keeper.is_active:
            base = direction_base_name(keeper.name)
            if base and keeper.name != base:
                conflict = next(
                    (
                        g
                        for g in group
                        if g.id != keeper.id and normalize_direction_name(g.name) == base
                    ),
                    None,
                )
                if conflict is None:
                    keeper.name = base
        desired_name = direction_base_name(keeper.name) or keeper.name
        for donor in group:
            if donor.id == keeper.id:
                continue
            await absorb_direction(db, donor=donor, keeper=keeper, keeper_name=desired_name)
            merges += 1
        if not keeper.is_active:
            # If everything was archived, restore the keeper so specialists stay bookable.
            keeper.is_active = True
            keeper.name = desired_name
    if merges:
        await db.flush()
    return merges
