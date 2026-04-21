from __future__ import annotations

from datetime import UTC, datetime
from pathlib import Path

from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.core.deps import get_current_company_id, get_current_user
from app.database import get_db
from app.models import Base, BookingAppointment, Company, Lead, Pipeline, PipelineStage, User, UserRole
from app.routers import analytics


def _make_app(session_maker: async_sessionmaker[AsyncSession], company_id: int, role: UserRole = UserRole.owner) -> FastAPI:
    app = FastAPI()
    app.include_router(analytics.router, prefix="/api")

    async def _override_db():
        async with session_maker() as session:
            yield session

    async def _override_user():
        return User(
            id=999,
            email="owner@test.local",
            hashed_password="x",
            role=role,
            company_id=company_id,
            is_active=True,
        )

    async def _override_company_id():
        return company_id

    app.dependency_overrides[get_db] = _override_db
    app.dependency_overrides[get_current_user] = _override_user
    app.dependency_overrides[get_current_company_id] = _override_company_id
    return app


async def _seed_data(session_maker: async_sessionmaker[AsyncSession]) -> dict[str, int]:
    now = datetime.now(UTC)
    async with session_maker() as session:
        c1 = Company(name="C1", is_active=True)
        c2 = Company(name="C2", is_active=True)
        session.add_all([c1, c2])
        await session.flush()

        owner1 = User(email="owner1@test.local", hashed_password="x", role=UserRole.owner, company_id=c1.id, is_active=True)
        owner2 = User(email="owner2@test.local", hashed_password="x", role=UserRole.owner, company_id=c2.id, is_active=True)
        manager1 = User(
            email="manager1@test.local",
            hashed_password="x",
            role=UserRole.manager,
            company_id=c1.id,
            full_name="Manager One",
            is_active=True,
        )
        session.add_all([owner1, owner2, manager1])
        await session.flush()

        p1 = Pipeline(name="Pipeline C1", type="sales", company_id=c1.id)
        p2 = Pipeline(name="Pipeline C2", type="sales", company_id=c2.id)
        session.add_all([p1, p2])
        await session.flush()

        s1 = PipelineStage(name="New C1", order=1, color="#111111", pipeline_id=p1.id, company_id=c1.id)
        s2 = PipelineStage(name="New C2", order=1, color="#222222", pipeline_id=p2.id, company_id=c2.id)
        session.add_all([s1, s2])
        await session.flush()

        # Компания 1: два лида, один менеджерский и один без менеджера.
        lead_c1_a = Lead(
            company_id=c1.id,
            name="Lead C1 A",
            phone="+70000000001",
            email=None,
            source="test",
            status_id=s1.id,
            manager_id=manager1.id,
            created_at=now,
        )
        lead_c1_b = Lead(
            company_id=c1.id,
            name="Lead C1 B",
            phone="+70000000002",
            email=None,
            source="test",
            status_id=s1.id,
            manager_id=None,
            created_at=now,
        )
        # Компания 2: лид с большими суммами, который не должен попасть в аналитику компании 1.
        lead_c2 = Lead(
            company_id=c2.id,
            name="Lead C2",
            phone="+79999999999",
            email=None,
            source="test",
            status_id=s2.id,
            manager_id=None,
            created_at=now,
        )
        session.add_all([lead_c1_a, lead_c1_b, lead_c2])
        await session.flush()

        # Две записи на один лид в C1 (проверка anti-dup: лид не должен считаться дважды).
        app1 = BookingAppointment(
            company_id=c1.id,
            lead_id=lead_c1_a.id,
            pipeline_id=p1.id,
            patient_name="P1",
            patient_phone="+70000000001",
            direction_id=1,
            specialist_id=1,
            start_at=now,
            end_at=now,
            status="booked",
            service_amount=100,
            paid_amount=60,
            responsible_manager_id=manager1.id,
            created_by_user_id=owner1.id,
            comment=None,
        )
        app2 = BookingAppointment(
            company_id=c1.id,
            lead_id=lead_c1_a.id,
            pipeline_id=p1.id,
            patient_name="P1",
            patient_phone="+70000000001",
            direction_id=1,
            specialist_id=1,
            start_at=now,
            end_at=now,
            status="booked",
            service_amount=50,
            paid_amount=20,
            responsible_manager_id=manager1.id,
            created_by_user_id=owner1.id,
            comment=None,
        )
        # Сторонние данные C2.
        app3 = BookingAppointment(
            company_id=c2.id,
            lead_id=lead_c2.id,
            pipeline_id=p2.id,
            patient_name="P2",
            patient_phone="+79999999999",
            direction_id=1,
            specialist_id=1,
            start_at=now,
            end_at=now,
            status="booked",
            service_amount=1000,
            paid_amount=1000,
            responsible_manager_id=None,
            created_by_user_id=owner2.id,
            comment=None,
        )
        session.add_all([app1, app2, app3])
        await session.commit()

        return {
            "c1_id": int(c1.id),
            "lead_c1_a_id": int(lead_c1_a.id),
            "lead_c2_id": int(lead_c2.id),
        }


def test_analytics_full_isolation_and_distinct_counts(tmp_path: Path):
    db_path = tmp_path / "analytics_full.sqlite3"
    engine = create_async_engine(f"sqlite+aiosqlite:///{db_path}")
    session_maker = async_sessionmaker(engine, expire_on_commit=False, class_=AsyncSession)
    try:
        import asyncio

        async def _setup():
            async with engine.begin() as conn:
                await conn.run_sync(Base.metadata.create_all)
            return await _seed_data(session_maker)

        seeded = asyncio.run(_setup())
        app = _make_app(session_maker, seeded["c1_id"])
        client = TestClient(app)

        r = client.get("/api/analytics/full?period=day")
        assert r.status_code == 200, r.text
        body = r.json()

        assert body["total_leads"] == 2
        assert float(body["total_received_amount"]) == 80.0
        assert float(body["total_debt_amount"]) == 70.0

        # В C1 только одна воронка и два лида в ней, при этом "обработано менеджером" = 1 (distinct по lead).
        assert len(body["by_pipeline"]) == 1
        p = body["by_pipeline"][0]
        assert p["pipeline_name"] == "Pipeline C1"
        assert p["leads_count"] == 2
        assert p["processed_by_manager_count"] == 1
        assert float(p["received_amount"]) == 80.0
        assert float(p["debt_amount"]) == 70.0
    finally:
        import asyncio

        asyncio.run(engine.dispose())


def test_analytics_detailed_and_customer_value_company_scoped(tmp_path: Path):
    db_path = tmp_path / "analytics_detailed.sqlite3"
    engine = create_async_engine(f"sqlite+aiosqlite:///{db_path}")
    session_maker = async_sessionmaker(engine, expire_on_commit=False, class_=AsyncSession)
    try:
        import asyncio

        async def _setup():
            async with engine.begin() as conn:
                await conn.run_sync(Base.metadata.create_all)
            return await _seed_data(session_maker)

        seeded = asyncio.run(_setup())
        app = _make_app(session_maker, seeded["c1_id"])
        client = TestClient(app)

        rd = client.get("/api/analytics/detailed?period=day")
        assert rd.status_code == 200, rd.text
        d = rd.json()
        assert d["total_leads"] == 2
        assert float(d["total_sold_amount"]) == 150.0
        assert float(d["total_unpaid_amount"]) == 70.0

        # Должен быть минимум менеджерский ряд с 1 лидом (не 2), несмотря на две записи.
        mgr_rows = [x for x in d["by_manager"] if x["manager_name"] == "Manager One"]
        assert len(mgr_rows) == 1
        assert mgr_rows[0]["leads_count"] == 1
        assert float(mgr_rows[0]["sold_amount"]) == 150.0
        assert float(mgr_rows[0]["unpaid_amount"]) == 70.0

        # customer_value по лиду из другой компании должен быть 0 в текущем контексте компании.
        rv = client.get(f"/api/analytics/customer-value/{seeded['lead_c2_id']}")
        assert rv.status_code == 200, rv.text
        v = rv.json()
        assert v["customer_id"] == seeded["lead_c2_id"]
        assert float(v["value"]) == 0.0
    finally:
        import asyncio

        asyncio.run(engine.dispose())
