import asyncio
from contextlib import asynccontextmanager
import logging
import socket
import time

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from starlette.responses import JSONResponse

from app.core.request_id_middleware import RequestIdMiddleware
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.database import AsyncSessionLocal, effective_database_url, engine
from app.database_migrate import (
    ensure_attendance_tracker_tables,
    ensure_booking_specialist_columns,
    ensure_chat_performance_indexes,
    ensure_finance_osv_tables,
    ensure_integration_provider_migration,
    ensure_multi_tenant_migration,
    ensure_owner_role_migration,
    ensure_sales_kpi_plans,
    ensure_super_owner_platform,
    ensure_tariff_plans_platform,
    ensure_demo_billing_platform,
    ensure_tariff_constructor_billing,
    ensure_service_catalog_tables,
    ensure_lead_extra_phones_tables,
    ensure_booking_specialist_directions,
    ensure_sales_crm_space_migration,
    ensure_sales_field_visits_migration,
    ensure_pipeline_stage_automation,
    ensure_lead_waiting_callbacks,
    ensure_lead_reactivated_at,
    ensure_lead_archived_from_stage,
    ensure_settle_completed_booking_debts,
    ensure_fix_kurs_direction_and_session_pay,
    ensure_fix_ayub_massage_prepaid_10x150,
    ensure_fix_aug2026_konsult_to_kurs15,
    ensure_fix_massage_osv_prepaid_aug2026,
    ensure_clinic_staff_roles,
    ensure_extra_services_tables,
)
from app.core.security import decode_token, hash_password, verify_password
from app.models import Base, BookingDirection, BookingSpecialist, Company, LeadSource, Pipeline, PipelineStage, User, UserRole
from app.services.default_pipeline_stages import default_pipeline_stage_creates
from app.routers import (
    analytics,
    audit,
    auth,
    billing,
    booking,
    chat,
    companies,
    deals,
    employees,
    finance,
    integrations,
    leads,
    pipelines,
    reports,
    sales_kpi,
    sales_kpi_board,
    manager_desk_sales,
    quote_calculator,
    sales_field_visits,
    sources,
    stages,
    system,
    tariff_plans,
    tasks,
    team_chat,
    users,
    waiting_callbacks,
    extra_services,
)
from app.services.background_events import record_background_event
from app.services.google_sheets_finance_sync import run_finance_sheets_sync_tick
from app.services.google_sheets_sync import run_google_sheets_import_tick
from app.services.runtime_metrics import runtime_metrics
from app.services.waiting_callback_reminders import run_waiting_callback_tick
from app.services.archive_evening_reactivate import run_archive_evening_reactivate_tick
from app.services.whatsapp_automation import run_whatsapp_reminder_tick

logger = logging.getLogger(__name__)

if not logging.root.handlers:
    logging.basicConfig(
        level=logging.INFO,
        format="%(levelname)s %(name)s %(message)s",
    )


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


async def _run_startup_migrations_with_retry() -> None:
    """
    На некоторых платформах после деплоя DNS/сеть к PostgreSQL
    могут быть недоступны первые секунды. Делаем несколько попыток,
    чтобы не падать мгновенно при временном сбое резолва.
    """
    max_attempts = 4
    base_delay_sec = 1.0
    for attempt in range(1, max_attempts + 1):
        try:
            async with engine.begin() as conn:
                db_url = effective_database_url()
                await conn.run_sync(Base.metadata.create_all)
                await ensure_booking_specialist_columns(conn, db_url)
                await ensure_multi_tenant_migration(conn, db_url)
                await ensure_finance_osv_tables(conn, db_url)
                await ensure_sales_kpi_plans(conn, db_url)
                # Тяжёлые chat-индексы/backfill — после ответа health (см. lifespan background).
                await ensure_attendance_tracker_tables(conn, db_url)
                await ensure_super_owner_platform(conn, db_url)
                await ensure_tariff_plans_platform(conn, db_url)
                await ensure_demo_billing_platform(conn, db_url)
                await ensure_tariff_constructor_billing(conn, db_url)
                await ensure_service_catalog_tables(conn, db_url)
                await ensure_lead_extra_phones_tables(conn, db_url)
                await ensure_booking_specialist_directions(conn, db_url)
                await ensure_sales_crm_space_migration(conn, db_url)
                await ensure_sales_field_visits_migration(conn, db_url)
                await ensure_pipeline_stage_automation(conn, db_url)
                await ensure_lead_waiting_callbacks(conn, db_url)
                await ensure_lead_reactivated_at(conn, db_url)
                await ensure_lead_archived_from_stage(conn, db_url)
                await ensure_settle_completed_booking_debts(conn, db_url)
                await ensure_fix_kurs_direction_and_session_pay(conn, db_url)
                await ensure_fix_ayub_massage_prepaid_10x150(conn, db_url)
                await ensure_fix_aug2026_konsult_to_kurs15(conn, db_url)
                await ensure_fix_massage_osv_prepaid_aug2026(conn, db_url)
                await ensure_extra_services_tables(conn, db_url)
            return
        except Exception as exc:
            is_last = attempt == max_attempts
            if is_last:
                raise
            delay = base_delay_sec * attempt
            logger.warning(
                "DB startup attempt %s/%s failed: %s. Retrying in %.1fs",
                attempt,
                max_attempts,
                exc,
                delay,
            )
            await asyncio.sleep(delay)


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


async def ensure_canonical_pipeline_stages() -> None:
    """Лёгкая часть при старте: стадии + бэкфилл меток Архива (без долгого lock пула)."""
    try:
        async with AsyncSessionLocal() as session:
            from app.services.lead_sales_stages import (
                backfill_archived_from_stage,
                ensure_all_pipelines_chat_stages,
            )

            n = await ensure_all_pipelines_chat_stages(session)
            backfilled = await backfill_archived_from_stage(session)
            await session.commit()
            logger.info(
                "Canonical pipeline stages: %s pipeline(s); backfill archived_from=%s",
                n,
                backfilled,
            )
    except Exception:
        logger.exception("ensure_canonical_pipeline_stages failed; continuing startup")


async def ensure_canonical_pipeline_heavy_jobs() -> None:
    """Тяжёлое: дедуп телефонов + раскладка — в фоне после старта API."""
    try:
        async with AsyncSessionLocal() as session:
            from app.services.lead_phone_dedup import merge_duplicate_phone_leads
            from app.services.lead_sales_stages import redistribute_all_pipelines_leads

            dedup = await merge_duplicate_phone_leads(session)
            moved = await redistribute_all_pipelines_leads(session)
            await session.commit()
            logger.info(
                "Canonical heavy jobs: phone_dedup groups=%s removed=%s threads=%s; redistributed %s lead(s)",
                dedup.get("merged_groups"),
                dedup.get("removed_leads"),
                dedup.get("moved_threads"),
                moved,
            )
    except Exception:
        logger.exception("ensure_canonical_pipeline_heavy_jobs failed")


TEST_ADMIN_EMAIL = "admin@crm.local"
TEST_SUPER_OWNER_EMAIL = "super@crm.local"


async def seed_test_admin() -> None:
    """Ensure known local owner seed stays usable: admin@crm.local / admin."""
    async with AsyncSessionLocal() as session:
        cid = await _ensure_default_company(session)
        result = await session.execute(select(User).where(User.email == TEST_ADMIN_EMAIL))
        user = result.scalar_one_or_none()
        if user is None:
            session.add(
                User(
                    email=TEST_ADMIN_EMAIL,
                    hashed_password=hash_password("admin"),
                    role=UserRole.owner,
                    company_id=cid,
                    full_name="Админ",
                    must_change_password=False,
                    is_active=True,
                )
            )
            await session.commit()
            return

        # Old seed skipped existing rows; restore documented credentials if drift.
        dirty = False
        if not verify_password("admin", user.hashed_password):
            user.hashed_password = hash_password("admin")
            dirty = True
        if user.role != UserRole.owner:
            user.role = UserRole.owner
            dirty = True
        if getattr(user, "must_change_password", False):
            user.must_change_password = False
            dirty = True
        if not user.is_active:
            user.is_active = True
            dirty = True
        if not (user.full_name or "").strip():
            user.full_name = "Админ"
            dirty = True
        if user.company_id is None:
            user.company_id = cid
            dirty = True
        if dirty:
            await session.commit()


async def seed_super_owner() -> None:
    """Ensure known platform seed stays usable: super@crm.local / admin."""
    async with AsyncSessionLocal() as session:
        result = await session.execute(select(User).where(User.email == TEST_SUPER_OWNER_EMAIL))
        user = result.scalar_one_or_none()
        if user is None:
            session.add(
                User(
                    email=TEST_SUPER_OWNER_EMAIL,
                    hashed_password=hash_password("admin"),
                    role=UserRole.super_owner,
                    company_id=None,
                    must_change_password=False,
                    is_active=True,
                )
            )
            await session.commit()
            return

        dirty = False
        if not verify_password("admin", user.hashed_password):
            user.hashed_password = hash_password("admin")
            dirty = True
        if user.role != UserRole.super_owner:
            user.role = UserRole.super_owner
            dirty = True
        if getattr(user, "must_change_password", False):
            user.must_change_password = False
            dirty = True
        if not user.is_active:
            user.is_active = True
            dirty = True
        if dirty:
            await session.commit()


async def seed_booking_defaults() -> None:
    async with AsyncSessionLocal() as session:
        from app.services.booking_directions import archive_hidden_booking_directions

        cid = await _ensure_default_company(session)
        await archive_hidden_booking_directions(session)
        result = await session.execute(select(BookingDirection).where(BookingDirection.company_id == cid).limit(1))
        if result.scalar_one_or_none() is not None:
            await session.commit()
            return
        d = BookingDirection(name="Консультация", duration_min=30, is_active=True, company_id=cid)
        session.add(d)
        await session.flush()
        session.add(
            BookingSpecialist(
                full_name="Специалист (пример)",
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
        defaults = ["GREEN API", "WHATSAPP", "INSTAGRAM", "TELEGRAM", "GOOGLE SHEETS"]
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


SALES_COMPANY_NAME = "MetodiOne Продажи"
SALES_OWNER_EMAIL = "admin@sales.local"
SALES_OWNER_PASSWORD = "D711711"


async def seed_sales_crm_space() -> None:
    """Второе изолированное CRM-пространство продаж: admin / D711711 (+ онлайн-запись для «Удачно»)."""
    try:
        await _seed_sales_crm_space_inner()
    except IntegrityError:
        logger.exception(
            "seed_sales_crm_space: integrity error (likely duplicate booking direction); continuing startup",
        )


async def _seed_sales_crm_space_inner() -> None:
    async with AsyncSessionLocal() as session:
        company = (
            await session.execute(select(Company).where(Company.name == SALES_COMPANY_NAME).limit(1))
        ).scalars().first()
        if company is None:
            company = Company(
                name=SALES_COMPANY_NAME,
                is_active=True,
                crm_mode="sales",
                billing_status="active",
            )
            session.add(company)
            await session.flush()
        else:
            if getattr(company, "crm_mode", None) != "sales":
                company.crm_mode = "sales"
            if not company.is_active:
                company.is_active = True

        cid = int(company.id)

        pipe = (
            await session.execute(
                select(Pipeline).where(Pipeline.company_id == cid).order_by(Pipeline.id.asc()).limit(1),
            )
        ).scalars().first()
        if pipe is None:
            pipe = Pipeline(name="Основная", type="sales", company_id=cid)
            session.add(pipe)
            await session.flush()
            for st in default_pipeline_stage_creates(crm_mode="sales"):
                session.add(
                    PipelineStage(
                        name=st.name,
                        order=st.order if st.order is not None else 0,
                        color=st.color,
                        pipeline_id=pipe.id,
                        company_id=cid,
                    ),
                )
        else:
            from app.services.lead_sales_stages import ensure_sales_pipeline_chat_stages

            await ensure_sales_pipeline_chat_stages(session, company_id=cid, pipeline_id=int(pipe.id))

        # Продажи — без онлайн-записи: KPI/факт из окна «Продажи».
        # Не создаём сиды записи; старые заглушки деактивируем, чтобы не всплывали в KPI.
        for stub_dir in (
            await session.execute(
                select(BookingDirection).where(
                    BookingDirection.company_id == cid,
                    BookingDirection.name == "Консультация (продажи)",
                ),
            )
        ).scalars().all():
            stub_dir.is_active = False
        for stub_spec in (
            await session.execute(
                select(BookingSpecialist).where(
                    BookingSpecialist.company_id == cid,
                    BookingSpecialist.full_name == "Специалист (пример)",
                ),
            )
        ).scalars().all():
            stub_spec.is_active = False

        defaults = ["GREEN API", "WHATSAPP", "INSTAGRAM", "TELEGRAM", "GOOGLE SHEETS"]
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

        user = (
            await session.execute(
                select(User).where(User.email == SALES_OWNER_EMAIL, User.company_id == cid).limit(1),
            )
        ).scalars().first()
        if user is None:
            # на случай старой глобальной уникальности — ищем по email
            user = (
                await session.execute(select(User).where(User.email == SALES_OWNER_EMAIL).limit(1))
            ).scalars().first()
        if user is None:
            session.add(
                User(
                    email=SALES_OWNER_EMAIL,
                    hashed_password=hash_password(SALES_OWNER_PASSWORD),
                    role=UserRole.owner,
                    company_id=cid,
                    full_name="Владелец (продажи)",
                    must_change_password=False,
                    is_active=True,
                ),
            )
        else:
            dirty = False
            if user.company_id != cid:
                user.company_id = cid
                dirty = True
            if user.role != UserRole.owner:
                user.role = UserRole.owner
                dirty = True
            if not verify_password(SALES_OWNER_PASSWORD, user.hashed_password):
                user.hashed_password = hash_password(SALES_OWNER_PASSWORD)
                dirty = True
            if getattr(user, "must_change_password", False):
                user.must_change_password = False
                dirty = True
            if not user.is_active:
                user.is_active = True
                dirty = True
            if dirty:
                pass
        await session.commit()


async def _ensure_default_company(session: AsyncSession) -> int:
    c = (await session.execute(select(Company).order_by(Company.id.asc()).limit(1))).scalars().first()
    if c is not None:
        if not getattr(c, "crm_mode", None):
            c.crm_mode = "clinic"
        return int(c.id)
    c = Company(name="Default Company", is_active=True, crm_mode="clinic")
    session.add(c)
    await session.flush()
    return int(c.id)


@asynccontextmanager
async def lifespan(_: FastAPI):
    _install_asyncio_dns_exception_handler()
    try:
        await _run_startup_migrations_with_retry()
    except Exception as exc:
        # Не валим весь API (Amvera 503): /health и /health/db должны отвечать.
        logger.exception("startup migrations failed (API still starts): %s", exc)
    try:
        # enum-миграции PostgreSQL нельзя выполнять внутри begin-транзакции.
        # Для надёжности запускаем каждую миграцию на отдельном "свежем" connection.
        async with engine.connect() as conn:
            await ensure_owner_role_migration(conn, settings.database_url)
        async with engine.connect() as conn:
            await ensure_integration_provider_migration(conn, settings.database_url)
        async with engine.connect() as conn:
            await ensure_clinic_staff_roles(conn, settings.database_url)
        await seed_pipelines_and_stages()
        await seed_test_admin()
        await seed_super_owner()
        await seed_booking_defaults()
        await seed_lead_sources_defaults()
        await seed_sales_crm_space()
        await ensure_canonical_pipeline_stages()
    except Exception as exc:
        logger.exception("startup seed/enum failed (API still starts): %s", exc)
    stop_event = asyncio.Event()

    async def _deferred_chat_indexes() -> None:
        try:
            await asyncio.sleep(2)
            async with engine.begin() as conn:
                await ensure_chat_performance_indexes(conn, effective_database_url())
        except Exception:
            logger.exception("deferred chat performance indexes failed")

    async def _deferred_canonical_heavy() -> None:
        try:
            await asyncio.sleep(5)
            await ensure_canonical_pipeline_heavy_jobs()
        except Exception:
            logger.exception("deferred canonical heavy jobs failed")

    deferred_chat_task = asyncio.create_task(_deferred_chat_indexes())
    deferred_heavy_task = asyncio.create_task(_deferred_canonical_heavy())

    async def _reminder_loop() -> None:
        next_sheets_run = 0.0
        try:
            await asyncio.sleep(8)
        except asyncio.CancelledError:
            return
        while not stop_event.is_set():
            try:
                async with AsyncSessionLocal() as session:
                    sent = await run_whatsapp_reminder_tick(session)
                    waiting_sent = await run_waiting_callback_tick(session)
                    archive_evening = await run_archive_evening_reactivate_tick(session)
                    await session.commit()
                    if sent:
                        logger.info("whatsapp reminders sent: %s", sent)
                    if sent:
                        record_background_event(
                            source="whatsapp_reminders",
                            ok=True,
                            message=f"Отправлено напоминаний/сообщений: {sent}",
                        )
                    if waiting_sent:
                        logger.info("waiting callbacks acted: %s", waiting_sent)
                        record_background_event(
                            source="waiting_callbacks",
                            ok=True,
                            message=f"Обработано callback «В ожидании»: {waiting_sent}",
                        )
                    if archive_evening:
                        logger.info("archive daytime reactivate: %s", archive_evening)
                        record_background_event(
                            source="archive_evening_reactivate",
                            ok=True,
                            message=f"Дневная раздача из Архива: {archive_evening} лидов",
                        )
                    now = asyncio.get_running_loop().time()
                    if now >= next_sheets_run:
                        try:
                            synced = await run_google_sheets_import_tick(session)
                            finance_synced = await run_finance_sheets_sync_tick(session)
                            await session.commit()
                            if synced:
                                logger.info("google sheets sync tick: integrations=%s", synced)
                                record_background_event(
                                    source="google_sheets",
                                    ok=True,
                                    message=f"Тик Google Sheets обработал интеграций: {synced}",
                                )
                            if finance_synced:
                                logger.info("finance osv sheets sync tick: companies=%s", finance_synced)
                                record_background_event(
                                    source="finance_sheets",
                                    ok=True,
                                    message=f"Синхронизировано таблиц ОСВ: {finance_synced}",
                                )
                        except Exception as sheets_exc:
                            # OAuth мог пройти, а sheets.googleapis.com — отвалиться по сети.
                            # Не помечаем весь background tick как ERROR (Amvera шлёт алерт).
                            logger.warning("google sheets tick skipped due to error: %s", sheets_exc)
                            record_background_event(
                                source="google_sheets",
                                ok=False,
                                message=str(sheets_exc)[:400],
                            )
                            try:
                                await session.rollback()
                            except Exception:
                                pass
                        period = max(int(settings.google_sheets_poll_seconds), 30)
                        next_sheets_run = now + float(period)
            except Exception as exc:
                logger.exception("background tick failed")
                record_background_event(
                    source="background_tick",
                    ok=False,
                    message=str(exc)[:400],
                )
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
    deferred_chat_task.cancel()
    deferred_heavy_task.cancel()
    try:
        await reminder_task
    except asyncio.CancelledError:
        pass
    try:
        await deferred_chat_task
    except asyncio.CancelledError:
        pass
    try:
        await deferred_heavy_task
    except asyncio.CancelledError:
        pass
    await engine.dispose()


app = FastAPI(title="CRM API", version="0.1.0", lifespan=lifespan)


@app.exception_handler(IntegrityError)
async def integrity_error_handler(_request: Request, exc: IntegrityError) -> JSONResponse:
    """DB unique/FK races must never surface as raw 500 HTML to the CRM UI."""
    raw = str(getattr(exc, "orig", None) or exc)
    detail = "Конфликт данных (запись с такими уникальными полями уже есть)"
    if "booking_directions_name_key" in raw or "booking_directions" in raw and "name" in raw:
        detail = "Уже есть направление с таким названием (без учёта регистра)"
    return JSONResponse(status_code=409, content={"detail": detail})


@app.exception_handler(Exception)
async def unhandled_api_exception_handler(request: Request, exc: Exception) -> JSONResponse:
    """API 500 as JSON with a short reason (helps debug Amvera without log access)."""
    logger.exception("unhandled error on %s %s", request.method, request.url.path)
    raw = str(exc) or exc.__class__.__name__
    detail = raw.replace("\n", " ")[:300]
    if "password" in detail.lower() or "secret" in detail.lower():
        detail = exc.__class__.__name__
    return JSONResponse(
        status_code=500,
        content={"detail": detail, "error_type": exc.__class__.__name__},
    )

app.add_middleware(RequestIdMiddleware)
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.middleware("http")
async def enforce_must_change_password(request: Request, call_next):  # type: ignore[no-untyped-def]
    """Пока в JWT must_change_password=true — доступ только к смене пароля и /me."""
    if request.method == "OPTIONS":
        return await call_next(request)
    path = request.url.path
    if not path.startswith("/api/"):
        return await call_next(request)
    if path in ("/api/auth/login", "/api/auth/register", "/api/auth/demo-login"):
        return await call_next(request)
    auth = request.headers.get("Authorization")
    if not auth or not auth.lower().startswith("bearer "):
        return await call_next(request)
    token = auth.split(" ", 1)[1].strip()
    if not token:
        return await call_next(request)
    try:
        payload = decode_token(token)
    except Exception:
        return await call_next(request)
    if payload.get("must_change_password") is True:
        allowed = {("/api/auth/me", "GET"), ("/api/auth/change-password", "POST")}
        if (path, request.method) not in allowed:
            return JSONResponse(
                status_code=403,
                content={"detail": "Требуется смена пароля. Откройте форму смены пароля или вызовите POST /api/auth/change-password"},
            )
    return await call_next(request)


@app.middleware("http")
async def enforce_tariff_feature_path(request: Request, call_next):  # type: ignore[no-untyped-def]
    """Тарифное ограничение API отключено — все функции доступны в рамках компании."""
    return await call_next(request)
    if request.method == "OPTIONS":
        return await call_next(request)
    path = request.url.path
    if not path.startswith("/api/"):
        return await call_next(request)
    from app.services.tariff_catalog import tariff_feature_for_api_path

    feature_key = tariff_feature_for_api_path(path)
    if feature_key is None:
        return await call_next(request)
    if path.startswith("/api/auth/"):
        return await call_next(request)
    if path.startswith("/api/companies"):
        return await call_next(request)
    if path.startswith("/api/tariff-plans"):
        return await call_next(request)
    if path.startswith("/api/system"):
        return await call_next(request)
    if path.startswith("/api/billing"):
        return await call_next(request)
    auth = request.headers.get("Authorization")
    if not auth or not auth.lower().startswith("bearer "):
        return await call_next(request)
    token = auth.split(" ", 1)[1].strip()
    if not token:
        return await call_next(request)
    try:
        payload = decode_token(token)
    except Exception:
        return await call_next(request)
    if payload.get("role") == "super_owner":
        return await call_next(request)
    raw_cid = request.headers.get("X-Company-Id")
    if not raw_cid:
        return await call_next(request)
    try:
        company_id = int(raw_cid)
    except ValueError:
        return await call_next(request)
    from app.database import AsyncSessionLocal
    from app.services.tariff_plan_access import company_has_tariff_feature, plan_names_including_feature, tariff_block_detail

    async with AsyncSessionLocal() as db:
        ok = await company_has_tariff_feature(db, company_id, feature_key)
        if ok:
            return await call_next(request)
        names = await plan_names_including_feature(db, feature_key)
        detail = tariff_block_detail(feature_key, names)
    return JSONResponse(status_code=403, content={"detail": detail})


@app.middleware("http")
async def enforce_company_billing(request: Request, call_next):  # type: ignore[no-untyped-def]
    """Биллинг-блокировка API отключена."""
    return await call_next(request)
    if request.method == "OPTIONS":
        return await call_next(request)
    path = request.url.path
    if not path.startswith("/api/"):
        return await call_next(request)

    def _billing_allowed() -> bool:
        if path.startswith("/api/auth/"):
            return True
        if path.startswith("/api/billing/"):
            return True
        if path == "/api/system/tariff-access" and request.method == "GET":
            return True
        if path == "/api/system/tariff" and request.method == "GET":
            return True
        if path == "/api/companies/current" and request.method == "GET":
            return True
        return False

    auth = request.headers.get("Authorization")
    if not auth or not auth.lower().startswith("bearer "):
        return await call_next(request)
    token = auth.split(" ", 1)[1].strip()
    if not token:
        return await call_next(request)
    try:
        payload = decode_token(token)
    except Exception:
        return await call_next(request)
    if payload.get("role") == "super_owner":
        return await call_next(request)
    raw_cid = request.headers.get("X-Company-Id")
    if not raw_cid:
        return await call_next(request)
    try:
        company_id = int(raw_cid)
    except ValueError:
        return await call_next(request)

    from app.database import AsyncSessionLocal
    from app.services.company_billing import company_api_blocked_by_billing, refresh_company_billing_state

    async with AsyncSessionLocal() as db:
        c = await refresh_company_billing_state(db, company_id)
        if c is None:
            await db.rollback()
            return await call_next(request)
        blocked = company_api_blocked_by_billing(c)
        await db.commit()

    if not blocked:
        return await call_next(request)
    if _billing_allowed():
        return await call_next(request)
    return JSONResponse(
        status_code=403,
        content={
            "detail": (
                "Доступ ограничен: срок демо истёк или ожидается подтверждение оплаты. "
                "Откройте раздел «Оплата и тариф» и выберите тариф."
            ),
            "code": "billing_blocked",
        },
    )


@app.middleware("http")
async def collect_runtime_metrics(request, call_next):  # type: ignore[no-untyped-def]
    started = time.perf_counter()
    runtime_metrics.request_started()
    status_code = 500
    try:
        response = await call_next(request)
        status_code = int(response.status_code)
        return response
    finally:
        elapsed_ms = (time.perf_counter() - started) * 1000.0
        runtime_metrics.request_finished(
            path=request.url.path,
            status_code=status_code,
            duration_ms=elapsed_ms,
        )

app.include_router(auth.router, prefix="/api")
app.include_router(leads.router, prefix="/api")
app.include_router(pipelines.router, prefix="/api")
app.include_router(stages.router, prefix="/api")
app.include_router(tasks.router, prefix="/api")
app.include_router(analytics.router, prefix="/api")
app.include_router(sales_kpi.router, prefix="/api")
app.include_router(sales_kpi_board.router, prefix="/api")
app.include_router(manager_desk_sales.router, prefix="/api")
app.include_router(quote_calculator.router, prefix="/api")
app.include_router(sales_field_visits.router, prefix="/api")
app.include_router(booking.router, prefix="/api")
app.include_router(deals.router, prefix="/api")
app.include_router(users.router, prefix="/api")
app.include_router(sources.router, prefix="/api")
app.include_router(integrations.router, prefix="/api")
app.include_router(employees.router, prefix="/api")
app.include_router(system.router, prefix="/api")
app.include_router(billing.router, prefix="/api")
app.include_router(chat.router, prefix="/api")
app.include_router(audit.router, prefix="/api")
app.include_router(reports.router, prefix="/api")
app.include_router(companies.router, prefix="/api")
app.include_router(tariff_plans.router, prefix="/api")
app.include_router(finance.router, prefix="/api")
app.include_router(team_chat.router, prefix="/api")
app.include_router(waiting_callbacks.router, prefix="/api")
app.include_router(extra_services.router, prefix="/api")


@app.get("/health")
async def health():
    return {"status": "ok", "build": settings.build_version}


@app.get("/health/db")
async def health_db():
    """Проверка БД без auth — диагностика Amvera 500 на /demo и /login."""
    from sqlalchemy import text

    from app.database import AsyncSessionLocal, effective_database_url

    url = effective_database_url()
    dialect = "sqlite" if "sqlite" in url.lower() else ("postgres" if "postgres" in url.lower() else "other")
    db_host = None
    db_port = None
    db_name = None
    try:
        from sqlalchemy.engine.url import make_url as _make_url
        _parsed = _make_url(url)
        db_host = _parsed.host
        db_port = int(_parsed.port) if _parsed.port else None
        db_name = _parsed.database
    except Exception:
        pass
    pool_status = ""
    try:
        pool_status = engine.sync_engine.pool.status()
    except Exception:
        pool_status = "unavailable"
    try:
        async with AsyncSessionLocal() as session:
            one = await session.scalar(text("SELECT 1"))
            user_n = await session.scalar(text("SELECT COUNT(*) FROM users"))
        return {
            "status": "ok",
            "dialect": dialect,
            "host": db_host,
            "port": db_port,
            "database": db_name,
            "select_1": int(one or 0),
            "users": int(user_n or 0),
            "db_pool": pool_status,
            "build": settings.build_version,
        }
    except Exception as exc:  # noqa: BLE001
        logger.exception("health_db failed")
        raw = str(exc).replace("\n", " ")[:300]
        if "password" in raw.lower():
            raw = exc.__class__.__name__
        return JSONResponse(
            status_code=503,
            content={
                "status": "error",
                "dialect": dialect,
                "host": db_host,
                "port": db_port,
                "database": db_name,
                "db_pool": pool_status,
                "error_type": exc.__class__.__name__,
                "detail": raw,
                "build": settings.build_version,
            },
        )


@app.get("/health/metrics")
async def health_metrics():
    pool_status = ""
    try:
        pool_status = engine.sync_engine.pool.status()
    except Exception:
        pool_status = "pool-status-unavailable"
    return runtime_metrics.snapshot(
        extra={
            "build": settings.build_version,
            "db_pool": pool_status,
        }
    )
