"""Владелец снимает или ставит оплату курса. Журнал и менеджер строки не переписываются."""

from __future__ import annotations

import asyncio
from datetime import UTC, datetime
from decimal import Decimal
from pathlib import Path

from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.core.deps import get_current_company_id, get_current_user
from app.database import get_db
from app.models import (
    Base,
    Company,
    Pipeline,
    SalesKpiManualSale,
    SalesKpiManualSalePayment,
    SalesKpiPlanItem,
    SystemAuditEvent,
    User,
    UserRole,
)
from app.routers import sales_kpi_board
from app.services.kpi_paid_adjust import PaidAdjustError, PaidAdjustLine, plan_paid_adjustment


def test_subtract_takes_the_newest_line_and_leaves_the_first():
    plan = plan_paid_adjustment(
        paid=Decimal("10500"),
        service=Decimal("17000"),
        lines=[
            PaidAdjustLine(1, Decimal("5500"), is_first=True),
            PaidAdjustLine(2, Decimal("5000"), is_first=False),
        ],
        mode="subtract",
        amount=Decimal("5000"),
    )
    assert plan.target == Decimal("5500.00")
    assert plan.add_amount == 0
    assert [(c.id, c.old, c.new) for c in plan.changes] == [(2, Decimal("5000.00"), Decimal("0.00"))]


def test_set_above_paid_does_not_rewrite_old_lines():
    plan = plan_paid_adjustment(
        paid=Decimal("5500"),
        service=Decimal("17000"),
        lines=[PaidAdjustLine(1, Decimal("5500"), is_first=True)],
        mode="set",
        amount=Decimal("8000"),
    )
    assert plan.target == Decimal("8000.00")
    assert plan.changes == []
    assert plan.add_amount == Decimal("2500.00")


def test_cannot_subtract_more_than_paid_or_pass_the_price():
    lines = [PaidAdjustLine(1, Decimal("5500"), is_first=True)]
    try:
        plan_paid_adjustment(
            paid=Decimal("5500"),
            service=Decimal("17000"),
            lines=lines,
            mode="subtract",
            amount=Decimal("6000"),
        )
        raise AssertionError("expected error")
    except PaidAdjustError:
        pass
    try:
        plan_paid_adjustment(
            paid=Decimal("5500"),
            service=Decimal("17000"),
            lines=lines,
            mode="set",
            amount=Decimal("18000"),
        )
        raise AssertionError("expected error")
    except PaidAdjustError:
        pass


def _app(session_maker, company_id: int, user_id: int, role: UserRole) -> FastAPI:
    app = FastAPI()
    app.include_router(sales_kpi_board.router, prefix="/api")

    async def _override_db():
        async with session_maker() as session:
            yield session

    async def _override_user():
        return User(
            id=user_id,
            email="owner@test.local",
            hashed_password="x",
            role=role,
            company_id=company_id,
            full_name="Владелец",
            is_active=True,
        )

    async def _override_company_id():
        return company_id

    app.dependency_overrides[get_db] = _override_db
    app.dependency_overrides[get_current_user] = _override_user
    app.dependency_overrides[get_current_company_id] = _override_company_id
    return app


def test_owner_subtract_writes_audit_and_keeps_the_manager(tmp_path: Path):
    db_path = tmp_path / "adjust.sqlite3"
    engine = create_async_engine(f"sqlite+aiosqlite:///{db_path}")
    session_maker = async_sessionmaker(engine, expire_on_commit=False, class_=AsyncSession)

    async def _seed() -> dict[str, int]:
        async with engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)
        async with session_maker() as session:
            company = Company(name="Clinic", is_active=True, crm_mode="clinic")
            session.add(company)
            await session.flush()
            owner = User(
                email="owner@test.local",
                hashed_password="x",
                role=UserRole.owner,
                company_id=company.id,
                full_name="Владелец",
                is_active=True,
            )
            manager = User(
                email="m@test.local",
                hashed_password="x",
                role=UserRole.manager,
                company_id=company.id,
                full_name="Мулкия",
                is_active=True,
            )
            session.add_all([owner, manager])
            await session.flush()
            pipe = Pipeline(name="Медицина", type="sales", company_id=company.id)
            session.add(pipe)
            await session.flush()
            item = SalesKpiPlanItem(
                company_id=company.id,
                pipeline_id=pipe.id,
                year_month=datetime(2026, 8, 1).date(),
                name="Курс",
                source_type="manual",
            )
            session.add(item)
            await session.flush()
            sale = SalesKpiManualSale(
                company_id=company.id,
                pipeline_id=pipe.id,
                plan_item_id=item.id,
                manager_user_id=manager.id,
                client_name="Шохусайнзода Махинобону",
                client_phone="918290963",
                service_amount=Decimal("17000"),
                paid_amount=Decimal("10500"),
                first_paid_amount=Decimal("5500"),
                sold_at=datetime(2026, 8, 31, 4, 52, tzinfo=UTC),
                status="active",
                created_by_user_id=owner.id,
            )
            session.add(sale)
            await session.flush()
            now = datetime(2026, 10, 1, tzinfo=UTC)
            session.add_all(
                [
                    SalesKpiManualSalePayment(
                        company_id=company.id,
                        sale_id=sale.id,
                        amount=Decimal("5500"),
                        is_first=True,
                        paid_at=datetime(2026, 8, 31, 4, 52, tzinfo=UTC),
                        manager_user_id=manager.id,
                        confirmed_at=now,
                        confirmed_by_user_id=owner.id,
                    ),
                    SalesKpiManualSalePayment(
                        company_id=company.id,
                        sale_id=sale.id,
                        amount=Decimal("5000"),
                        is_first=False,
                        note="Доплата",
                        paid_at=datetime(2026, 10, 20, tzinfo=UTC),
                        manager_user_id=manager.id,
                        confirmed_at=now,
                        confirmed_by_user_id=owner.id,
                    ),
                ]
            )
            await session.commit()
            return {"company": int(company.id), "owner": int(owner.id), "sale": int(sale.id), "manager": int(manager.id)}

    try:
        ids = asyncio.run(_seed())
        admin = TestClient(_app(session_maker, ids["company"], ids["owner"], UserRole.admin))
        blocked = admin.patch(
            f"/api/sales-kpi/manual-sales/{ids['sale']}/paid",
            json={"mode": "subtract", "amount": "5000", "reason": "лишние пять тысяч"},
        )
        assert blocked.status_code == 403

        owner = TestClient(_app(session_maker, ids["company"], ids["owner"], UserRole.owner))
        saved = owner.patch(
            f"/api/sales-kpi/manual-sales/{ids['sale']}/paid",
            json={"mode": "subtract", "amount": "5000", "reason": "ошибочно добавили 5000"},
        )
        assert saved.status_code == 200, saved.text
        body = saved.json()
        assert Decimal(str(body["paid_amount"])) == Decimal("5500.00")
        assert Decimal(str(body["debt_amount"])) == Decimal("11500.00")
        assert Decimal(str(body["service_amount"])) == Decimal("17000.00")
        assert Decimal(str(body["first_paid_amount"])) == Decimal("5500.00")
        amounts = {int(row["id"]): Decimal(str(row["amount"])) for row in body["payments"]}
        assert Decimal("5500.00") in amounts.values()
        assert Decimal("0.00") in amounts.values()

        async def _check() -> None:
            async with session_maker() as session:
                rows = (
                    await session.execute(
                        select(SalesKpiManualSalePayment).where(SalesKpiManualSalePayment.sale_id == ids["sale"])
                    )
                ).scalars().all()
                for row in rows:
                    assert int(row.manager_user_id) == ids["manager"]
                audit = (
                    await session.execute(
                        select(SystemAuditEvent).where(
                            SystemAuditEvent.entity_type == "kpi_manual_sale",
                            SystemAuditEvent.action == "payment_adjusted",
                            SystemAuditEvent.entity_id == ids["sale"],
                        )
                    )
                ).scalars().all()
                assert len(audit) == 1
                assert "10500" in (audit[0].details or "")
                assert "5500" in (audit[0].details or "")
                assert "ошибочно" in (audit[0].details or "")

        asyncio.run(_check())
    finally:
        asyncio.run(engine.dispose())
