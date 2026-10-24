import asyncio
from pathlib import Path

from sqlalchemy import select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.models import Base, Company, Lead, LeadExtraPhone, Pipeline, PipelineStage
from app.services.lead_extra_phones import lead_has_contact_phone


def test_lead_board_hides_contacts_without_phone(tmp_path: Path):
    db_path = tmp_path / "leads.sqlite3"
    engine = create_async_engine(f"sqlite+aiosqlite:///{db_path}")

    async def _run() -> None:
        session_maker = async_sessionmaker(engine, expire_on_commit=False)
        async with engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)
        async with session_maker() as session:
            company = Company(name="Clinic", is_active=True)
            session.add(company)
            await session.flush()
            pipe = Pipeline(name="Медицина", company_id=company.id)
            session.add(pipe)
            await session.flush()
            stage = PipelineStage(name="Новый", company_id=company.id, pipeline_id=pipe.id)
            session.add(stage)
            await session.flush()
            guest = Lead(company_id=company.id, name="Гость", phone=None, status_id=stage.id, source="INSTAGRAM_DM")
            named = Lead(company_id=company.id, name="Roza", phone="", status_id=stage.id, source="INSTAGRAM_DM")
            short = Lead(company_id=company.id, name="Короткий", phone="12345", status_id=stage.id)
            wa = Lead(company_id=company.id, name="Muhammadi", phone="+992 014 742 727", status_id=stage.id)
            extra_only = Lead(company_id=company.id, name="Только доп", phone=None, status_id=stage.id)
            session.add_all([guest, named, short, wa, extra_only])
            await session.flush()
            session.add(
                LeadExtraPhone(company_id=company.id, lead_id=extra_only.id, phone="992901112233", sort_order=0),
            )
            await session.commit()

            rows = (
                await session.execute(select(Lead.name).where(lead_has_contact_phone()).order_by(Lead.name.asc()))
            ).all()
            assert [r[0] for r in rows] == ["Muhammadi", "Только доп"]

        await engine.dispose()

    asyncio.run(_run())
