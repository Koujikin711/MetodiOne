"""Владелец переименовывает услугу в выбранном месяце. Прошлый месяц остаётся."""

from __future__ import annotations

import asyncio
from datetime import date
from decimal import Decimal
from pathlib import Path
from types import SimpleNamespace

import pytest
from fastapi import HTTPException
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.models import (
    Base,
    BookingDirection,
    BookingSpecialist,
    Company,
    Pipeline,
    SalesKpiPlanItem,
    SalesKpiPlanItemService,
    SalesKpiPlanItemSpecialist,
)
from app.routers.sales_kpi_board import apply_service_rate_edits


def test_rename_changes_only_the_open_month(tmp_path: Path):
    db_path = tmp_path / "rates.sqlite3"
    engine = create_async_engine(f"sqlite+aiosqlite:///{db_path}")
    session_maker = async_sessionmaker(engine, expire_on_commit=False, class_=AsyncSession)

    async def _run() -> None:
        async with engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)
        async with session_maker() as session:
            company = Company(name="Clinic", is_active=True, crm_mode="clinic")
            session.add(company)
            await session.flush()
            pipe = Pipeline(name="Медицина", type="sales", company_id=company.id)
            session.add(pipe)
            await session.flush()
            osteo = BookingDirection(name="Остеопат", company_id=company.id, pipeline_id=pipe.id)
            consult = BookingDirection(name="Консультация", company_id=company.id, pipeline_id=pipe.id)
            session.add_all([osteo, consult])
            await session.flush()
            doctor = BookingSpecialist(full_name="Врач", company_id=company.id, direction_id=osteo.id)
            session.add(doctor)
            await session.flush()
            september = SalesKpiPlanItem(
                company_id=company.id,
                pipeline_id=pipe.id,
                year_month=date(2026, 9, 1),
                name="Остеопат",
                manager_percent=Decimal("4"),
                source_type="direction",
                direction_id=osteo.id,
                sort_order=1,
            )
            october = SalesKpiPlanItem(
                company_id=company.id,
                pipeline_id=pipe.id,
                year_month=date(2026, 10, 1),
                name="Остеопат",
                manager_percent=Decimal("4"),
                source_type="direction",
                direction_id=osteo.id,
                sort_order=1,
            )
            course = SalesKpiPlanItem(
                company_id=company.id,
                pipeline_id=pipe.id,
                year_month=date(2026, 10, 1),
                name="Курс 15",
                manager_percent=Decimal("10"),
                source_type="manual",
                sort_order=0,
            )
            session.add_all([september, october, course])
            await session.flush()
            session.add(SalesKpiPlanItemSpecialist(plan_item_id=october.id, specialist_id=doctor.id))
            session.add(SalesKpiPlanItemService(plan_item_id=october.id, direction_id=osteo.id))
            await session.commit()

            await apply_service_rate_edits(
                session,
                company_id=company.id,
                pipeline_id=pipe.id,
                year_month="2026-10",
                items=[
                    SimpleNamespace(service_key=f"p:{october.id}", manager_percent=Decimal("4"), name="Консультация"),
                    SimpleNamespace(service_key=f"p:{course.id}", manager_percent=Decimal("10"), name="Курс 15"),
                ],
            )
            await session.commit()

            rows = (
                await session.execute(select(SalesKpiPlanItem).order_by(SalesKpiPlanItem.id))
            ).scalars().all()
            by_id = {int(row.id): row for row in rows}
            assert by_id[september.id].name == "Остеопат"
            assert int(by_id[september.id].direction_id) == osteo.id
            assert by_id[october.id].name == "Консультация"
            assert int(by_id[october.id].direction_id) == consult.id
            assert Decimal(str(by_id[october.id].manager_percent)) == Decimal("4.00")
            assert by_id[course.id].name == "Курс 15"
            specs = await session.scalar(select(func.count()).select_from(SalesKpiPlanItemSpecialist))
            links = await session.scalar(select(func.count()).select_from(SalesKpiPlanItemService))
            assert int(specs or 0) == 0
            assert int(links or 0) == 0

            with pytest.raises(HTTPException):
                await apply_service_rate_edits(
                    session,
                    company_id=company.id,
                    pipeline_id=pipe.id,
                    year_month="2026-10",
                    items=[
                        SimpleNamespace(
                            service_key=f"p:{october.id}",
                            manager_percent=Decimal("4"),
                            name="Курс 15",
                        ),
                    ],
                )
        await engine.dispose()

    asyncio.run(_run())
