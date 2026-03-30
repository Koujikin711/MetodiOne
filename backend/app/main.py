from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import select

from app.config import settings
from app.database import AsyncSessionLocal, engine
from app.database_migrate import ensure_booking_specialist_columns
from app.core.security import hash_password
from app.models import Base, BookingDirection, BookingSpecialist, Pipeline, PipelineStage, User, UserRole
from app.routers import analytics, auth, booking, deals, leads, pipelines, stages, tasks, users


async def seed_pipelines_and_stages() -> None:
    async with AsyncSessionLocal() as session:
        pipelines = [
            {"name": "Продажи", "type": "sales"},
            {"name": "Лечение", "type": "treatment"},
            {"name": "Доп. услуги", "type": "extra"},
        ]
        stages = [
            # Старые стадии (нужны для онлайн-записи и аналитики)
            {"name": "Новый", "order": 0, "color": "#64748b"},
            {"name": "В работе", "order": 1, "color": "#3b82f6"},
            {"name": "Квалифицирован", "order": 2, "color": "#8b5cf6"},
            # Workflow-стадии из ТЗ
            {"name": "Запись", "order": 3, "color": "#a855f7"},
            {"name": "У эксперта", "order": 4, "color": "#22c55e"},
            {"name": "Оказание услуги", "order": 5, "color": "#16a34a"},
            {"name": "Доп. услуги", "order": 6, "color": "#a855f7"},
            # Конечные стадии
            {"name": "Успешно реализован", "order": 7, "color": "#22c55e"},
            {"name": "Потерян", "order": 8, "color": "#ef4444"},
        ]

        # Привязываем уже существующие стадии (без pipeline_id) к “Продажи”
        sales_pipe = (await session.execute(select(Pipeline).where(Pipeline.name == "Продажи"))).scalars().first()
        if sales_pipe is None:
            sales_pipe = Pipeline(name="Продажи", type="sales")
            session.add(sales_pipe)
            await session.flush()

        await session.execute(
            PipelineStage.__table__.update()
            .where(PipelineStage.__table__.c.pipeline_id.is_(None))
            .values(pipeline_id=sales_pipe.id),
        )

        for p in pipelines:
            pipe = (await session.execute(select(Pipeline).where(Pipeline.name == p["name"]))).scalars().first()
            if pipe is None:
                pipe = Pipeline(name=p["name"], type=p["type"])
                session.add(pipe)
                await session.flush()

            for st in stages:
                existing = (
                    await session.execute(
                        select(PipelineStage).where(
                            PipelineStage.name == st["name"],
                            PipelineStage.pipeline_id == pipe.id,
                        ).limit(1),
                    )
                ).scalars().first()
                if existing is None:
                    session.add(
                        PipelineStage(
                            name=st["name"],
                            order=st["order"],
                            color=st["color"],
                            pipeline_id=pipe.id,
                        )
                    )

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


@asynccontextmanager
async def lifespan(_: FastAPI):
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
        await ensure_booking_specialist_columns(conn, settings.database_url)
    await seed_pipelines_and_stages()
    await seed_test_admin()
    await seed_booking_defaults()
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


@app.get("/health")
async def health():
    return {"status": "ok"}
