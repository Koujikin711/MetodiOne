from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import select

from app.config import settings
from app.database import AsyncSessionLocal, engine
from app.database_migrate import ensure_booking_specialist_columns
from app.core.security import hash_password
from app.models import Base, BookingDirection, BookingSpecialist, LeadSource, Pipeline, PipelineStage, User, UserRole
from app.routers import analytics, audit, auth, booking, chat, deals, employees, integrations, leads, pipelines, sources, stages, system, tasks, users


async def seed_pipelines_and_stages() -> None:
    async with AsyncSessionLocal() as session:
        # Bootstrap только для пустой БД: без “вшитых” бизнес-стадий.
        any_pipeline = (await session.execute(select(Pipeline.id).limit(1))).scalar_one_or_none()
        if any_pipeline is not None:
            return

        pipe = Pipeline(name="Основная", type="sales")
        session.add(pipe)
        await session.flush()

        session.add(PipelineStage(name="Новый", order=0, color="#64748b", pipeline_id=pipe.id))
        await session.commit()


TEST_ADMIN_EMAIL = "admin@crm.local"


async def seed_test_admin() -> None:
    async with AsyncSessionLocal() as session:
        result = await session.execute(select(User).where(User.email == TEST_ADMIN_EMAIL))
        if result.scalar_one_or_none() is not None:
            return
        session.add(
            User(
                email=TEST_ADMIN_EMAIL,
                hashed_password=hash_password("admin"),
                role=UserRole.admin,
            )
        )
        await session.commit()


async def seed_booking_defaults() -> None:
    async with AsyncSessionLocal() as session:
        result = await session.execute(select(BookingDirection).limit(1))
        if result.scalar_one_or_none() is not None:
            return
        d = BookingDirection(name="Консультация", duration_min=30, is_active=True)
        session.add(d)
        await session.flush()
        session.add(BookingSpecialist(full_name="Ганчина", direction_id=d.id, phone=None, is_active=True))
        await session.commit()


async def seed_lead_sources_defaults() -> None:
    async with AsyncSessionLocal() as session:
        defaults = ["GREEN API", "WHATSAPP", "INSTAGRAM", "TELEGRAM"]
        existing = (
            await session.execute(
                select(LeadSource.name).where(LeadSource.name.in_(defaults)),
            )
        ).all()
        existing_names = {row[0] for row in existing}
        for name in defaults:
            if name in existing_names:
                continue
            session.add(LeadSource(name=name, is_active=True))
        await session.commit()


@asynccontextmanager
async def lifespan(_: FastAPI):
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
        await ensure_booking_specialist_columns(conn, settings.database_url)
    await seed_pipelines_and_stages()
    await seed_test_admin()
    await seed_booking_defaults()
    await seed_lead_sources_defaults()
    yield
    await engine.dispose()


app = FastAPI(title="CRM API", version="0.1.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth.router, prefix="/api")
app.include_router(leads.router, prefix="/api")
app.include_router(pipelines.router, prefix="/api")
app.include_router(stages.router, prefix="/api")
app.include_router(tasks.router, prefix="/api")
app.include_router(analytics.router, prefix="/api")
app.include_router(booking.router, prefix="/api")
app.include_router(deals.router, prefix="/api")
app.include_router(users.router, prefix="/api")
app.include_router(sources.router, prefix="/api")
app.include_router(integrations.router, prefix="/api")
app.include_router(employees.router, prefix="/api")
app.include_router(system.router, prefix="/api")
app.include_router(chat.router, prefix="/api")
app.include_router(audit.router, prefix="/api")


@app.get("/health")
async def health():
    return {"status": "ok"}
