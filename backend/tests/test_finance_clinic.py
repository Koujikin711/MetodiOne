"""Финансы клиники: дебиторка CRM и синхронизация оплат сделок."""

from __future__ import annotations

import asyncio
from datetime import UTC, datetime
from decimal import Decimal
from pathlib import Path

from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.core.deps import get_current_company_id, get_current_user
from app.core.security import hash_password
from app.database import get_db
from app.models import (
    Base,
    BookingAppointment,
    BookingDirection,
    BookingSpecialist,
    Company,
    Deal,
    Lead,
    Pipeline,
    PipelineStage,
    User,
    UserRole,
)
from app.routers import finance
from app.services.finance_clinic import crm_receivables_total
from app.services.finance_crm_bridge import sync_deal_payment_revenue
from app.services.finance_seed import ensure_default_chart, ensure_finance_settings


def _make_app(session_maker: async_sessionmaker[AsyncSession], company_id: int, owner: User) -> FastAPI:
    app = FastAPI()
    app.include_router(finance.router, prefix="/api")

    async def _override_db():
        async with session_maker() as session:
            yield session

    async def _override_user():
        return owner

    async def _override_company_id():
        return company_id

    app.dependency_overrides[get_db] = _override_db
    app.dependency_overrides[get_current_user] = _override_user
    app.dependency_overrides[get_current_company_id] = _override_company_id
    return app


def _seed(session_maker: async_sessionmaker[AsyncSession]):
    async def _run():
        async with session_maker() as session:
            company = Company(name="Clinic Fin Co", is_active=True)
            session.add(company)
            await session.flush()
            owner = User(
                email="owner-clinic-fin@test.local",
                hashed_password=hash_password("secret"),
                role=UserRole.owner,
                company_id=company.id,
                is_active=True,
            )
            session.add(owner)
            await session.flush()
            pipe = Pipeline(name="Main", company_id=company.id)
            session.add(pipe)
            await session.flush()
            stage = PipelineStage(company_id=company.id, pipeline_id=pipe.id, name="Новый", order=0)
            session.add(stage)
            await session.flush()
            direction = BookingDirection(name="dir", company_id=company.id, duration_min=30, is_active=True)
            session.add(direction)
            await session.flush()
            specialist = BookingSpecialist(
                company_id=company.id,
                direction_id=direction.id,
                full_name="Доктор",
                is_active=True,
            )
            session.add(specialist)
            await session.flush()
            now = datetime.now(UTC)
            lead = Lead(
                company_id=company.id,
                name="Пациент Тест",
                phone="992901234567",
                source="test",
                status_id=stage.id,
                manager_id=owner.id,
                created_at=now,
            )
            session.add(lead)
            await session.flush()
            appt = BookingAppointment(
                company_id=company.id,
                lead_id=lead.id,
                pipeline_id=pipe.id,
                direction_id=direction.id,
                specialist_id=specialist.id,
                patient_name="Пациент Тест",
                patient_phone="992901234567",
                service_amount=Decimal("1000"),
                paid_amount=Decimal("400"),
                start_at=now,
                end_at=now,
                status="booked",
                responsible_manager_id=owner.id,
                created_by_user_id=owner.id,
            )
            session.add(appt)
            deal = Deal(
                company_id=company.id,
                title="Доп. анализ",
                amount=Decimal("500"),
                paid_amount=Decimal("100"),
                stage_id=stage.id,
                lead_id=lead.id,
            )
            session.add(deal)
            await session.flush()
            await ensure_finance_settings(session, company.id)
            await ensure_default_chart(session, company.id)
            await session.commit()
            return company.id, owner, lead.id, deal.id

    return asyncio.run(_run())


def test_crm_receivables_total(tmp_path: Path):
    db_path = tmp_path / "finance_clinic.sqlite3"
    engine = create_async_engine(f"sqlite+aiosqlite:///{db_path}")
    asyncio.run(_init_db(engine))
    session_maker = async_sessionmaker(engine, expire_on_commit=False)
    company_id, *_ = _seed(session_maker)

    async def _check():
        async with session_maker() as db:
            return await crm_receivables_total(db, company_id)

    total = asyncio.run(_check())
    assert total == Decimal("1000.00")
    asyncio.run(engine.dispose())


def test_sync_deal_payment_revenue_delta(tmp_path: Path):
    db_path = tmp_path / "finance_clinic2.sqlite3"
    engine = create_async_engine(f"sqlite+aiosqlite:///{db_path}")
    asyncio.run(_init_db(engine))
    session_maker = async_sessionmaker(engine, expire_on_commit=False)
    company_id, owner, lead_id, deal_id = _seed(session_maker)

    async def _sync():
        async with session_maker() as db:
            ok = await sync_deal_payment_revenue(
                db,
                company_id=company_id,
                lead_id=lead_id,
                deal_id=deal_id,
                target_paid_amount=Decimal("250"),
                user_id=owner.id,
            )
            ok2 = await sync_deal_payment_revenue(
                db,
                company_id=company_id,
                lead_id=lead_id,
                deal_id=deal_id,
                target_paid_amount=Decimal("250"),
                user_id=owner.id,
            )
            await db.commit()
            return ok, ok2

    ok, ok2 = asyncio.run(_sync())
    assert ok is True
    assert ok2 is False
    asyncio.run(engine.dispose())


def test_clinic_summary_api(tmp_path: Path):
    db_path = tmp_path / "finance_clinic3.sqlite3"
    engine = create_async_engine(f"sqlite+aiosqlite:///{db_path}")
    asyncio.run(_init_db(engine))
    session_maker = async_sessionmaker(engine, expire_on_commit=False)
    company_id, owner, *_ = _seed(session_maker)
    app = _make_app(session_maker, company_id, owner)
    client = TestClient(app)
    r = client.get(
        "/api/finance/reports/clinic-summary",
        params={"date_from": "2026-01-01", "date_to": "2026-12-31"},
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert Decimal(body["ar_crm_total"]) == Decimal("1000")
    assert len(body["receivable_lines"]) >= 2
    asyncio.run(engine.dispose())


async def _init_db(engine):
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
