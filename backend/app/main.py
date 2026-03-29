from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import select

from app.config import settings
from app.database import AsyncSessionLocal, engine
from app.core.security import hash_password
from app.models import Base, PipelineStage, User, UserRole
from app.routers import analytics, auth, leads, stages, tasks


async def seed_pipeline_stages() -> None:
    async with AsyncSessionLocal() as session:
        result = await session.execute(select(PipelineStage).limit(1))
        if result.scalars().first() is not None:
            return
        session.add_all(
            [
                PipelineStage(name="Новый", order=0, color="#64748b"),
                PipelineStage(name="В работе", order=1, color="#3b82f6"),
                PipelineStage(name="Квалифицирован", order=2, color="#8b5cf6"),
                PipelineStage(name="Успешно реализован", order=3, color="#22c55e"),
                PipelineStage(name="Потерян", order=4, color="#ef4444"),
            ]
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


@asynccontextmanager
async def lifespan(_: FastAPI):
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    await seed_pipeline_stages()
    await seed_test_admin()
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
app.include_router(stages.router, prefix="/api")
app.include_router(tasks.router, prefix="/api")
app.include_router(analytics.router, prefix="/api")


@app.get("/health")
async def health():
    return {"status": "ok"}
