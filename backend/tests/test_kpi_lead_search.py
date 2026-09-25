"""Phase 8B: KPI Lead search + explicit lead_id validation (no phone auto-select)."""

from __future__ import annotations

import asyncio
from datetime import UTC, datetime
from pathlib import Path

import pytest
from fastapi import HTTPException
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.models import Base, Company, Lead, LeadExtraPhone, Pipeline, PipelineStage, User, UserRole
from app.services.kpi_lead_search import resolve_kpi_sale_lead_id, search_leads_for_kpi_sale


async def _seed(session_maker: async_sessionmaker[AsyncSession]) -> dict[str, int]:
    now = datetime.now(UTC)
    async with session_maker() as session:
        c1 = Company(name="C1", is_active=True)
        c2 = Company(name="C2", is_active=True)
        session.add_all([c1, c2])
        await session.flush()

        p1 = Pipeline(name="P1", type="sales", company_id=c1.id)
        p2 = Pipeline(name="P2", type="sales", company_id=c2.id)
        session.add_all([p1, p2])
        await session.flush()

        s1 = PipelineStage(name="New", order=1, color="#111", pipeline_id=p1.id, company_id=c1.id)
        s2 = PipelineStage(name="New", order=1, color="#222", pipeline_id=p2.id, company_id=c2.id)
        session.add_all([s1, s2])
        await session.flush()

        mgr = User(
            email="m@test.local",
            hashed_password="x",
            role=UserRole.manager,
            company_id=c1.id,
            full_name="Manager",
            is_active=True,
        )
        session.add(mgr)
        await session.flush()

        child_a = Lead(
            company_id=c1.id,
            name="Ребёнок Али",
            phone="+992900111222",
            status_id=s1.id,
            manager_id=mgr.id,
            created_at=now,
        )
        child_b = Lead(
            company_id=c1.id,
            name="Ребёнок Бахр",
            phone="+992900111222",
            status_id=s1.id,
            manager_id=mgr.id,
            created_at=now,
        )
        other = Lead(
            company_id=c1.id,
            name="Другой пациент",
            phone="+992933000111",
            status_id=s1.id,
            manager_id=None,
            created_at=now,
        )
        foreign = Lead(
            company_id=c2.id,
            name="Чужой Lead",
            phone="+992900111222",
            status_id=s2.id,
            created_at=now,
        )
        session.add_all([child_a, child_b, other, foreign])
        await session.flush()

        session.add(
            LeadExtraPhone(
                company_id=c1.id,
                lead_id=int(other.id),
                phone="900111222",
                sort_order=0,
            ),
        )
        await session.commit()
        return {
            "c1": int(c1.id),
            "c2": int(c2.id),
            "child_a": int(child_a.id),
            "child_b": int(child_b.id),
            "other": int(other.id),
            "foreign": int(foreign.id),
        }


def test_search_shared_phone_returns_all_siblings_no_autoselect(tmp_path: Path):
    db_path = tmp_path / "kpi_lead_search.sqlite3"
    engine = create_async_engine(f"sqlite+aiosqlite:///{db_path}")
    session_maker = async_sessionmaker(engine, expire_on_commit=False, class_=AsyncSession)
    try:

        async def _run():
            async with engine.begin() as conn:
                await conn.run_sync(Base.metadata.create_all)
            ids = await _seed(session_maker)
            async with session_maker() as db:
                items = await search_leads_for_kpi_sale(
                    db, company_id=ids["c1"], q="900111222", limit=20,
                )
                lead_ids = {x["lead_id"] for x in items}
                assert ids["child_a"] in lead_ids
                assert ids["child_b"] in lead_ids
                assert ids["other"] in lead_ids
                assert ids["foreign"] not in lead_ids
                assert len(lead_ids) >= 2

        asyncio.run(_run())
    finally:
        asyncio.run(engine.dispose())


def test_search_by_name_and_lead_id(tmp_path: Path):
    db_path = tmp_path / "kpi_lead_search_name.sqlite3"
    engine = create_async_engine(f"sqlite+aiosqlite:///{db_path}")
    session_maker = async_sessionmaker(engine, expire_on_commit=False, class_=AsyncSession)
    try:

        async def _run():
            async with engine.begin() as conn:
                await conn.run_sync(Base.metadata.create_all)
            ids = await _seed(session_maker)
            async with session_maker() as db:
                by_name = await search_leads_for_kpi_sale(db, company_id=ids["c1"], q="Бахр")
                assert any(x["lead_id"] == ids["child_b"] for x in by_name)
                by_id = await search_leads_for_kpi_sale(
                    db, company_id=ids["c1"], q=str(ids["child_a"]),
                )
                assert by_id and by_id[0]["lead_id"] == ids["child_a"]

        asyncio.run(_run())
    finally:
        asyncio.run(engine.dispose())


def test_resolve_lead_id_company_isolation(tmp_path: Path):
    db_path = tmp_path / "kpi_lead_resolve.sqlite3"
    engine = create_async_engine(f"sqlite+aiosqlite:///{db_path}")
    session_maker = async_sessionmaker(engine, expire_on_commit=False, class_=AsyncSession)
    try:

        async def _run():
            async with engine.begin() as conn:
                await conn.run_sync(Base.metadata.create_all)
            ids = await _seed(session_maker)
            async with session_maker() as db:
                ok = await resolve_kpi_sale_lead_id(
                    db, company_id=ids["c1"], lead_id=ids["child_a"],
                )
                assert ok == ids["child_a"]
                assert await resolve_kpi_sale_lead_id(db, company_id=ids["c1"], lead_id=None) is None
                with pytest.raises(HTTPException) as ei:
                    await resolve_kpi_sale_lead_id(
                        db, company_id=ids["c1"], lead_id=ids["foreign"],
                    )
                assert ei.value.status_code == 400
                with pytest.raises(HTTPException):
                    await resolve_kpi_sale_lead_id(db, company_id=ids["c1"], lead_id=9_999_999)

        asyncio.run(_run())
    finally:
        asyncio.run(engine.dispose())
