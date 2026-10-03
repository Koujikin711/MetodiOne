"""Журнал сбора дебиторки: просрочка по дате обещания, не по возрасту долга."""

from __future__ import annotations

import asyncio
from datetime import UTC, datetime, timedelta
from decimal import Decimal
from pathlib import Path

from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.core.deps import get_current_company_id, get_current_user
from app.database import get_db
from app.models import (
    Base,
    Company,
    Pipeline,
    SalesKpiManualSale,
    SalesKpiPlanItem,
    User,
    UserRole,
)
from app.routers import sales_kpi_board
from app.services.debtor_collection import (
    booking_debtor_receipts,
    manual_debtor_receipts,
    promise_is_overdue,
    promise_needs_call,
    receipt_amount_from_audit_details,
    sort_debtors_for_calls,
)


class _Row:
    def __init__(self, name: str, promised_on):
        self.name = name
        self.promised_on = promised_on


def test_overdue_is_only_a_missed_promise_date():
    today = datetime(2026, 10, 2).date()
    assert promise_is_overdue(None, today) is False
    assert promise_is_overdue(today, today) is False
    assert promise_is_overdue(today - timedelta(days=1), today) is True
    assert promise_needs_call(today, today) is True
    assert promise_needs_call(today + timedelta(days=2), today) is False


def test_call_list_puts_due_promises_first_and_keeps_the_rest():
    today = datetime(2026, 10, 2).date()
    rows = [
        _Row("new", None),
        _Row("later", today + timedelta(days=4)),
        _Row("today", today),
        _Row("old", today - timedelta(days=3)),
    ]
    ordered = [row.name for row in sort_debtors_for_calls(rows, today)]
    assert ordered == ["old", "today", "new", "later"]


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
            is_active=True,
        )

    async def _override_company_id():
        return company_id

    app.dependency_overrides[get_db] = _override_db
    app.dependency_overrides[get_current_user] = _override_user
    app.dependency_overrides[get_current_company_id] = _override_company_id
    return app


def test_note_does_not_change_debt_and_sorts_the_missed_promise(tmp_path: Path):
    db_path = tmp_path / "debtors.sqlite3"
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
                full_name="Админ",
                is_active=True,
            )
            manager = User(
                email="m@test.local",
                hashed_password="x",
                role=UserRole.manager,
                company_id=company.id,
                full_name="Дилнора",
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
                year_month=datetime(2026, 10, 1).date(),
                name="Курс",
                source_type="manual",
            )
            session.add(item)
            await session.flush()
            older = SalesKpiManualSale(
                company_id=company.id,
                pipeline_id=pipe.id,
                plan_item_id=item.id,
                manager_user_id=manager.id,
                client_name="Старый долг",
                client_phone="992900000001",
                service_amount=Decimal("17000"),
                paid_amount=Decimal("500"),
                first_paid_amount=Decimal("500"),
                sold_at=datetime(2025, 1, 10, tzinfo=UTC),
                status="active",
                created_by_user_id=owner.id,
            )
            newer = SalesKpiManualSale(
                company_id=company.id,
                pipeline_id=pipe.id,
                plan_item_id=item.id,
                manager_user_id=manager.id,
                client_name="Свежий долг",
                client_phone="992900000002",
                service_amount=Decimal("3000"),
                paid_amount=Decimal("1000"),
                first_paid_amount=Decimal("1000"),
                sold_at=datetime(2025, 6, 1, tzinfo=UTC),
                status="active",
                created_by_user_id=owner.id,
            )
            session.add_all([older, newer])
            await session.commit()
            return {
                "company": int(company.id),
                "owner": int(owner.id),
                "pipe": int(pipe.id),
                "older": int(older.id),
                "newer": int(newer.id),
            }

    try:
        ids = asyncio.run(_seed())
        client = TestClient(_app(session_maker, ids["company"], ids["owner"], UserRole.owner))
        listed = client.get(f"/api/sales-kpi/debtors?pipeline_id={ids['pipe']}&year_month=2026-10")
        assert listed.status_code == 200, listed.text
        body = listed.json()
        assert [row["client_name"] for row in body["rows"]] == ["Свежий долг", "Старый долг"]
        assert body["total_debt"] in ("18500", "18500.00", 18500, 18500.0)

        from app.services.debtor_collection import clinic_today

        missed = (clinic_today() - timedelta(days=1)).isoformat()
        saved = client.put(
            "/api/sales-kpi/debtors/note",
            json={
                "source": "manual",
                "source_id": ids["older"],
                "comment": "обещал доплатить",
                "promised_on": missed,
            },
        )
        assert saved.status_code == 200, saved.text
        assert saved.json()["promise_overdue"] is True

        again = client.get(f"/api/sales-kpi/debtors?pipeline_id={ids['pipe']}&year_month=2026-10")
        rows = again.json()["rows"]
        assert [row["client_name"] for row in rows] == ["Старый долг", "Свежий долг"]
        assert rows[0]["comment"] == "обещал доплатить"
        assert rows[0]["promise_overdue"] is True
        assert rows[0]["debt_amount"] in ("16500", "16500.00", 16500, 16500.0)
        assert again.json()["total_debt"] in ("18500", "18500.00", 18500, 18500.0)
        older = rows[0]
        assert len(older["payments"]) == 1
        assert older["payments"][0]["kind"] == "first"
        assert older["payments"][0]["amount"] in ("500", "500.00", 500, 500.0)

        denied = TestClient(_app(session_maker, ids["company"], ids["owner"], UserRole.manager))
        blocked = denied.put(
            "/api/sales-kpi/debtors/note",
            json={"source": "manual", "source_id": ids["older"], "comment": "нет", "promised_on": missed},
        )
        assert blocked.status_code == 403
    finally:
        asyncio.run(engine.dispose())


class _Pay:
    def __init__(self, amount: str, is_first: bool, paid_at: datetime) -> None:
        self.amount = Decimal(amount)
        self.is_first = is_first
        self.paid_at = paid_at


def test_manual_receipts_keep_each_payment_and_fill_the_gap() -> None:
    sold = datetime(2026, 8, 31, 12, tzinfo=UTC)
    later = datetime(2026, 9, 15, 10, tzinfo=UTC)
    rows = manual_debtor_receipts(
        [
            _Pay("5000", True, sold),
            _Pay("3019", False, later),
        ],
        paid_amount=Decimal("8019"),
        sold_at=sold,
    )
    assert [(row[1], row[2]) for row in rows] == [
        (Decimal("3019"), "topup"),
        (Decimal("5000"), "first"),
    ]


def test_booking_receipt_uses_add_payment_then_falls_back_to_snapshot() -> None:
    when = datetime(2026, 9, 7, 10, tzinfo=UTC)
    amount = receipt_amount_from_audit_details(
        "prev_paid=0; add_payment=900; new_paid=900; payment_method=cash"
    )
    assert amount == Decimal("900")
    assert receipt_amount_from_audit_details("prev_paid=900; add_payment=None; new_paid=900") is None
    from_audit = booking_debtor_receipts(
        [(when, "prev_paid=0; add_payment=900; new_paid=900")],
        paid_amount=Decimal("900"),
        paid_at=when,
        start_at=when,
    )
    assert from_audit == [(when, Decimal("900"), "topup")]
    snapshot = booking_debtor_receipts(
        [],
        paid_amount=Decimal("900"),
        paid_at=when,
        start_at=when,
    )
    assert snapshot == [(when, Decimal("900"), "receipt")]
