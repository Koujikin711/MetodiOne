from __future__ import annotations

from datetime import UTC, datetime
from decimal import Decimal
from pathlib import Path

from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.core.deps import get_current_company_id, get_current_user
from app.database import get_db
from app.models import (
    Base,
    BookingAppointment,
    BookingDirection,
    BookingSpecialist,
    Company,
    FinanceProduct,
    FinanceStockBalance,
    FinanceStockMovement,
    FinanceWarehouse,
    HorecaMenuItem,
    HorecaTechCardLine,
    Task,
    TaskStatus,
    User,
    UserRole,
)
from app.routers import horeca


def _make_app(session_maker: async_sessionmaker[AsyncSession], company_id: int) -> FastAPI:
    app = FastAPI()
    app.include_router(horeca.router, prefix="/api")

    async def _override_db():
        async with session_maker() as session:
            yield session

    async def _override_user():
        return User(
            id=901,
            email="owner-horeca@test.local",
            hashed_password="x",
            role=UserRole.owner,
            company_id=company_id,
            is_active=True,
        )

    async def _override_company_id():
        return company_id

    app.dependency_overrides[get_db] = _override_db
    app.dependency_overrides[get_current_user] = _override_user
    app.dependency_overrides[get_current_company_id] = _override_company_id
    return app


async def _seed(session_maker: async_sessionmaker[AsyncSession]) -> int:
    now = datetime.now(UTC)
    async with session_maker() as session:
        c = Company(name="HoReCa Test Co", is_active=True)
        session.add(c)
        await session.flush()

        owner = User(email="owner2-horeca@test.local", hashed_password="x", role=UserRole.owner, company_id=c.id, is_active=True)
        session.add(owner)
        await session.flush()

        d = BookingDirection(name="dir-horeca-overview-1", company_id=c.id, duration_min=30, is_active=True)
        session.add(d)
        await session.flush()
        sp = BookingSpecialist(full_name="Chef", direction_id=d.id, company_id=c.id, is_active=True)
        session.add(sp)
        await session.flush()

        session.add_all(
            [
                BookingAppointment(
                    company_id=c.id,
                    lead_id=None,
                    pipeline_id=None,
                    patient_name="Guest A",
                    patient_phone="+70000000011",
                    direction_id=d.id,
                    specialist_id=sp.id,
                    start_at=now,
                    end_at=now,
                    status="booked",
                    service_amount=Decimal("400"),
                    paid_amount=Decimal("400"),
                    responsible_manager_id=None,
                    created_by_user_id=owner.id,
                    service_title="Салат Цезарь",
                    created_at=now,
                ),
                BookingAppointment(
                    company_id=c.id,
                    lead_id=None,
                    pipeline_id=None,
                    patient_name="Guest B",
                    patient_phone="+70000000012",
                    direction_id=d.id,
                    specialist_id=sp.id,
                    start_at=now,
                    end_at=now,
                    status="booked",
                    service_amount=Decimal("100"),
                    paid_amount=Decimal("100"),
                    responsible_manager_id=None,
                    created_by_user_id=owner.id,
                    service_title="Бургер",
                    created_at=now,
                ),
            ]
        )

        wh = FinanceWarehouse(company_id=c.id, name="Склад", code="WH1", is_active=True, sort_order=0, is_default=True)
        session.add(wh)
        await session.flush()

        p1 = FinanceProduct(company_id=c.id, name="Помидоры", sku="TOM", product_type="good", unit="kg", is_active=True)
        p2 = FinanceProduct(company_id=c.id, name="Соус", sku="SAU", product_type="good", unit="l", is_active=True)
        session.add_all([p1, p2])
        await session.flush()
        menu1 = HorecaMenuItem(company_id=c.id, name="Салат Цезарь", sale_price=Decimal("400"), is_active=True)
        session.add(menu1)
        await session.flush()
        session.add(HorecaTechCardLine(menu_item_id=menu1.id, product_id=p1.id, qty_per_portion=Decimal("1.0")))

        session.add_all(
            [
                FinanceStockBalance(product_id=p1.id, warehouse_id=wh.id, quantity=Decimal("5"), avg_unit_cost=Decimal("20")),
                FinanceStockBalance(product_id=p2.id, warehouse_id=wh.id, quantity=Decimal("0.5"), avg_unit_cost=Decimal("10")),
            ]
        )

        session.add(
            FinanceStockMovement(
                company_id=c.id,
                warehouse_id=wh.id,
                product_id=p1.id,
                qty_delta=Decimal("-1"),
                movement_type="issue",
                unit_cost=Decimal("5"),
                memo="test issue",
                created_at=now,
            )
        )

        session.add(
            Task(
                company_id=c.id,
                title="Открыть смену",
                deadline=None,
                status=TaskStatus.pending,
                assigned_to=None,
                created_by_user_id=owner.id,
            )
        )

        await session.commit()
        return int(c.id)


def test_horeca_overview_contract(tmp_path: Path):
    db_path = tmp_path / "horeca_overview.sqlite3"
    engine = create_async_engine(f"sqlite+aiosqlite:///{db_path}")
    session_maker = async_sessionmaker(engine, expire_on_commit=False, class_=AsyncSession)
    try:
        import asyncio

        async def _setup():
            async with engine.begin() as conn:
                await conn.run_sync(Base.metadata.create_all)
            return await _seed(session_maker)

        company_id = asyncio.run(_setup())
        app = _make_app(session_maker, company_id)
        client = TestClient(app)

        r = client.get("/api/horeca/overview")
        assert r.status_code == 200, r.text
        body = r.json()
        assert "generated_at" in body
        assert "shift" in body
        assert body["shift"]["bookings_today"] == 2
        assert float(body["shift"]["revenue_today"]) == 500.0
        assert float(body["shift"]["avg_check_today"]) == 250.0
        assert body["shift"]["open_tasks"] == 1
        assert float(body["shift"]["cogs_7d"]) == 5.0

        abc = {x["item_name"]: x["abc_class"] for x in body["abc_menu"]}
        assert abc.get("Салат Цезарь") == "A"
        assert abc.get("Бургер") == "C"

        risks = {x["product_name"]: x["risk"] for x in body["food_cost_top"]}
        assert risks.get("Помидоры") == "ok"
        assert risks.get("Соус") == "low"

        rf = client.get("/api/horeca/finance/summary?days=30")
        assert rf.status_code == 200, rf.text
        fin = rf.json()
        assert float(fin["revenue"]) == 500.0
        assert float(fin["cogs"]) == 20.0
        assert float(fin["gross_profit"]) == 480.0
        assert fin["sales_count"] == 2
        assert fin["unmapped_sales_count"] == 1
    finally:
        import asyncio

        asyncio.run(engine.dispose())
