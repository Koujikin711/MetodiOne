import asyncio
from datetime import UTC, date, datetime
from decimal import Decimal
from pathlib import Path

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.models import (
    Base,
    BookingAppointment,
    BookingDirection,
    BookingSpecialist,
    Company,
    Lead,
    LeadAuditEvent,
    Pipeline,
    PipelineStage,
    SalesKpiManualSale,
    SalesKpiPlanItem,
    User,
    UserRole,
)
from app.routers.leads import lead_patient_card
from app.services.lead_card import build_manager_steps


def test_manager_steps_from_first_touch_and_change():
    created = datetime(2026, 8, 1, tzinfo=UTC)
    changed = datetime(2026, 9, 2, tzinfo=UTC)
    steps = build_manager_steps(
        created,
        9,
        [(changed, "from_manager_id=3 (А), to_manager_id=9, via=rop_transfer")],
    )
    assert steps == [
        (created, 3, "первый менеджер"),
        (changed, 9, "сменился"),
    ]


def test_manager_steps_without_audit_uses_current():
    created = datetime(2026, 10, 4, tzinfo=UTC)
    assert build_manager_steps(created, 4, []) == [(created, 4, "с первого касания")]


def test_patient_card_lists_manager_change_visit_and_sale(tmp_path: Path):
    db_path = tmp_path / "lead_card.sqlite3"
    engine = create_async_engine(f"sqlite+aiosqlite:///{db_path}")

    async def _run() -> None:
        session_maker = async_sessionmaker(engine, expire_on_commit=False)
        async with engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)
        created = datetime(2026, 8, 1, 8, 0, tzinfo=UTC)
        changed = datetime(2026, 9, 2, 9, 0, tzinfo=UTC)
        visit_at = datetime(2026, 8, 15, 10, 0, tzinfo=UTC)
        async with session_maker() as session:
            company = Company(name="Clinic", is_active=True)
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
            first = User(
                email="first@test.local",
                hashed_password="x",
                role=UserRole.manager,
                company_id=company.id,
                full_name="Матлубаи",
                is_active=True,
            )
            second = User(
                email="second@test.local",
                hashed_password="x",
                role=UserRole.manager,
                company_id=company.id,
                full_name="Хайдарзода",
                is_active=True,
            )
            session.add_all([owner, first, second])
            await session.flush()
            pipe = Pipeline(name="Sales", type="sales", company_id=company.id)
            session.add(pipe)
            await session.flush()
            stage = PipelineStage(
                name="В работе",
                order=1,
                color="#111",
                pipeline_id=pipe.id,
                company_id=company.id,
            )
            session.add(stage)
            await session.flush()
            lead = Lead(
                company_id=company.id,
                name="Соро",
                phone="+992988323697",
                source="WhatsApp",
                status_id=stage.id,
                manager_id=second.id,
                created_at=created,
            )
            session.add(lead)
            await session.flush()
            session.add(
                LeadAuditEvent(
                    company_id=company.id,
                    lead_id=lead.id,
                    action="manager_reassigned",
                    details=f"from_manager_id={first.id}, to_manager_id={second.id}",
                    created_at=changed,
                )
            )
            direction = BookingDirection(company_id=company.id, name=f"ТМС {company.id}", pipeline_id=pipe.id)
            session.add(direction)
            await session.flush()
            spec = BookingSpecialist(company_id=company.id, full_name="Эксперт Массаж", direction_id=direction.id)
            session.add(spec)
            await session.flush()
            session.add(
                BookingAppointment(
                    company_id=company.id,
                    lead_id=lead.id,
                    patient_name="Соро",
                    patient_phone="+992988323697",
                    direction_id=direction.id,
                    specialist_id=spec.id,
                    start_at=visit_at,
                    end_at=visit_at,
                    status="completed",
                    service_amount=Decimal("500"),
                    paid_amount=Decimal("500"),
                    service_title="Массаж",
                    created_by_user_id=owner.id,
                )
            )
            item = SalesKpiPlanItem(
                company_id=company.id,
                pipeline_id=pipe.id,
                year_month=date(2026, 8, 1),
                name="Протокол",
            )
            session.add(item)
            await session.flush()
            session.add(
                SalesKpiManualSale(
                    company_id=company.id,
                    pipeline_id=pipe.id,
                    plan_item_id=item.id,
                    manager_user_id=second.id,
                    client_name="Соро",
                    client_phone="+992988323697",
                    lead_id=lead.id,
                    service_amount=Decimal("3000"),
                    paid_amount=Decimal("1700"),
                    sold_at=created,
                    created_by_user_id=owner.id,
                )
            )
            await session.commit()
            card = await lead_patient_card(int(lead.id), session, owner, int(company.id))
            assert card.source == "WhatsApp"
            assert [m.manager_name for m in card.managers] == ["Матлубаи", "Хайдарзода"]
            assert card.managers[0].note == "первый менеджер"
            assert card.managers[1].note == "сменился"
            assert card.visits[0].service == "Массаж"
            assert card.visits[0].specialist_name == "Эксперт Массаж"
            assert card.visits[0].status == "Пришёл"
            assert card.sales[0].name == "Протокол"
            assert card.sales[0].debt_amount == Decimal("1300")
        await engine.dispose()

    asyncio.run(_run())
