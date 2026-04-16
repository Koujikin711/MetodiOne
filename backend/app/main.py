import asyncio
from contextlib import asynccontextmanager
import logging
import socket

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.database import AsyncSessionLocal, engine
from app.database_migrate import ensure_booking_specialist_columns, ensure_multi_tenant_migration, ensure_owner_role_migration
from app.core.security import hash_password
from app.models import Base, BookingDirection, BookingSpecialist, Company, LeadSource, Pipeline, PipelineStage, User, UserRole
from app.services.default_pipeline_stages import default_pipeline_stage_creates
from app.routers import analytics, audit, auth, booking, chat, companies, deals, employees, integrations, leads, pipelines, reports, sources, stages, system, tasks, users
from app.services.whatsapp_automation import run_whatsapp_reminder_tick

logger = logging.getLogger(__name__)


def _install_asyncio_dns_exception_handler() -> None:
    """Логируем gaierror понятно; иначе async оставляет «Future exception was never retrieved»."""
    loop = asyncio.get_running_loop()
    prev = loop.get_exception_handler()

    def _handler(loop: asyncio.AbstractEventLoop, context: dict) -> None:
        exc = context.get("exception")
        if isinstance(exc, socket.gaierror):
            logger.warning(
                "DNS/сеть: %s. Проверьте DATABASE_URL (имя хоста БД), DNS контейнера и доступ в интернет.",
                exc,
            )
            return
        if prev is not None:
            prev(loop, context)
        else:
            loop.default_exception_handler(context)

    loop.set_exception_handler(_handler)


async def seed_pipelines_and_stages() -> None:
    async with AsyncSessionLocal() as session:
        cid = await _ensure_default_company(session)
        # Bootstrap только для пустой БД: без “вшитых” бизнес-стадий.
        any_pipeline = (await session.execute(select(Pipeline.id).where(Pipeline.company_id == cid).limit(1))).scalar_one_or_none()
        if any_pipeline is not None:
            return

        pipe = Pipeline(name="Основная", type="sales", company_id=cid)
        session.add(pipe)
        await session.flush()

        for st in default_pipeline_stage_creates():
            session.add(
                PipelineStage(
                    name=st.name,
                    order=st.order if st.order is not None else 0,
                    color=st.color,
                    pipeline_id=pipe.id,
                    company_id=cid,
                )
            )
        await session.commit()


TEST_ADMIN_EMAIL = "admin@crm.local"
TEST_SUPER_OWNER_EMAIL = "super@crm.local"


async def seed_test_admin() -> None:
    async with AsyncSessionLocal() as session:
        cid = await _ensure_default_company(session)
        result = await session.execute(select(User).where(User.email == TEST_ADMIN_EMAIL))
        if result.scalar_one_or_none() is not None:
            return
        session.add(
            User(
                email=TEST_ADMIN_EMAIL,
                hashed_password=hash_password("admin"),
                role=UserRole.owner,
                company_id=cid,
            )
        )
        await session.commit()


async def seed_super_owner() -> None:
    async with AsyncSessionLocal() as session:
        result = await session.execute(select(User).where(User.email == TEST_SUPER_OWNER_EMAIL))
        if result.scalar_one_or_none() is not None:
            return
        session.add(
            User(
                email=TEST_SUPER_OWNER_EMAIL,
                hashed_password=hash_password("admin"),
                role=UserRole.super_owner,
                company_id=None,
            )
        )
        await session.commit()


async def seed_booking_defaults() -> None:
    async with AsyncSessionLocal() as session:
        cid = await _ensure_default_company(session)
        result = await session.execute(select(BookingDirection).where(BookingDirection.company_id == cid).limit(1))
        if result.scalar_one_or_none() is not None:
            return
        d = BookingDirection(name="Консультация", duration_min=30, is_active=True, company_id=cid)
        session.add(d)
        await session.flush()
        session.add(
            BookingSpecialist(
                full_name="Ганчина",
                company_id=cid,
                direction_id=d.id,
                phone=None,
                is_active=True,
                specialization="Невролог",
            ),
        )
        await session.commit()


async def seed_lead_sources_defaults() -> None:
    async with AsyncSessionLocal() as session:
        cid = await _ensure_default_company(session)
        defaults = ["GREEN API", "WHATSAPP", "INSTAGRAM", "TELEGRAM"]
        existing = (
            await session.execute(
                select(LeadSource.name).where(LeadSource.company_id == cid, LeadSource.name.in_(defaults)),
            )
        ).all()
        existing_names = {row[0] for row in existing}
        for name in defaults:
            if name in existing_names:
                continue
            session.add(LeadSource(name=name, is_active=True, company_id=cid))
        await session.commit()


async def _ensure_default_company(session: AsyncSession) -> int:
    c = (await session.execute(select(Company).order_by(Company.id.asc()).limit(1))).scalars().first()
    if c is not None:
        return int(c.id)
    c = Company(name="Default Company", is_active=True)
    session.add(c)
    await session.flush()
    return int(c.id)


@asynccontextmanager
async def lifespan(_: FastAPI):
    _install_asyncio_dns_exception_handler()
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
        await ensure_booking_specialist_columns(conn, settings.database_url)
        await ensure_multi_tenant_migration(conn, settings.database_url)
    # enum-миграции PostgreSQL нельзя выполнять внутри begin-транзакции
    async with engine.connect() as conn:
        await ensure_owner_role_migration(conn, settings.database_url)
    await seed_pipelines_and_stages()
    await seed_test_admin()
    await seed_super_owner()
    await seed_booking_defaults()
    await seed_lead_sources_defaults()
    stop_event = asyncio.Event()

    async def _reminder_loop() -> None:
        try:
            await asyncio.sleep(8)
        except asyncio.CancelledError:
            return
        while not stop_event.is_set():
            try:
                async with AsyncSessionLocal() as session:
                    sent = await run_whatsapp_reminder_tick(session)
                    await session.commit()
                    if sent:
                        logger.info("whatsapp reminders sent: %s", sent)
            except Exception:
                logger.exception("whatsapp reminder tick failed")
            try:
                await asyncio.wait_for(stop_event.wait(), timeout=60.0)
            except TimeoutError:
                pass

    reminder_task = asyncio.create_task(_reminder_loop())

    def _reminder_done(t: asyncio.Task[None]) -> None:
        if t.cancelled():
            return
        exc = t.exception()
        if exc is not None:
            logger.error("whatsapp reminder task ended with error: %s", exc)

    reminder_task.add_done_callback(_reminder_done)
    yield
    stop_event.set()
    reminder_task.cancel()
    try:
        await reminder_task
    except asyncio.CancelledError:
        pass
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
app.include_router(reports.router, prefix="/api")
app.include_router(companies.router, prefix="/api")


@app.get("/health")
async def health():
    return {"status": "ok", "build": settings.build_version}
