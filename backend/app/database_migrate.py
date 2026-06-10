"""Лёгкие правки схемы без Alembic (SQLite / PostgreSQL)."""

import json

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncConnection


async def ensure_booking_specialist_columns(conn: AsyncConnection, database_url: str) -> None:
    if "sqlite" in database_url:
        # integrations table (simple CREATE TABLE IF NOT EXISTS for existing DBs)
        await conn.execute(
            text(
                """CREATE TABLE IF NOT EXISTS integrations (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    name VARCHAR(120) NOT NULL,
                    provider VARCHAR(40) NOT NULL,
                    is_active INTEGER NOT NULL DEFAULT 1,
                    pipeline_id INTEGER NOT NULL,
                    stage_id INTEGER NOT NULL,
                    secret VARCHAR(128) NOT NULL,
                    config TEXT,
                    created_at DATETIME
                )"""
            )
        )

        r = await conn.execute(text("PRAGMA table_info(integrations)"))
        integ_cols = {row[1] for row in r.fetchall()}
        if integ_cols and "manager_close_deal_enabled" not in integ_cols:
            await conn.execute(
                text(
                    "ALTER TABLE integrations ADD COLUMN manager_close_deal_enabled INTEGER NOT NULL DEFAULT 0",
                ),
            )

        # pipeline_stages.pipeline_id (multi-pipeline UI)
        r = await conn.execute(text("PRAGMA table_info(pipeline_stages)"))
        cols = {row[1] for row in r.fetchall()}
        if "pipeline_id" not in cols:
            await conn.execute(text("ALTER TABLE pipeline_stages ADD COLUMN pipeline_id INTEGER"))

        # deals: cart + protocol fields
        r = await conn.execute(text("PRAGMA table_info(deals)"))
        deal_cols = {row[1] for row in r.fetchall()}
        if "deal_type" not in deal_cols:
            await conn.execute(
                text("ALTER TABLE deals ADD COLUMN deal_type VARCHAR(64) NOT NULL DEFAULT 'extra'"),
            )
        if "paid_amount" not in deal_cols:
            await conn.execute(
                text("ALTER TABLE deals ADD COLUMN paid_amount NUMERIC(14, 2) NOT NULL DEFAULT 0"),
            )
        if "is_protocol" not in deal_cols:
            await conn.execute(
                text("ALTER TABLE deals ADD COLUMN is_protocol INTEGER NOT NULL DEFAULT 0"),
            )
        if "protocol_requested" not in deal_cols:
            await conn.execute(
                text("ALTER TABLE deals ADD COLUMN protocol_requested INTEGER NOT NULL DEFAULT 0"),
            )
        if "protocol_confirmed" not in deal_cols:
            await conn.execute(
                text("ALTER TABLE deals ADD COLUMN protocol_confirmed INTEGER NOT NULL DEFAULT 0"),
            )
        if "protocol_file_path" not in deal_cols:
            await conn.execute(text("ALTER TABLE deals ADD COLUMN protocol_file_path TEXT"))

        # leads: refusal_reason
        r = await conn.execute(text("PRAGMA table_info(leads)"))
        lead_cols = {row[1] for row in r.fetchall()}
        if "refusal_reason" not in lead_cols:
            await conn.execute(text("ALTER TABLE leads ADD COLUMN refusal_reason TEXT"))

        # users: phone, full_name, invite_token
        r = await conn.execute(text("PRAGMA table_info(users)"))
        user_cols = {row[1] for row in r.fetchall()}
        if "phone" not in user_cols:
            await conn.execute(text("ALTER TABLE users ADD COLUMN phone VARCHAR(32)"))
        if "full_name" not in user_cols:
            await conn.execute(text("ALTER TABLE users ADD COLUMN full_name VARCHAR(255)"))
        if "invite_token" not in user_cols:
            await conn.execute(text("ALTER TABLE users ADD COLUMN invite_token VARCHAR(96)"))
        if "is_active" not in user_cols:
            await conn.execute(text("ALTER TABLE users ADD COLUMN is_active INTEGER NOT NULL DEFAULT 1"))

        await conn.execute(
            text(
                """CREATE TABLE IF NOT EXISTS user_pipeline_assignments (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    user_id INTEGER NOT NULL,
                    pipeline_id INTEGER NOT NULL
                )"""
            )
        )
        await conn.execute(
            text(
                """CREATE TABLE IF NOT EXISTS chat_threads (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    lead_id INTEGER,
                    pipeline_id INTEGER,
                    provider VARCHAR(40) NOT NULL DEFAULT 'green_api',
                    external_chat_id VARCHAR(128),
                    title VARCHAR(255),
                    created_at DATETIME,
                    updated_at DATETIME
                )"""
            )
        )
        await conn.execute(
            text(
                """CREATE TABLE IF NOT EXISTS chat_messages (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    thread_id INTEGER NOT NULL,
                    author_user_id INTEGER,
                    direction VARCHAR(8) NOT NULL DEFAULT 'in',
                    text TEXT NOT NULL,
                    provider_message_id VARCHAR(128),
                    delivery_status VARCHAR(24) NOT NULL DEFAULT 'sent',
                    created_at DATETIME
                )"""
            )
        )
        await conn.execute(
            text(
                """CREATE TABLE IF NOT EXISTS chat_thread_user_reads (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                    thread_id INTEGER NOT NULL REFERENCES chat_threads(id) ON DELETE CASCADE,
                    last_read_message_id INTEGER NOT NULL DEFAULT 0,
                    UNIQUE(user_id, thread_id)
                )"""
            )
        )

        r = await conn.execute(text("PRAGMA table_info(booking_specialists)"))
        cols = {row[1] for row in r.fetchall()}
        added_sort_order = False

        if "specialization" not in cols:
            await conn.execute(text("ALTER TABLE booking_specialists ADD COLUMN specialization VARCHAR(255)"))
        if "sort_order" not in cols:
            await conn.execute(
                text("ALTER TABLE booking_specialists ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0"),
            )
            added_sort_order = True
        if "work_start_hour" not in cols:
            await conn.execute(
                text("ALTER TABLE booking_specialists ADD COLUMN work_start_hour INTEGER NOT NULL DEFAULT 9"),
            )
        if "slot_duration_min" not in cols:
            await conn.execute(
                text("ALTER TABLE booking_specialists ADD COLUMN slot_duration_min INTEGER NOT NULL DEFAULT 30"),
            )
        if "work_end_hour" not in cols:
            await conn.execute(
                text("ALTER TABLE booking_specialists ADD COLUMN work_end_hour INTEGER NOT NULL DEFAULT 18"),
            )
        if "work_weekdays" not in cols:
            await conn.execute(text("ALTER TABLE booking_specialists ADD COLUMN work_weekdays TEXT"))
        if "crm_user_id" not in cols:
            await conn.execute(
                text("ALTER TABLE booking_specialists ADD COLUMN crm_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL"),
            )
            await conn.execute(
                text(
                    "CREATE UNIQUE INDEX IF NOT EXISTS uq_booking_specialists_crm_user_id ON booking_specialists(crm_user_id) WHERE crm_user_id IS NOT NULL",
                ),
            )
        r = await conn.execute(text("PRAGMA table_info(booking_specialists)"))
        cols = {row[1] for row in r.fetchall()}
        if "course_streams_enabled" not in cols:
            await conn.execute(
                text("ALTER TABLE booking_specialists ADD COLUMN course_streams_enabled INTEGER NOT NULL DEFAULT 0"),
            )
        if "course_stream_max_days" not in cols:
            await conn.execute(
                text("ALTER TABLE booking_specialists ADD COLUMN course_stream_max_days INTEGER NOT NULL DEFAULT 15"),
            )
        if "course_stream_min_day_for_next" not in cols:
            await conn.execute(
                text(
                    "ALTER TABLE booking_specialists ADD COLUMN course_stream_min_day_for_next INTEGER NOT NULL DEFAULT 10",
                ),
            )
        if "course_stream_gap_days" not in cols:
            await conn.execute(
                text("ALTER TABLE booking_specialists ADD COLUMN course_stream_gap_days INTEGER NOT NULL DEFAULT 10"),
            )

        if added_sort_order:
            await conn.execute(text("UPDATE booking_specialists SET sort_order = id"))

        default_wd = json.dumps([0, 1, 2, 3, 4])
        await conn.execute(
            text(
                "UPDATE booking_specialists SET work_weekdays = :wd WHERE work_weekdays IS NULL OR TRIM(work_weekdays) = ''",
            ),
            {"wd": default_wd},
        )
        await conn.execute(
            text(
                """UPDATE booking_specialists SET sort_order = id
                   WHERE NOT EXISTS (SELECT 1 FROM booking_specialists s WHERE s.sort_order > 0)""",
            ),
        )

        r = await conn.execute(text("PRAGMA table_info(pipelines)"))
        pipe_cols = {row[1] for row in r.fetchall()}
        if pipe_cols and "lead_assignment_mode" not in pipe_cols:
            await conn.execute(
                text(
                    "ALTER TABLE pipelines ADD COLUMN lead_assignment_mode VARCHAR(32) NOT NULL DEFAULT 'none'",
                ),
            )
        if pipe_cols and "assignment_rr_counter" not in pipe_cols:
            await conn.execute(
                text("ALTER TABLE pipelines ADD COLUMN assignment_rr_counter INTEGER NOT NULL DEFAULT 0"),
            )
        if pipe_cols and "expert_user_id" not in pipe_cols:
            await conn.execute(
                text("ALTER TABLE pipelines ADD COLUMN expert_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL"),
            )
        if pipe_cols and "intake_manager_user_id" not in pipe_cols:
            await conn.execute(
                text(
                    "ALTER TABLE pipelines ADD COLUMN intake_manager_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL",
                ),
            )
        if pipe_cols and "manager_allowed_outbound_phones" not in pipe_cols:
            await conn.execute(text("ALTER TABLE pipelines ADD COLUMN manager_allowed_outbound_phones TEXT"))

        r = await conn.execute(text("PRAGMA table_info(chat_messages)"))
        cm_cols = {row[1] for row in r.fetchall()}
        if cm_cols and "message_type" not in cm_cols:
            await conn.execute(
                text("ALTER TABLE chat_messages ADD COLUMN message_type VARCHAR(24) NOT NULL DEFAULT 'text'"),
            )
        if cm_cols and "media_url" not in cm_cols:
            await conn.execute(text("ALTER TABLE chat_messages ADD COLUMN media_url TEXT"))
        if cm_cols and "media_mime" not in cm_cols:
            await conn.execute(text("ALTER TABLE chat_messages ADD COLUMN media_mime VARCHAR(128)"))
        if cm_cols and "file_name" not in cm_cols:
            await conn.execute(text("ALTER TABLE chat_messages ADD COLUMN file_name VARCHAR(255)"))

        r = await conn.execute(text("PRAGMA table_info(booking_appointments)"))
        ba_cols = {row[1] for row in r.fetchall()}
        if ba_cols and "pipeline_id" not in ba_cols:
            await conn.execute(
                text("ALTER TABLE booking_appointments ADD COLUMN pipeline_id INTEGER REFERENCES pipelines(id) ON DELETE SET NULL"),
            )
        if ba_cols and "service_amount" not in ba_cols:
            await conn.execute(
                text("ALTER TABLE booking_appointments ADD COLUMN service_amount NUMERIC(14, 2) NOT NULL DEFAULT 0"),
            )
        if ba_cols and "paid_amount" not in ba_cols:
            await conn.execute(
                text("ALTER TABLE booking_appointments ADD COLUMN paid_amount NUMERIC(14, 2) NOT NULL DEFAULT 0"),
            )
        if ba_cols and "service_title" not in ba_cols:
            await conn.execute(text("ALTER TABLE booking_appointments ADD COLUMN service_title VARCHAR(500)"))
        await conn.execute(
            text(
                """UPDATE booking_appointments
                   SET pipeline_id = (
                       SELECT ps.pipeline_id
                       FROM leads l
                       LEFT JOIN pipeline_stages ps ON ps.id = l.status_id
                       WHERE l.id = booking_appointments.lead_id
                   )
                   WHERE pipeline_id IS NULL""",
            ),
        )
        r = await conn.execute(text("PRAGMA table_info(booking_directions)"))
        bd_cols = {row[1] for row in r.fetchall()}
        if bd_cols and "pipeline_id" not in bd_cols:
            await conn.execute(
                text("ALTER TABLE booking_directions ADD COLUMN pipeline_id INTEGER REFERENCES pipelines(id) ON DELETE SET NULL"),
            )
        await conn.execute(
            text(
                """UPDATE booking_directions
                   SET pipeline_id = (
                       SELECT id FROM pipelines p
                       WHERE p.company_id = booking_directions.company_id
                       ORDER BY p.id ASC
                       LIMIT 1
                   )
                   WHERE pipeline_id IS NULL""",
            ),
        )
        return

    if "postgresql" in database_url or "asyncpg" in database_url:
        await conn.execute(
            text(
                """CREATE TABLE IF NOT EXISTS integrations (
                    id SERIAL PRIMARY KEY,
                    name VARCHAR(120) NOT NULL,
                    provider VARCHAR(40) NOT NULL,
                    is_active BOOLEAN NOT NULL DEFAULT TRUE,
                    pipeline_id INTEGER NOT NULL,
                    stage_id INTEGER NOT NULL,
                    secret VARCHAR(128) NOT NULL,
                    config JSONB,
                    created_at TIMESTAMPTZ
                )"""
            )
        )
        await conn.execute(
            text(
                "ALTER TABLE integrations ADD COLUMN IF NOT EXISTS manager_close_deal_enabled BOOLEAN NOT NULL DEFAULT FALSE",
            ),
        )
        await conn.execute(
            text("ALTER TABLE pipeline_stages ADD COLUMN IF NOT EXISTS pipeline_id INTEGER"),
        )
        await conn.execute(
            text("ALTER TABLE deals ADD COLUMN IF NOT EXISTS deal_type VARCHAR(64) NOT NULL DEFAULT 'extra'"),
        )
        await conn.execute(
            text("ALTER TABLE deals ADD COLUMN IF NOT EXISTS paid_amount NUMERIC(14, 2) NOT NULL DEFAULT 0"),
        )
        await conn.execute(
            text("ALTER TABLE deals ADD COLUMN IF NOT EXISTS is_protocol BOOLEAN NOT NULL DEFAULT FALSE"),
        )
        await conn.execute(
            text("ALTER TABLE deals ADD COLUMN IF NOT EXISTS protocol_requested BOOLEAN NOT NULL DEFAULT FALSE"),
        )
        await conn.execute(
            text("ALTER TABLE deals ADD COLUMN IF NOT EXISTS protocol_confirmed BOOLEAN NOT NULL DEFAULT FALSE"),
        )
        await conn.execute(
            text("ALTER TABLE deals ADD COLUMN IF NOT EXISTS protocol_file_path TEXT"),
        )
        await conn.execute(
            text("ALTER TABLE leads ADD COLUMN IF NOT EXISTS refusal_reason TEXT"),
        )
        await conn.execute(text("ALTER TABLE users ADD COLUMN IF NOT EXISTS phone VARCHAR(32)"))
        await conn.execute(text("ALTER TABLE users ADD COLUMN IF NOT EXISTS full_name VARCHAR(255)"))
        await conn.execute(text("ALTER TABLE users ADD COLUMN IF NOT EXISTS invite_token VARCHAR(96)"))
        await conn.execute(text("ALTER TABLE users ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE"))
        await conn.execute(
            text(
                """CREATE TABLE IF NOT EXISTS user_pipeline_assignments (
                    id SERIAL PRIMARY KEY,
                    user_id INTEGER NOT NULL,
                    pipeline_id INTEGER NOT NULL
                )"""
            )
        )
        await conn.execute(
            text(
                """CREATE TABLE IF NOT EXISTS chat_threads (
                    id SERIAL PRIMARY KEY,
                    lead_id INTEGER,
                    pipeline_id INTEGER,
                    provider VARCHAR(40) NOT NULL DEFAULT 'green_api',
                    external_chat_id VARCHAR(128),
                    title VARCHAR(255),
                    created_at TIMESTAMPTZ,
                    updated_at TIMESTAMPTZ
                )"""
            )
        )
        await conn.execute(
            text(
                """CREATE TABLE IF NOT EXISTS chat_messages (
                    id SERIAL PRIMARY KEY,
                    thread_id INTEGER NOT NULL,
                    author_user_id INTEGER,
                    direction VARCHAR(8) NOT NULL DEFAULT 'in',
                    text TEXT NOT NULL,
                    provider_message_id VARCHAR(128),
                    delivery_status VARCHAR(24) NOT NULL DEFAULT 'sent',
                    created_at TIMESTAMPTZ
                )"""
            )
        )
        await conn.execute(
            text(
                """CREATE TABLE IF NOT EXISTS chat_thread_user_reads (
                    id SERIAL PRIMARY KEY,
                    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                    thread_id INTEGER NOT NULL REFERENCES chat_threads(id) ON DELETE CASCADE,
                    last_read_message_id INTEGER NOT NULL DEFAULT 0,
                    CONSTRAINT uq_chat_thread_user_reads_user_thread UNIQUE (user_id, thread_id)
                )"""
            )
        )
        await conn.execute(
            text(
                "ALTER TABLE booking_specialists ADD COLUMN IF NOT EXISTS specialization VARCHAR(255)",
            ),
        )
        await conn.execute(
            text(
                "ALTER TABLE booking_specialists ADD COLUMN IF NOT EXISTS sort_order INTEGER NOT NULL DEFAULT 0",
            ),
        )
        await conn.execute(
            text(
                "ALTER TABLE booking_specialists ADD COLUMN IF NOT EXISTS work_start_hour INTEGER NOT NULL DEFAULT 9",
            ),
        )
        await conn.execute(
            text(
                "ALTER TABLE booking_specialists ADD COLUMN IF NOT EXISTS slot_duration_min INTEGER NOT NULL DEFAULT 30",
            ),
        )
        await conn.execute(
            text(
                "ALTER TABLE booking_specialists ADD COLUMN IF NOT EXISTS work_end_hour INTEGER NOT NULL DEFAULT 18",
            ),
        )
        await conn.execute(
            text(
                "ALTER TABLE booking_specialists ADD COLUMN IF NOT EXISTS work_weekdays JSONB",
            ),
        )
        await conn.execute(
            text(
                "ALTER TABLE booking_specialists ADD COLUMN IF NOT EXISTS crm_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL",
            ),
        )
        await conn.execute(
            text(
                "CREATE UNIQUE INDEX IF NOT EXISTS uq_booking_specialists_crm_user_id ON booking_specialists (crm_user_id) WHERE crm_user_id IS NOT NULL",
            ),
        )
        await conn.execute(
            text(
                """UPDATE booking_specialists SET sort_order = id
                   WHERE NOT EXISTS (SELECT 1 FROM booking_specialists s WHERE s.sort_order > 0)""",
            ),
        )
        await conn.execute(
            text(
                """UPDATE booking_specialists SET work_weekdays = '[0,1,2,3,4]'::jsonb
                   WHERE work_weekdays IS NULL""",
            ),
        )
        await conn.execute(
            text(
                "ALTER TABLE booking_specialists ADD COLUMN IF NOT EXISTS course_streams_enabled BOOLEAN NOT NULL DEFAULT FALSE",
            ),
        )
        await conn.execute(
            text(
                "ALTER TABLE booking_specialists ADD COLUMN IF NOT EXISTS course_stream_max_days INTEGER NOT NULL DEFAULT 15",
            ),
        )
        await conn.execute(
            text(
                "ALTER TABLE booking_specialists ADD COLUMN IF NOT EXISTS course_stream_min_day_for_next INTEGER NOT NULL DEFAULT 10",
            ),
        )
        await conn.execute(
            text(
                "ALTER TABLE booking_specialists ADD COLUMN IF NOT EXISTS course_stream_gap_days INTEGER NOT NULL DEFAULT 10",
            ),
        )
        await conn.execute(
            text(
                "ALTER TABLE pipelines ADD COLUMN IF NOT EXISTS lead_assignment_mode VARCHAR(32) NOT NULL DEFAULT 'none'",
            ),
        )
        await conn.execute(
            text(
                "ALTER TABLE pipelines ADD COLUMN IF NOT EXISTS assignment_rr_counter INTEGER NOT NULL DEFAULT 0",
            ),
        )
        await conn.execute(
            text("ALTER TABLE pipelines ADD COLUMN IF NOT EXISTS expert_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL"),
        )
        await conn.execute(
            text(
                "ALTER TABLE pipelines ADD COLUMN IF NOT EXISTS intake_manager_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL",
            ),
        )
        await conn.execute(
            text("ALTER TABLE pipelines ADD COLUMN IF NOT EXISTS manager_allowed_outbound_phones TEXT"),
        )
        await conn.execute(
            text(
                "ALTER TABLE chat_messages ADD COLUMN IF NOT EXISTS message_type VARCHAR(24) NOT NULL DEFAULT 'text'",
            ),
        )
        await conn.execute(text("ALTER TABLE chat_messages ADD COLUMN IF NOT EXISTS media_url TEXT"))
        await conn.execute(text("ALTER TABLE chat_messages ADD COLUMN IF NOT EXISTS media_mime VARCHAR(128)"))
        await conn.execute(text("ALTER TABLE chat_messages ADD COLUMN IF NOT EXISTS file_name VARCHAR(255)"))
        await conn.execute(
            text(
                "ALTER TABLE booking_appointments ADD COLUMN IF NOT EXISTS pipeline_id INTEGER REFERENCES pipelines(id) ON DELETE SET NULL",
            ),
        )
        await conn.execute(
            text(
                "ALTER TABLE booking_appointments ADD COLUMN IF NOT EXISTS service_amount NUMERIC(14, 2) NOT NULL DEFAULT 0",
            ),
        )
        await conn.execute(
            text(
                "ALTER TABLE booking_appointments ADD COLUMN IF NOT EXISTS paid_amount NUMERIC(14, 2) NOT NULL DEFAULT 0",
            ),
        )
        await conn.execute(text("ALTER TABLE booking_appointments ADD COLUMN IF NOT EXISTS service_title VARCHAR(500)"))
        await conn.execute(
            text(
                """UPDATE booking_appointments ba
                   SET pipeline_id = ps.pipeline_id
                   FROM leads l
                   LEFT JOIN pipeline_stages ps ON ps.id = l.status_id
                   WHERE ba.lead_id = l.id
                     AND ba.pipeline_id IS NULL""",
            ),
        )
        await conn.execute(
            text(
                "ALTER TABLE booking_directions ADD COLUMN IF NOT EXISTS pipeline_id INTEGER REFERENCES pipelines(id) ON DELETE SET NULL",
            ),
        )
        await conn.execute(
            text(
                """UPDATE booking_directions bd
                   SET pipeline_id = (
                       SELECT p2.id
                       FROM pipelines p2
                       WHERE p2.company_id = bd.company_id
                       ORDER BY p2.id ASC
                       LIMIT 1
                   )
                   WHERE bd.pipeline_id IS NULL""",
            ),
        )
        return


async def ensure_owner_role_migration(conn: AsyncConnection, database_url: str) -> None:
    """
    Роль «полного» администратора переименована в owner.
    Существующие пользователи с role=admin становятся owner; значение admin в enum — для новой роли админа воронки.
    """
    low = database_url.lower()
    if "sqlite" in low:
        await conn.execute(text("UPDATE users SET role = 'owner' WHERE role = 'admin'"))
        return
    if "postgresql" not in low and "asyncpg" not in low:
        return
    # ВАЖНО: вызывается на отдельном connection вне engine.begin() транзакции.
    # Для совместимости версий SQLAlchemy execution_options может быть sync/async.
    ac = conn.execution_options(isolation_level="AUTOCOMMIT")
    if hasattr(ac, "__await__"):
        ac = await ac  # type: ignore[assignment]

    async def _ensure_enum_value(value: str) -> None:
        exists_q = text(
            """
            SELECT 1
            FROM pg_enum e
            JOIN pg_type t ON t.oid = e.enumtypid
            WHERE t.typname = 'user_role' AND e.enumlabel = :val
            LIMIT 1
            """,
        )
        exists = await ac.scalar(exists_q, {"val": value})
        if exists is None:
            await ac.execute(text(f"ALTER TYPE user_role ADD VALUE '{value}'"))
        exists = await ac.scalar(exists_q, {"val": value})
        if exists is None:
            raise RuntimeError(f"Failed to add enum value '{value}' to user_role")

    await _ensure_enum_value("owner")
    await _ensure_enum_value("super_owner")

    await ac.execute(text("UPDATE users SET role = 'owner' WHERE role::text = 'admin'"))


async def ensure_integration_provider_migration(conn: AsyncConnection, database_url: str) -> None:
    """Добавляет новые значения enum integration_provider в PostgreSQL."""
    low = database_url.lower()
    if "postgresql" not in low and "asyncpg" not in low:
        return
    if conn.in_transaction():
        await conn.commit()
    ac = conn.execution_options(isolation_level="AUTOCOMMIT")
    if hasattr(ac, "__await__"):
        ac = await ac  # type: ignore[assignment]

    type_exists = await ac.scalar(
        text("SELECT 1 FROM pg_type WHERE typname = 'integration_provider' LIMIT 1"),
    )
    if type_exists is None:
        return

    exists_q = text(
        """
        SELECT 1
        FROM pg_enum e
        JOIN pg_type t ON t.oid = e.enumtypid
        WHERE t.typname = 'integration_provider' AND e.enumlabel = :val
        LIMIT 1
        """,
    )
    exists = await ac.scalar(exists_q, {"val": "google_sheets"})
    if exists is None:
        await ac.execute(text("ALTER TYPE integration_provider ADD VALUE 'google_sheets'"))
    exists_ig = await ac.scalar(exists_q, {"val": "instagram"})
    if exists_ig is None:
        await ac.execute(text("ALTER TYPE integration_provider ADD VALUE 'instagram'"))
    exists_gmail = await ac.scalar(exists_q, {"val": "gmail"})
    if exists_gmail is None:
        await ac.execute(text("ALTER TYPE integration_provider ADD VALUE 'gmail'"))


async def ensure_multi_tenant_migration(conn: AsyncConnection, database_url: str) -> None:
    low = database_url.lower()

    if "sqlite" in low:
        await conn.execute(
            text(
                """CREATE TABLE IF NOT EXISTS companies (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    name VARCHAR(255) NOT NULL UNIQUE,
                    contact_email VARCHAR(320),
                    external_db_dsn TEXT,
                    is_active INTEGER NOT NULL DEFAULT 1,
                    created_at DATETIME
                )"""
            )
        )
        r = await conn.execute(text("PRAGMA table_info(companies)"))
        company_cols = {row[1] for row in r.fetchall()}
        if company_cols and "contact_email" not in company_cols:
            await conn.execute(text("ALTER TABLE companies ADD COLUMN contact_email VARCHAR(320)"))
        if company_cols and "external_db_dsn" not in company_cols:
            await conn.execute(text("ALTER TABLE companies ADD COLUMN external_db_dsn TEXT"))
        cid = await conn.scalar(text("SELECT id FROM companies ORDER BY id LIMIT 1"))
        if cid is None:
            await conn.execute(
                text(
                    "INSERT INTO companies(name, is_active, created_at) VALUES ('Default Company', 1, CURRENT_TIMESTAMP)",
                )
            )
            cid = await conn.scalar(text("SELECT id FROM companies ORDER BY id LIMIT 1"))
        default_company_id = int(cid or 1)

        tables = [
            "users",
            "pipelines",
            "pipeline_stages",
            "user_pipeline_assignments",
            "leads",
            "lead_audit_events",
            "system_audit_events",
            "lead_sources",
            "integrations",
            "chat_threads",
            "chat_messages",
            "booking_directions",
            "booking_specialists",
            "booking_appointments",
            "deals",
            "tasks",
        ]
        for tn in tables:
            r = await conn.execute(text(f"PRAGMA table_info({tn})"))
            cols = {row[1] for row in r.fetchall()}
            if cols and "company_id" not in cols:
                await conn.execute(text(f"ALTER TABLE {tn} ADD COLUMN company_id INTEGER"))
            await conn.execute(
                text(f"UPDATE {tn} SET company_id = :cid WHERE company_id IS NULL"),
                {"cid": default_company_id},
            )
        bd_info = await conn.execute(text("PRAGMA table_info(booking_directions)"))
        bd_cols = {row[1] for row in bd_info.fetchall()}
        if bd_cols and "pipeline_id" not in bd_cols:
            await conn.execute(text("ALTER TABLE booking_directions ADD COLUMN pipeline_id INTEGER"))
        await conn.execute(
            text(
                """UPDATE booking_directions
                   SET pipeline_id = (
                       SELECT id
                       FROM pipelines p
                       WHERE p.company_id = booking_directions.company_id
                       ORDER BY p.id ASC
                       LIMIT 1
                   )
                   WHERE pipeline_id IS NULL""",
            ),
        )
        task_info = await conn.execute(text("PRAGMA table_info(tasks)"))
        task_cols = {row[1] for row in task_info.fetchall()}
        if task_cols and "created_by_user_id" not in task_cols:
            await conn.execute(text("ALTER TABLE tasks ADD COLUMN created_by_user_id INTEGER"))
        if task_cols and "review_score" not in task_cols:
            await conn.execute(text("ALTER TABLE tasks ADD COLUMN review_score INTEGER"))
        if task_cols and "review_comment" not in task_cols:
            await conn.execute(text("ALTER TABLE tasks ADD COLUMN review_comment TEXT"))
        if task_cols and "review_by_user_id" not in task_cols:
            await conn.execute(text("ALTER TABLE tasks ADD COLUMN review_by_user_id INTEGER"))
        if task_cols and "review_at" not in task_cols:
            await conn.execute(text("ALTER TABLE tasks ADD COLUMN review_at DATETIME"))

        return

    if "postgresql" in low or "asyncpg" in low:
        await conn.execute(
            text(
                """CREATE TABLE IF NOT EXISTS companies (
                    id SERIAL PRIMARY KEY,
                    name VARCHAR(255) NOT NULL UNIQUE,
                    contact_email VARCHAR(320),
                    external_db_dsn TEXT,
                    is_active BOOLEAN NOT NULL DEFAULT TRUE,
                    created_at TIMESTAMPTZ
                )"""
            )
        )
        await conn.execute(text("ALTER TABLE companies ADD COLUMN IF NOT EXISTS contact_email VARCHAR(320)"))
        await conn.execute(text("ALTER TABLE companies ADD COLUMN IF NOT EXISTS external_db_dsn TEXT"))
        cid = await conn.scalar(text("SELECT id FROM companies ORDER BY id LIMIT 1"))
        if cid is None:
            await conn.execute(
                text("INSERT INTO companies(name, is_active, created_at) VALUES ('Default Company', TRUE, NOW())"),
            )
            cid = await conn.scalar(text("SELECT id FROM companies ORDER BY id LIMIT 1"))
        default_company_id = int(cid or 1)

        stmts = [
            "ALTER TABLE users ADD COLUMN IF NOT EXISTS company_id INTEGER",
            "ALTER TABLE pipelines ADD COLUMN IF NOT EXISTS company_id INTEGER",
            "ALTER TABLE pipeline_stages ADD COLUMN IF NOT EXISTS company_id INTEGER",
            "ALTER TABLE user_pipeline_assignments ADD COLUMN IF NOT EXISTS company_id INTEGER",
            "ALTER TABLE leads ADD COLUMN IF NOT EXISTS company_id INTEGER",
            "ALTER TABLE lead_audit_events ADD COLUMN IF NOT EXISTS company_id INTEGER",
            "ALTER TABLE system_audit_events ADD COLUMN IF NOT EXISTS company_id INTEGER",
            "ALTER TABLE lead_sources ADD COLUMN IF NOT EXISTS company_id INTEGER",
            "ALTER TABLE integrations ADD COLUMN IF NOT EXISTS company_id INTEGER",
            "ALTER TABLE chat_threads ADD COLUMN IF NOT EXISTS company_id INTEGER",
            "ALTER TABLE chat_messages ADD COLUMN IF NOT EXISTS company_id INTEGER",
            "ALTER TABLE booking_directions ADD COLUMN IF NOT EXISTS company_id INTEGER",
            "ALTER TABLE booking_directions ADD COLUMN IF NOT EXISTS pipeline_id INTEGER REFERENCES pipelines(id) ON DELETE SET NULL",
            "ALTER TABLE booking_specialists ADD COLUMN IF NOT EXISTS company_id INTEGER",
            "ALTER TABLE booking_appointments ADD COLUMN IF NOT EXISTS company_id INTEGER",
            "ALTER TABLE deals ADD COLUMN IF NOT EXISTS company_id INTEGER",
            "ALTER TABLE tasks ADD COLUMN IF NOT EXISTS company_id INTEGER",
            "ALTER TABLE tasks ADD COLUMN IF NOT EXISTS created_by_user_id INTEGER",
            "ALTER TABLE tasks ADD COLUMN IF NOT EXISTS review_score INTEGER",
            "ALTER TABLE tasks ADD COLUMN IF NOT EXISTS review_comment TEXT",
            "ALTER TABLE tasks ADD COLUMN IF NOT EXISTS review_by_user_id INTEGER",
            "ALTER TABLE tasks ADD COLUMN IF NOT EXISTS review_at TIMESTAMPTZ",
        ]
        for s in stmts:
            await conn.execute(text(s))

        for tn in (
            "users",
            "pipelines",
            "pipeline_stages",
            "user_pipeline_assignments",
            "leads",
            "lead_audit_events",
            "system_audit_events",
            "lead_sources",
            "integrations",
            "chat_threads",
            "chat_messages",
            "booking_directions",
            "booking_specialists",
            "booking_appointments",
            "deals",
            "tasks",
        ):
            await conn.execute(
                text(f"UPDATE {tn} SET company_id = :cid WHERE company_id IS NULL"),
                {"cid": default_company_id},
            )
        await conn.execute(
            text(
                """UPDATE booking_directions bd
                   SET pipeline_id = (
                       SELECT p2.id
                       FROM pipelines p2
                       WHERE p2.company_id = bd.company_id
                       ORDER BY p2.id ASC
                       LIMIT 1
                   )
                   WHERE bd.pipeline_id IS NULL""",
            ),
        )

        return


async def ensure_finance_extensions(conn: AsyncConnection, database_url: str) -> None:
    """Колонки финнастроек (ОСВ, блокировка периода) и таблица шаблонов проводок."""
    low = database_url.lower()
    if "sqlite" in low:
        r = await conn.execute(text("PRAGMA table_info(finance_company_settings)"))
        cols = {row[1] for row in r.fetchall()}
        if cols:
            for col in ("last_osv_import_from", "last_osv_import_to", "posting_locked_until"):
                if col not in cols:
                    await conn.execute(text(f"ALTER TABLE finance_company_settings ADD COLUMN {col}"))
        await conn.execute(
            text(
                """CREATE TABLE IF NOT EXISTS finance_journal_templates (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    company_id INTEGER NOT NULL,
                    name VARCHAR(255) NOT NULL,
                    lines TEXT NOT NULL,
                    created_at DATETIME
                )""",
            ),
        )
        r = await conn.execute(text("PRAGMA table_info(finance_journal_entries)"))
        je_cols = {row[1] for row in r.fetchall()}
        if je_cols:
            if "related_lead_id" not in je_cols:
                await conn.execute(text("ALTER TABLE finance_journal_entries ADD COLUMN related_lead_id INTEGER"))
            if "related_deal_id" not in je_cols:
                await conn.execute(text("ALTER TABLE finance_journal_entries ADD COLUMN related_deal_id INTEGER"))
        r = await conn.execute(text("PRAGMA table_info(finance_journal_lines)"))
        jl_cols = {row[1] for row in r.fetchall()}
        if jl_cols and "dimensions" not in jl_cols:
            await conn.execute(text("ALTER TABLE finance_journal_lines ADD COLUMN dimensions TEXT"))
        await conn.execute(
            text(
                """CREATE TABLE IF NOT EXISTS finance_closed_months (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    company_id INTEGER NOT NULL,
                    year INTEGER NOT NULL,
                    month INTEGER NOT NULL,
                    closed_at DATETIME,
                    closed_by_user_id INTEGER,
                    UNIQUE(company_id, year, month)
                )""",
            ),
        )
        await conn.execute(
            text(
                """CREATE TABLE IF NOT EXISTS finance_bank_statement_lines (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    company_id INTEGER NOT NULL,
                    txn_date DATE NOT NULL,
                    amount NUMERIC(14, 2) NOT NULL,
                    description TEXT,
                    journal_entry_id INTEGER,
                    matched_at DATETIME,
                    created_at DATETIME
                )""",
            ),
        )
        return

    if "postgresql" in low or "asyncpg" in low:
        await conn.execute(
            text(
                """DO $body$
                BEGIN
                    ALTER TYPE user_role ADD VALUE 'finance_analyst';
                EXCEPTION
                    WHEN duplicate_object THEN NULL;
                END
                $body$;""",
            ),
        )
        await conn.execute(
            text("ALTER TABLE finance_company_settings ADD COLUMN IF NOT EXISTS last_osv_import_from DATE"),
        )
        await conn.execute(
            text("ALTER TABLE finance_company_settings ADD COLUMN IF NOT EXISTS last_osv_import_to DATE"),
        )
        await conn.execute(
            text("ALTER TABLE finance_company_settings ADD COLUMN IF NOT EXISTS posting_locked_until DATE"),
        )
        await conn.execute(
            text(
                """CREATE TABLE IF NOT EXISTS finance_journal_templates (
                    id SERIAL PRIMARY KEY,
                    company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
                    name VARCHAR(255) NOT NULL,
                    lines JSONB NOT NULL,
                    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
                )""",
            ),
        )
        await conn.execute(
            text(
                "ALTER TABLE finance_journal_entries ADD COLUMN IF NOT EXISTS related_lead_id INTEGER REFERENCES leads(id) ON DELETE SET NULL",
            ),
        )
        await conn.execute(
            text(
                "ALTER TABLE finance_journal_entries ADD COLUMN IF NOT EXISTS related_deal_id INTEGER REFERENCES deals(id) ON DELETE SET NULL",
            ),
        )
        await conn.execute(
            text("ALTER TABLE finance_journal_lines ADD COLUMN IF NOT EXISTS dimensions JSONB"),
        )
        await conn.execute(
            text(
                """CREATE TABLE IF NOT EXISTS finance_closed_months (
                    id SERIAL PRIMARY KEY,
                    company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
                    year INTEGER NOT NULL,
                    month INTEGER NOT NULL,
                    closed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                    closed_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
                    CONSTRAINT uq_finance_closed_month_company_ym UNIQUE (company_id, year, month)
                )""",
            ),
        )
        await conn.execute(
            text(
                """CREATE TABLE IF NOT EXISTS finance_bank_statement_lines (
                    id SERIAL PRIMARY KEY,
                    company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
                    txn_date DATE NOT NULL,
                    amount NUMERIC(14, 2) NOT NULL,
                    description TEXT,
                    journal_entry_id INTEGER REFERENCES finance_journal_entries(id) ON DELETE SET NULL,
                    matched_at TIMESTAMPTZ,
                    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
                )""",
            ),
        )


async def ensure_attendance_tracker_tables(conn: AsyncConnection, database_url: str) -> None:
    low = database_url.lower()
    if "sqlite" in low:
        await conn.execute(
            text(
                """CREATE TABLE IF NOT EXISTS attendance_geofences (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    company_id INTEGER NOT NULL,
                    name VARCHAR(255) NOT NULL,
                    address VARCHAR(500),
                    latitude NUMERIC(10,7) NOT NULL,
                    longitude NUMERIC(10,7) NOT NULL,
                    radius_m INTEGER NOT NULL DEFAULT 120,
                    is_active INTEGER NOT NULL DEFAULT 1,
                    created_at DATETIME,
                    updated_at DATETIME
                )""",
            ),
        )
        await conn.execute(
            text(
                """CREATE TABLE IF NOT EXISTS attendance_shifts (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    company_id INTEGER NOT NULL,
                    user_id INTEGER NOT NULL,
                    geofence_id INTEGER,
                    start_at DATETIME,
                    end_at DATETIME,
                    start_latitude NUMERIC(10,7),
                    start_longitude NUMERIC(10,7),
                    end_latitude NUMERIC(10,7),
                    end_longitude NUMERIC(10,7),
                    start_accuracy_m INTEGER,
                    end_accuracy_m INTEGER,
                    started_in_geofence INTEGER NOT NULL DEFAULT 0,
                    ended_in_geofence INTEGER,
                    suspicious INTEGER NOT NULL DEFAULT 0,
                    suspicious_reason TEXT
                )""",
            ),
        )
        await conn.execute(
            text(
                """CREATE TABLE IF NOT EXISTS attendance_pings (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    company_id INTEGER NOT NULL,
                    user_id INTEGER NOT NULL,
                    shift_id INTEGER,
                    geofence_id INTEGER,
                    latitude NUMERIC(10,7) NOT NULL,
                    longitude NUMERIC(10,7) NOT NULL,
                    accuracy_m INTEGER,
                    distance_to_geofence_m INTEGER,
                    inside_geofence INTEGER NOT NULL DEFAULT 0,
                    suspicious INTEGER NOT NULL DEFAULT 0,
                    suspicious_reason TEXT,
                    created_at DATETIME
                )""",
            ),
        )
        await conn.execute(text("CREATE INDEX IF NOT EXISTS idx_att_geo_company ON attendance_geofences(company_id, is_active, id)"))
        await conn.execute(text("CREATE INDEX IF NOT EXISTS idx_att_shifts_company_user_start ON attendance_shifts(company_id, user_id, start_at)"))
        await conn.execute(text("CREATE INDEX IF NOT EXISTS idx_att_shifts_company_user_open ON attendance_shifts(company_id, user_id, end_at)"))
        await conn.execute(text("CREATE INDEX IF NOT EXISTS idx_att_pings_company_user_created ON attendance_pings(company_id, user_id, created_at)"))
        await conn.execute(text("CREATE INDEX IF NOT EXISTS idx_att_pings_company_shift_created ON attendance_pings(company_id, shift_id, created_at)"))
        return

    if "postgresql" in low or "asyncpg" in low:
        await conn.execute(
            text(
                """CREATE TABLE IF NOT EXISTS attendance_geofences (
                    id SERIAL PRIMARY KEY,
                    company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
                    name VARCHAR(255) NOT NULL,
                    address VARCHAR(500),
                    latitude NUMERIC(10,7) NOT NULL,
                    longitude NUMERIC(10,7) NOT NULL,
                    radius_m INTEGER NOT NULL DEFAULT 120,
                    is_active BOOLEAN NOT NULL DEFAULT TRUE,
                    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
                )""",
            ),
        )
        await conn.execute(
            text(
                """CREATE TABLE IF NOT EXISTS attendance_shifts (
                    id SERIAL PRIMARY KEY,
                    company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
                    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                    geofence_id INTEGER REFERENCES attendance_geofences(id) ON DELETE SET NULL,
                    start_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                    end_at TIMESTAMPTZ,
                    start_latitude NUMERIC(10,7),
                    start_longitude NUMERIC(10,7),
                    end_latitude NUMERIC(10,7),
                    end_longitude NUMERIC(10,7),
                    start_accuracy_m INTEGER,
                    end_accuracy_m INTEGER,
                    started_in_geofence BOOLEAN NOT NULL DEFAULT FALSE,
                    ended_in_geofence BOOLEAN,
                    suspicious BOOLEAN NOT NULL DEFAULT FALSE,
                    suspicious_reason TEXT
                )""",
            ),
        )
        await conn.execute(
            text(
                """CREATE TABLE IF NOT EXISTS attendance_pings (
                    id SERIAL PRIMARY KEY,
                    company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
                    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                    shift_id INTEGER REFERENCES attendance_shifts(id) ON DELETE SET NULL,
                    geofence_id INTEGER REFERENCES attendance_geofences(id) ON DELETE SET NULL,
                    latitude NUMERIC(10,7) NOT NULL,
                    longitude NUMERIC(10,7) NOT NULL,
                    accuracy_m INTEGER,
                    distance_to_geofence_m INTEGER,
                    inside_geofence BOOLEAN NOT NULL DEFAULT FALSE,
                    suspicious BOOLEAN NOT NULL DEFAULT FALSE,
                    suspicious_reason TEXT,
                    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
                )""",
            ),
        )
        await conn.execute(text("CREATE INDEX IF NOT EXISTS idx_att_geo_company ON attendance_geofences(company_id, is_active, id)"))
        await conn.execute(text("CREATE INDEX IF NOT EXISTS idx_att_shifts_company_user_start ON attendance_shifts(company_id, user_id, start_at DESC)"))
        await conn.execute(text("CREATE INDEX IF NOT EXISTS idx_att_shifts_company_user_open ON attendance_shifts(company_id, user_id, end_at)"))
        await conn.execute(text("CREATE INDEX IF NOT EXISTS idx_att_pings_company_user_created ON attendance_pings(company_id, user_id, created_at DESC)"))
        await conn.execute(text("CREATE INDEX IF NOT EXISTS idx_att_pings_company_shift_created ON attendance_pings(company_id, shift_id, created_at DESC)"))
        return


async def ensure_sales_kpi_plans(conn: AsyncConnection, database_url: str) -> None:
    """Таблицы KPI: цены услуг и планы по количеству/менеджерам."""
    low = database_url.lower()
    if "sqlite" in low:
        await conn.execute(
            text(
                """CREATE TABLE IF NOT EXISTS sales_kpi_plans (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    company_id INTEGER NOT NULL,
                    pipeline_id INTEGER NOT NULL,
                    year_month DATE NOT NULL,
                    manager_user_id INTEGER NOT NULL,
                    expert_user_id INTEGER,
                    plan_amount NUMERIC(14, 2) NOT NULL DEFAULT 0,
                    UNIQUE (company_id, pipeline_id, year_month, manager_user_id)
                )""",
            ),
        )
        await conn.execute(
            text(
                """CREATE TABLE IF NOT EXISTS sales_kpi_service_prices (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    company_id INTEGER NOT NULL,
                    pipeline_id INTEGER NOT NULL,
                    year_month DATE NOT NULL,
                    direction_id INTEGER NOT NULL,
                    unit_price NUMERIC(14, 2) NOT NULL DEFAULT 0,
                    UNIQUE (company_id, pipeline_id, year_month, direction_id)
                )""",
            ),
        )
        await conn.execute(
            text(
                """CREATE TABLE IF NOT EXISTS sales_kpi_service_plans (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    company_id INTEGER NOT NULL,
                    pipeline_id INTEGER NOT NULL,
                    year_month DATE NOT NULL,
                    manager_user_id INTEGER NOT NULL,
                    direction_id INTEGER NOT NULL,
                    plan_qty INTEGER NOT NULL DEFAULT 0,
                    expert_user_id INTEGER,
                    UNIQUE (company_id, pipeline_id, year_month, manager_user_id, direction_id)
                )""",
            ),
        )


async def ensure_chat_performance_indexes(conn: AsyncConnection, database_url: str) -> None:
    low = database_url.lower()
    if "sqlite" in low:
        await conn.execute(
            text("CREATE INDEX IF NOT EXISTS idx_chat_threads_company_pipeline_updated ON chat_threads(company_id, pipeline_id, updated_at, id)"),
        )
        await conn.execute(
            text("CREATE INDEX IF NOT EXISTS idx_chat_threads_company_lead ON chat_threads(company_id, lead_id)"),
        )
        await conn.execute(
            text("CREATE INDEX IF NOT EXISTS idx_chat_messages_thread_id_id ON chat_messages(thread_id, id)"),
        )
        await conn.execute(
            text("CREATE INDEX IF NOT EXISTS idx_chat_messages_thread_direction_id ON chat_messages(thread_id, direction, id)"),
        )
        await conn.execute(
            text("CREATE INDEX IF NOT EXISTS idx_chat_messages_thread_created_at ON chat_messages(thread_id, created_at)"),
        )
        await conn.execute(
            text("CREATE INDEX IF NOT EXISTS idx_chat_thread_reads_user_thread ON chat_thread_user_reads(user_id, thread_id)"),
        )
        await conn.execute(
            text("CREATE INDEX IF NOT EXISTS idx_tasks_company_status_id ON tasks(company_id, status, id)"),
        )
        await conn.execute(
            text("CREATE INDEX IF NOT EXISTS idx_tasks_company_assigned_status_id ON tasks(company_id, assigned_to, status, id)"),
        )
        await conn.execute(
            text("CREATE INDEX IF NOT EXISTS idx_tasks_company_created_status_id ON tasks(company_id, created_by_user_id, status, id)"),
        )
        return

    if "postgresql" in low or "asyncpg" in low:
        await conn.execute(
            text(
                "CREATE INDEX IF NOT EXISTS idx_chat_threads_company_pipeline_updated ON chat_threads(company_id, pipeline_id, updated_at DESC, id DESC)",
            ),
        )
        await conn.execute(
            text("CREATE INDEX IF NOT EXISTS idx_chat_threads_company_lead ON chat_threads(company_id, lead_id)"),
        )
        await conn.execute(
            text("CREATE INDEX IF NOT EXISTS idx_chat_messages_thread_id_id ON chat_messages(thread_id, id DESC)"),
        )
        await conn.execute(
            text("CREATE INDEX IF NOT EXISTS idx_chat_messages_thread_direction_id ON chat_messages(thread_id, direction, id DESC)"),
        )
        await conn.execute(
            text("CREATE INDEX IF NOT EXISTS idx_chat_messages_thread_created_at ON chat_messages(thread_id, created_at)"),
        )
        await conn.execute(
            text("CREATE INDEX IF NOT EXISTS idx_chat_thread_reads_user_thread ON chat_thread_user_reads(user_id, thread_id)"),
        )
        await conn.execute(
            text("CREATE INDEX IF NOT EXISTS idx_tasks_company_status_id ON tasks(company_id, status, id DESC)"),
        )
        await conn.execute(
            text("CREATE INDEX IF NOT EXISTS idx_tasks_company_assigned_status_id ON tasks(company_id, assigned_to, status, id DESC)"),
        )
        await conn.execute(
            text("CREATE INDEX IF NOT EXISTS idx_tasks_company_created_status_id ON tasks(company_id, created_by_user_id, status, id DESC)"),
        )
        return
    if "postgresql" in low or "asyncpg" in low:
        await conn.execute(
            text(
                """CREATE TABLE IF NOT EXISTS sales_kpi_plans (
                    id SERIAL PRIMARY KEY,
                    company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
                    pipeline_id INTEGER NOT NULL REFERENCES pipelines(id) ON DELETE CASCADE,
                    year_month DATE NOT NULL,
                    manager_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                    expert_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
                    plan_amount NUMERIC(14, 2) NOT NULL DEFAULT 0,
                    CONSTRAINT uq_sales_kpi_plan_scope UNIQUE (company_id, pipeline_id, year_month, manager_user_id)
                )""",
            ),
        )
        await conn.execute(
            text(
                """CREATE TABLE IF NOT EXISTS sales_kpi_service_prices (
                    id SERIAL PRIMARY KEY,
                    company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
                    pipeline_id INTEGER NOT NULL REFERENCES pipelines(id) ON DELETE CASCADE,
                    year_month DATE NOT NULL,
                    direction_id INTEGER NOT NULL REFERENCES booking_directions(id) ON DELETE CASCADE,
                    unit_price NUMERIC(14, 2) NOT NULL DEFAULT 0,
                    CONSTRAINT uq_sales_kpi_service_price_scope UNIQUE (company_id, pipeline_id, year_month, direction_id)
                )""",
            ),
        )
        await conn.execute(
            text(
                """CREATE TABLE IF NOT EXISTS sales_kpi_service_plans (
                    id SERIAL PRIMARY KEY,
                    company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
                    pipeline_id INTEGER NOT NULL REFERENCES pipelines(id) ON DELETE CASCADE,
                    year_month DATE NOT NULL,
                    manager_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                    direction_id INTEGER NOT NULL REFERENCES booking_directions(id) ON DELETE CASCADE,
                    plan_qty INTEGER NOT NULL DEFAULT 0,
                    expert_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
                    CONSTRAINT uq_sales_kpi_service_plan_scope UNIQUE (company_id, pipeline_id, year_month, manager_user_id, direction_id)
                )""",
            ),
        )


async def ensure_super_owner_platform(conn: AsyncConnection, database_url: str) -> None:
    """Тариф на компанию, смена пароля, аудит super_owner."""
    low = database_url.lower()
    if "sqlite" in low:
        r = await conn.execute(text("PRAGMA table_info(companies)"))
        ccols = {row[1] for row in r.fetchall()}
        if "tariff_max_active_users" not in ccols:
            await conn.execute(text("ALTER TABLE companies ADD COLUMN tariff_max_active_users INTEGER"))
        if "tariff_max_integrations" not in ccols:
            await conn.execute(text("ALTER TABLE companies ADD COLUMN tariff_max_integrations INTEGER"))
        r = await conn.execute(text("PRAGMA table_info(users)"))
        ucols = {row[1] for row in r.fetchall()}
        if "must_change_password" not in ucols:
            await conn.execute(text("ALTER TABLE users ADD COLUMN must_change_password INTEGER NOT NULL DEFAULT 0"))
        await conn.execute(
            text(
                """CREATE TABLE IF NOT EXISTS super_owner_audit_events (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    actor_user_id INTEGER NOT NULL,
                    company_id INTEGER,
                    action VARCHAR(160) NOT NULL,
                    detail TEXT,
                    created_at DATETIME
                )""",
            ),
        )
        await conn.execute(
            text("CREATE INDEX IF NOT EXISTS idx_super_owner_audit_created ON super_owner_audit_events(created_at DESC, id DESC)"),
        )
        await conn.execute(
            text("CREATE INDEX IF NOT EXISTS idx_super_owner_audit_actor ON super_owner_audit_events(actor_user_id, created_at DESC)"),
        )
        return

    if "postgresql" in low or "asyncpg" in low:
        await conn.execute(text("ALTER TABLE companies ADD COLUMN IF NOT EXISTS tariff_max_active_users INTEGER"))
        await conn.execute(text("ALTER TABLE companies ADD COLUMN IF NOT EXISTS tariff_max_integrations INTEGER"))
        await conn.execute(text("ALTER TABLE users ADD COLUMN IF NOT EXISTS must_change_password BOOLEAN NOT NULL DEFAULT FALSE"))
        await conn.execute(
            text(
                """CREATE TABLE IF NOT EXISTS super_owner_audit_events (
                    id SERIAL PRIMARY KEY,
                    actor_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                    company_id INTEGER REFERENCES companies(id) ON DELETE SET NULL,
                    action VARCHAR(160) NOT NULL,
                    detail TEXT,
                    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
                )""",
            ),
        )
        await conn.execute(
            text("CREATE INDEX IF NOT EXISTS idx_super_owner_audit_created ON super_owner_audit_events(created_at DESC, id DESC)"),
        )
        await conn.execute(
            text("CREATE INDEX IF NOT EXISTS idx_super_owner_audit_actor ON super_owner_audit_events(actor_user_id, created_at DESC)"),
        )
        return


async def ensure_tariff_plans_platform(conn: AsyncConnection, database_url: str) -> None:
    """Таблица тарифных планов и колонка companies.tariff_plan_id."""
    low = database_url.lower()
    if "sqlite" in low:
        await conn.execute(
            text(
                """CREATE TABLE IF NOT EXISTS tariff_plans (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    name VARCHAR(120) NOT NULL UNIQUE,
                    max_active_users INTEGER NOT NULL DEFAULT 0,
                    max_integrations INTEGER NOT NULL DEFAULT 0,
                    enabled_features TEXT NOT NULL DEFAULT '[]',
                    is_active INTEGER NOT NULL DEFAULT 1,
                    sort_order INTEGER NOT NULL DEFAULT 0,
                    created_at DATETIME
                )""",
            ),
        )
        r = await conn.execute(text("PRAGMA table_info(companies)"))
        cols = {row[1] for row in r.fetchall()}
        if "tariff_plan_id" not in cols:
            await conn.execute(text("ALTER TABLE companies ADD COLUMN tariff_plan_id INTEGER"))
        return

    if "postgresql" in low or "asyncpg" in low:
        await conn.execute(
            text(
                """CREATE TABLE IF NOT EXISTS tariff_plans (
                    id SERIAL PRIMARY KEY,
                    name VARCHAR(120) NOT NULL UNIQUE,
                    max_active_users INTEGER NOT NULL DEFAULT 0,
                    max_integrations INTEGER NOT NULL DEFAULT 0,
                    enabled_features JSONB NOT NULL DEFAULT '[]'::jsonb,
                    is_active BOOLEAN NOT NULL DEFAULT TRUE,
                    sort_order INTEGER NOT NULL DEFAULT 0,
                    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
                )""",
            ),
        )
        await conn.execute(text("ALTER TABLE companies ADD COLUMN IF NOT EXISTS tariff_plan_id INTEGER"))
        return


async def ensure_demo_billing_platform(conn: AsyncConnection, database_url: str) -> None:
    """Биллинг демо, ожидание оплаты, склад в тарифе, platform_settings."""
    low = database_url.lower()
    if "sqlite" in low:
        await conn.execute(
            text(
                """CREATE TABLE IF NOT EXISTS platform_settings (
                    id INTEGER PRIMARY KEY CHECK (id = 1),
                    demo_trial_days INTEGER NOT NULL DEFAULT 14
                )""",
            ),
        )
        await conn.execute(text("INSERT OR IGNORE INTO platform_settings (id, demo_trial_days) VALUES (1, 14)"))
        r = await conn.execute(text("PRAGMA table_info(tariff_plans)"))
        tcols = {row[1] for row in r.fetchall()}
        if tcols and "warehouse_enabled" not in tcols:
            await conn.execute(text("ALTER TABLE tariff_plans ADD COLUMN warehouse_enabled INTEGER NOT NULL DEFAULT 1"))
        r2 = await conn.execute(text("PRAGMA table_info(companies)"))
        ccols = {row[1] for row in r2.fetchall()}
        if "billing_status" not in ccols:
            await conn.execute(
                text("ALTER TABLE companies ADD COLUMN billing_status TEXT NOT NULL DEFAULT 'active'"),
            )
        if "trial_ends_at" not in ccols:
            await conn.execute(text("ALTER TABLE companies ADD COLUMN trial_ends_at DATETIME"))
        if "pending_tariff_plan_id" not in ccols:
            await conn.execute(text("ALTER TABLE companies ADD COLUMN pending_tariff_plan_id INTEGER"))
        return

    if "postgresql" in low or "asyncpg" in low:
        await conn.execute(
            text(
                """CREATE TABLE IF NOT EXISTS platform_settings (
                    id INTEGER PRIMARY KEY CHECK (id = 1),
                    demo_trial_days INTEGER NOT NULL DEFAULT 14
                )""",
            ),
        )
        await conn.execute(text("INSERT INTO platform_settings (id, demo_trial_days) VALUES (1, 14) ON CONFLICT (id) DO NOTHING"))
        await conn.execute(text("ALTER TABLE tariff_plans ADD COLUMN IF NOT EXISTS warehouse_enabled BOOLEAN NOT NULL DEFAULT TRUE"))
        await conn.execute(
            text("ALTER TABLE companies ADD COLUMN IF NOT EXISTS billing_status VARCHAR(32) NOT NULL DEFAULT 'active'"),
        )
        await conn.execute(text("ALTER TABLE companies ADD COLUMN IF NOT EXISTS trial_ends_at TIMESTAMPTZ"))
        await conn.execute(text("ALTER TABLE companies ADD COLUMN IF NOT EXISTS pending_tariff_plan_id INTEGER"))
        return


async def ensure_tariff_constructor_billing(conn: AsyncConnection, database_url: str) -> None:
    """Конструктор тарифов: цены функций/лимитов, валюта/скидка в плане, скидка/отложенный тариф у компании."""
    low = database_url.lower()
    if "sqlite" in low:
        await conn.execute(
            text(
                """CREATE TABLE IF NOT EXISTS platform_feature_prices (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    feature_key VARCHAR(48) NOT NULL,
                    currency VARCHAR(3) NOT NULL,
                    monthly_amount NUMERIC(14, 2) NOT NULL DEFAULT 0,
                    UNIQUE(feature_key, currency)
                )""",
            ),
        )
        await conn.execute(
            text(
                """CREATE TABLE IF NOT EXISTS platform_limit_prices (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    limit_kind VARCHAR(32) NOT NULL,
                    currency VARCHAR(3) NOT NULL,
                    monthly_amount NUMERIC(14, 2) NOT NULL DEFAULT 0,
                    UNIQUE(limit_kind, currency)
                )""",
            ),
        )
        r = await conn.execute(text("PRAGMA table_info(tariff_plans)"))
        tcols = {row[1] for row in r.fetchall()}
        if tcols and "billing_currency" not in tcols:
            await conn.execute(text("ALTER TABLE tariff_plans ADD COLUMN billing_currency VARCHAR(3) NOT NULL DEFAULT 'TJS'"))
        if tcols and "discount_percent" not in tcols:
            await conn.execute(text("ALTER TABLE tariff_plans ADD COLUMN discount_percent NUMERIC(6, 2) NOT NULL DEFAULT 0"))
        r2 = await conn.execute(text("PRAGMA table_info(companies)"))
        ccols = {row[1] for row in r2.fetchall()}
        if ccols and "billing_discount_percent" not in ccols:
            await conn.execute(text("ALTER TABLE companies ADD COLUMN billing_discount_percent NUMERIC(6, 2)"))
        if ccols and "scheduled_tariff_plan_id" not in ccols:
            await conn.execute(text("ALTER TABLE companies ADD COLUMN scheduled_tariff_plan_id INTEGER"))
        if ccols and "scheduled_tariff_effective_at" not in ccols:
            await conn.execute(text("ALTER TABLE companies ADD COLUMN scheduled_tariff_effective_at DATETIME"))
        return

    if "postgresql" in low or "asyncpg" in low:
        await conn.execute(
            text(
                """CREATE TABLE IF NOT EXISTS platform_feature_prices (
                    id SERIAL PRIMARY KEY,
                    feature_key VARCHAR(48) NOT NULL,
                    currency VARCHAR(3) NOT NULL,
                    monthly_amount NUMERIC(14, 2) NOT NULL DEFAULT 0,
                    CONSTRAINT uq_platform_feature_price_key_currency UNIQUE (feature_key, currency)
                )""",
            ),
        )
        await conn.execute(
            text(
                """CREATE TABLE IF NOT EXISTS platform_limit_prices (
                    id SERIAL PRIMARY KEY,
                    limit_kind VARCHAR(32) NOT NULL,
                    currency VARCHAR(3) NOT NULL,
                    monthly_amount NUMERIC(14, 2) NOT NULL DEFAULT 0,
                    CONSTRAINT uq_platform_limit_price_kind_currency UNIQUE (limit_kind, currency)
                )""",
            ),
        )
        await conn.execute(text("ALTER TABLE tariff_plans ADD COLUMN IF NOT EXISTS billing_currency VARCHAR(3) NOT NULL DEFAULT 'TJS'"))
        await conn.execute(text("ALTER TABLE tariff_plans ADD COLUMN IF NOT EXISTS discount_percent NUMERIC(6, 2) NOT NULL DEFAULT 0"))
        await conn.execute(text("ALTER TABLE companies ADD COLUMN IF NOT EXISTS billing_discount_percent NUMERIC(6, 2)"))
        await conn.execute(text("ALTER TABLE companies ADD COLUMN IF NOT EXISTS scheduled_tariff_plan_id INTEGER"))
        await conn.execute(text("ALTER TABLE companies ADD COLUMN IF NOT EXISTS scheduled_tariff_effective_at TIMESTAMPTZ"))
        return


async def ensure_accountant_role(conn: AsyncConnection, database_url: str) -> None:
    low = database_url.lower()
    if "postgresql" not in low and "asyncpg" not in low:
        return
    if conn.in_transaction():
        await conn.commit()
    ac = conn.execution_options(isolation_level="AUTOCOMMIT")
    if hasattr(ac, "__await__"):
        ac = await ac  # type: ignore[assignment]
    exists_q = text(
        """
        SELECT 1 FROM pg_enum e
        JOIN pg_type t ON t.oid = e.enumtypid
        WHERE t.typname = 'user_role' AND e.enumlabel = :val LIMIT 1
        """,
    )
    if await ac.scalar(exists_q, {"val": "accountant"}) is None:
        await ac.execute(text("ALTER TYPE user_role ADD VALUE 'accountant'"))


async def ensure_service_catalog_tables(conn: AsyncConnection, database_url: str) -> None:
    low = database_url.lower()
    sqlite = "sqlite" in low
    pg = "postgresql" in low or "asyncpg" in low

    if sqlite:
        await conn.execute(
            text(
                """CREATE TABLE IF NOT EXISTS service_templates (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    company_id INTEGER NOT NULL,
                    pipeline_id INTEGER NOT NULL,
                    direction_id INTEGER,
                    name VARCHAR(255) NOT NULL,
                    service_type VARCHAR(32) NOT NULL DEFAULT 'single',
                    duration_days INTEGER,
                    visit_count INTEGER,
                    price_base NUMERIC(14, 2) NOT NULL DEFAULT 0,
                    specialist_ids TEXT NOT NULL DEFAULT '[]',
                    course_streams_enabled INTEGER NOT NULL DEFAULT 0,
                    course_stream_max_days INTEGER NOT NULL DEFAULT 15,
                    course_stream_min_day_for_next INTEGER NOT NULL DEFAULT 10,
                    course_stream_gap_days INTEGER NOT NULL DEFAULT 10,
                    is_active INTEGER NOT NULL DEFAULT 1,
                    is_legacy INTEGER NOT NULL DEFAULT 0,
                    created_at DATETIME
                )""",
            ),
        )
        await conn.execute(
            text(
                """CREATE TABLE IF NOT EXISTS service_payment_rules (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    template_id INTEGER NOT NULL,
                    sort_order INTEGER NOT NULL DEFAULT 1,
                    label VARCHAR(120),
                    kind VARCHAR(16) NOT NULL DEFAULT 'percent',
                    value NUMERIC(14, 4) NOT NULL DEFAULT 0,
                    trigger_type VARCHAR(32) NOT NULL DEFAULT 'on_enrollment',
                    trigger_day INTEGER,
                    trigger_days_offset INTEGER
                )""",
            ),
        )
        await conn.execute(
            text(
                """CREATE TABLE IF NOT EXISTS patient_service_enrollments (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    company_id INTEGER NOT NULL,
                    lead_id INTEGER NOT NULL,
                    template_id INTEGER NOT NULL,
                    pipeline_id INTEGER NOT NULL,
                    direction_id INTEGER,
                    started_at DATETIME,
                    status VARCHAR(24) NOT NULL DEFAULT 'active',
                    total_price NUMERIC(14, 2) NOT NULL DEFAULT 0
                )""",
            ),
        )
        await conn.execute(
            text(
                """CREATE TABLE IF NOT EXISTS payment_installments (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    enrollment_id INTEGER NOT NULL,
                    sort_order INTEGER NOT NULL DEFAULT 1,
                    label VARCHAR(120),
                    amount NUMERIC(14, 2) NOT NULL DEFAULT 0,
                    due_date DATETIME NOT NULL,
                    status VARCHAR(24) NOT NULL DEFAULT 'pending',
                    paid_at DATETIME,
                    journal_entry_id INTEGER,
                    reminder_sent_at DATETIME
                )""",
            ),
        )
        await conn.execute(
            text(
                """CREATE TABLE IF NOT EXISTS finance_gmail_inbox (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    company_id INTEGER NOT NULL,
                    gmail_message_id VARCHAR(128) NOT NULL,
                    subject VARCHAR(500),
                    sender VARCHAR(320),
                    attachment_name VARCHAR(255),
                    status VARCHAR(24) NOT NULL DEFAULT 'pending',
                    parsed_summary TEXT,
                    created_at DATETIME
                )""",
            ),
        )
        r = await conn.execute(text("PRAGMA table_info(booking_directions)"))
        dcols = {row[1] for row in r.fetchall()}
        for col, ddl in (
            ("course_streams_enabled", "INTEGER NOT NULL DEFAULT 0"),
            ("course_stream_max_days", "INTEGER NOT NULL DEFAULT 15"),
            ("course_stream_min_day_for_next", "INTEGER NOT NULL DEFAULT 10"),
            ("course_stream_gap_days", "INTEGER NOT NULL DEFAULT 10"),
        ):
            if col not in dcols:
                await conn.execute(text(f"ALTER TABLE booking_directions ADD COLUMN {col} {ddl}"))
        return

    if pg:
        await conn.execute(
            text(
                """CREATE TABLE IF NOT EXISTS service_templates (
                    id SERIAL PRIMARY KEY,
                    company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
                    pipeline_id INTEGER NOT NULL REFERENCES pipelines(id) ON DELETE CASCADE,
                    direction_id INTEGER REFERENCES booking_directions(id) ON DELETE SET NULL,
                    name VARCHAR(255) NOT NULL,
                    service_type VARCHAR(32) NOT NULL DEFAULT 'single',
                    duration_days INTEGER,
                    visit_count INTEGER,
                    price_base NUMERIC(14, 2) NOT NULL DEFAULT 0,
                    specialist_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
                    course_streams_enabled BOOLEAN NOT NULL DEFAULT FALSE,
                    course_stream_max_days INTEGER NOT NULL DEFAULT 15,
                    course_stream_min_day_for_next INTEGER NOT NULL DEFAULT 10,
                    course_stream_gap_days INTEGER NOT NULL DEFAULT 10,
                    is_active BOOLEAN NOT NULL DEFAULT TRUE,
                    is_legacy BOOLEAN NOT NULL DEFAULT FALSE,
                    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
                )""",
            ),
        )
        await conn.execute(
            text(
                """CREATE TABLE IF NOT EXISTS service_payment_rules (
                    id SERIAL PRIMARY KEY,
                    template_id INTEGER NOT NULL REFERENCES service_templates(id) ON DELETE CASCADE,
                    sort_order INTEGER NOT NULL DEFAULT 1,
                    label VARCHAR(120),
                    kind VARCHAR(16) NOT NULL DEFAULT 'percent',
                    value NUMERIC(14, 4) NOT NULL DEFAULT 0,
                    trigger_type VARCHAR(32) NOT NULL DEFAULT 'on_enrollment',
                    trigger_day INTEGER,
                    trigger_days_offset INTEGER
                )""",
            ),
        )
        await conn.execute(
            text(
                """CREATE TABLE IF NOT EXISTS patient_service_enrollments (
                    id SERIAL PRIMARY KEY,
                    company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
                    lead_id INTEGER NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
                    template_id INTEGER NOT NULL REFERENCES service_templates(id) ON DELETE RESTRICT,
                    pipeline_id INTEGER NOT NULL REFERENCES pipelines(id) ON DELETE CASCADE,
                    direction_id INTEGER REFERENCES booking_directions(id) ON DELETE SET NULL,
                    started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                    status VARCHAR(24) NOT NULL DEFAULT 'active',
                    total_price NUMERIC(14, 2) NOT NULL DEFAULT 0
                )""",
            ),
        )
        await conn.execute(
            text(
                """CREATE TABLE IF NOT EXISTS payment_installments (
                    id SERIAL PRIMARY KEY,
                    enrollment_id INTEGER NOT NULL REFERENCES patient_service_enrollments(id) ON DELETE CASCADE,
                    sort_order INTEGER NOT NULL DEFAULT 1,
                    label VARCHAR(120),
                    amount NUMERIC(14, 2) NOT NULL DEFAULT 0,
                    due_date TIMESTAMPTZ NOT NULL,
                    status VARCHAR(24) NOT NULL DEFAULT 'pending',
                    paid_at TIMESTAMPTZ,
                    journal_entry_id INTEGER REFERENCES finance_journal_entries(id) ON DELETE SET NULL,
                    reminder_sent_at TIMESTAMPTZ
                )""",
            ),
        )
        await conn.execute(
            text(
                """CREATE TABLE IF NOT EXISTS finance_gmail_inbox (
                    id SERIAL PRIMARY KEY,
                    company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
                    gmail_message_id VARCHAR(128) NOT NULL,
                    subject VARCHAR(500),
                    sender VARCHAR(320),
                    attachment_name VARCHAR(255),
                    status VARCHAR(24) NOT NULL DEFAULT 'pending',
                    parsed_summary TEXT,
                    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
                )""",
            ),
        )
        await conn.execute(
            text("ALTER TABLE booking_directions ADD COLUMN IF NOT EXISTS course_streams_enabled BOOLEAN NOT NULL DEFAULT FALSE"),
        )
        await conn.execute(
            text("ALTER TABLE booking_directions ADD COLUMN IF NOT EXISTS course_stream_max_days INTEGER NOT NULL DEFAULT 15"),
        )
        await conn.execute(
            text(
                "ALTER TABLE booking_directions ADD COLUMN IF NOT EXISTS course_stream_min_day_for_next INTEGER NOT NULL DEFAULT 10",
            ),
        )
        await conn.execute(
            text("ALTER TABLE booking_directions ADD COLUMN IF NOT EXISTS course_stream_gap_days INTEGER NOT NULL DEFAULT 10"),
        )


async def ensure_finance_osv_tables(conn: AsyncConnection, database_url: str) -> None:
    sqlite = "sqlite" in database_url
    pg = not sqlite
    if sqlite:
        await conn.execute(
            text(
                """CREATE TABLE IF NOT EXISTS finance_osv_rows (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    company_id INTEGER NOT NULL,
                    txn_date DATE NOT NULL,
                    partner_amount NUMERIC(14, 2),
                    service_period VARCHAR(64),
                    revenue NUMERIC(14, 2) NOT NULL DEFAULT 0,
                    expense NUMERIC(14, 2) NOT NULL DEFAULT 0,
                    bank VARCHAR(64),
                    basis VARCHAR(255),
                    counterparty VARCHAR(255),
                    phone VARCHAR(64),
                    via_person VARCHAR(128),
                    product_service VARCHAR(255),
                    article VARCHAR(128),
                    detail_category VARCHAR(128),
                    brief_category VARCHAR(64),
                    source VARCHAR(24) NOT NULL DEFAULT 'manual',
                    external_key VARCHAR(255),
                    created_at DATETIME,
                    UNIQUE(company_id, external_key)
                )""",
            ),
        )
        return
    if pg:
        await conn.execute(
            text(
                """CREATE TABLE IF NOT EXISTS finance_osv_rows (
                    id SERIAL PRIMARY KEY,
                    company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
                    txn_date DATE NOT NULL,
                    partner_amount NUMERIC(14, 2),
                    service_period VARCHAR(64),
                    revenue NUMERIC(14, 2) NOT NULL DEFAULT 0,
                    expense NUMERIC(14, 2) NOT NULL DEFAULT 0,
                    bank VARCHAR(64),
                    basis VARCHAR(255),
                    counterparty VARCHAR(255),
                    phone VARCHAR(64),
                    via_person VARCHAR(128),
                    product_service VARCHAR(255),
                    article VARCHAR(128),
                    detail_category VARCHAR(128),
                    brief_category VARCHAR(64),
                    source VARCHAR(24) NOT NULL DEFAULT 'manual',
                    external_key VARCHAR(255),
                    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                    CONSTRAINT uq_finance_osv_company_external UNIQUE (company_id, external_key)
                )""",
            ),
        )
        await conn.execute(text("CREATE INDEX IF NOT EXISTS ix_finance_osv_rows_company_id ON finance_osv_rows (company_id)"))
        await conn.execute(text("CREATE INDEX IF NOT EXISTS ix_finance_osv_rows_txn_date ON finance_osv_rows (txn_date)"))

