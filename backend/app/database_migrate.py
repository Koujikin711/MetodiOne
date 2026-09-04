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
        if ba_cols and "payment_method" not in ba_cols:
            await conn.execute(text("ALTER TABLE booking_appointments ADD COLUMN payment_method VARCHAR(16)"))
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
            text("ALTER TABLE booking_appointments ADD COLUMN IF NOT EXISTS payment_method VARCHAR(16)"),
        )
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
            ins_cols = ["name", "is_active", "created_at"]
            ins_vals = ["'Default Company'", "1", "CURRENT_TIMESTAMP"]
            if "billing_status" in company_cols:
                ins_cols.append("billing_status")
                ins_vals.append("'active'")
            await conn.execute(
                text(
                    f"INSERT INTO companies({', '.join(ins_cols)}) VALUES ({', '.join(ins_vals)})",
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
    """Таблицы KPI: цены услуг, планы, взвешенный план и продажи курсов/протоколов."""
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
        await conn.execute(
            text(
                """CREATE TABLE IF NOT EXISTS sales_kpi_weighted_settings (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    company_id INTEGER NOT NULL,
                    pipeline_id INTEGER NOT NULL,
                    year_month DATE NOT NULL,
                    bonus_fund NUMERIC(14, 2) NOT NULL DEFAULT 10000,
                    UNIQUE (company_id, pipeline_id, year_month)
                )""",
            ),
        )
        await conn.execute(
            text(
                """CREATE TABLE IF NOT EXISTS sales_kpi_plan_items (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    company_id INTEGER NOT NULL,
                    pipeline_id INTEGER NOT NULL,
                    year_month DATE NOT NULL,
                    name VARCHAR(255) NOT NULL,
                    plan_qty INTEGER NOT NULL DEFAULT 0,
                    weight_percent NUMERIC(8, 2) NOT NULL DEFAULT 0,
                    source_type VARCHAR(32) NOT NULL DEFAULT 'manual',
                    direction_id INTEGER,
                    sort_order INTEGER NOT NULL DEFAULT 0,
                    UNIQUE (company_id, pipeline_id, year_month, name)
                )""",
            ),
        )
        await conn.execute(
            text(
                """CREATE TABLE IF NOT EXISTS sales_kpi_manual_sales (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    company_id INTEGER NOT NULL,
                    pipeline_id INTEGER NOT NULL,
                    plan_item_id INTEGER NOT NULL,
                    manager_user_id INTEGER NOT NULL,
                    client_name VARCHAR(255) NOT NULL,
                    client_phone VARCHAR(64) NOT NULL,
                    service_amount NUMERIC(14, 2) NOT NULL DEFAULT 0,
                    paid_amount NUMERIC(14, 2) NOT NULL DEFAULT 0,
                    sold_at DATETIME,
                    status VARCHAR(24) NOT NULL DEFAULT 'active',
                    returned_at DATETIME,
                    note TEXT,
                    created_by_user_id INTEGER,
                    created_at DATETIME,
                    updated_at DATETIME
                )""",
            ),
        )
        await conn.execute(
            text(
                """CREATE TABLE IF NOT EXISTS sales_kpi_plan_item_specialists (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    plan_item_id INTEGER NOT NULL,
                    specialist_id INTEGER NOT NULL,
                    UNIQUE (plan_item_id, specialist_id)
                )""",
            ),
        )
        cols = {row[1] for row in (await conn.execute(text("PRAGMA table_info(sales_kpi_manual_sales)"))).fetchall()}
        if "stream_no" not in cols:
            await conn.execute(text("ALTER TABLE sales_kpi_manual_sales ADD COLUMN stream_no INTEGER"))
        if "group_no" not in cols:
            await conn.execute(text("ALTER TABLE sales_kpi_manual_sales ADD COLUMN group_no INTEGER"))
            # Старые «Поток N» → Группа; поток задаётся отдельно (1…10)
            await conn.execute(
                text(
                    "UPDATE sales_kpi_manual_sales SET group_no = stream_no "
                    "WHERE group_no IS NULL AND stream_no IS NOT NULL"
                )
            )
            await conn.execute(text("UPDATE sales_kpi_manual_sales SET stream_no = NULL WHERE stream_no IS NOT NULL"))
        if "status_reason" not in cols:
            await conn.execute(text("ALTER TABLE sales_kpi_manual_sales ADD COLUMN status_reason TEXT"))
        if "first_paid_amount" not in cols:
            await conn.execute(
                text(
                    "ALTER TABLE sales_kpi_manual_sales ADD COLUMN first_paid_amount NUMERIC(14, 2) NOT NULL DEFAULT 0",
                ),
            )
            await conn.execute(
                text(
                    "UPDATE sales_kpi_manual_sales SET first_paid_amount = paid_amount "
                    "WHERE first_paid_amount = 0 AND paid_amount > 0",
                ),
            )
        await conn.execute(
            text(
                """CREATE TABLE IF NOT EXISTS sales_kpi_manual_sale_payments (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    company_id INTEGER NOT NULL,
                    sale_id INTEGER NOT NULL,
                    amount NUMERIC(14, 2) NOT NULL DEFAULT 0,
                    is_first INTEGER NOT NULL DEFAULT 0,
                    note TEXT,
                    paid_at DATETIME,
                    created_by_user_id INTEGER,
                    created_at DATETIME
                )""",
            ),
        )
        await conn.execute(
            text(
                "CREATE INDEX IF NOT EXISTS idx_sales_kpi_manual_sale_payments_sale "
                "ON sales_kpi_manual_sale_payments(sale_id, id)",
            ),
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
        await conn.execute(
            text(
                """CREATE TABLE IF NOT EXISTS sales_kpi_weighted_settings (
                    id SERIAL PRIMARY KEY,
                    company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
                    pipeline_id INTEGER NOT NULL REFERENCES pipelines(id) ON DELETE CASCADE,
                    year_month DATE NOT NULL,
                    bonus_fund NUMERIC(14, 2) NOT NULL DEFAULT 10000,
                    CONSTRAINT uq_sales_kpi_weighted_settings_scope UNIQUE (company_id, pipeline_id, year_month)
                )""",
            ),
        )
        await conn.execute(
            text(
                """CREATE TABLE IF NOT EXISTS sales_kpi_plan_items (
                    id SERIAL PRIMARY KEY,
                    company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
                    pipeline_id INTEGER NOT NULL REFERENCES pipelines(id) ON DELETE CASCADE,
                    year_month DATE NOT NULL,
                    name VARCHAR(255) NOT NULL,
                    plan_qty INTEGER NOT NULL DEFAULT 0,
                    weight_percent NUMERIC(8, 2) NOT NULL DEFAULT 0,
                    source_type VARCHAR(32) NOT NULL DEFAULT 'manual',
                    direction_id INTEGER REFERENCES booking_directions(id) ON DELETE SET NULL,
                    sort_order INTEGER NOT NULL DEFAULT 0,
                    CONSTRAINT uq_sales_kpi_plan_item_name UNIQUE (company_id, pipeline_id, year_month, name)
                )""",
            ),
        )
        await conn.execute(
            text(
                """CREATE TABLE IF NOT EXISTS sales_kpi_manual_sales (
                    id SERIAL PRIMARY KEY,
                    company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
                    pipeline_id INTEGER NOT NULL REFERENCES pipelines(id) ON DELETE CASCADE,
                    plan_item_id INTEGER NOT NULL REFERENCES sales_kpi_plan_items(id) ON DELETE RESTRICT,
                    manager_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                    client_name VARCHAR(255) NOT NULL,
                    client_phone VARCHAR(64) NOT NULL,
                    service_amount NUMERIC(14, 2) NOT NULL DEFAULT 0,
                    paid_amount NUMERIC(14, 2) NOT NULL DEFAULT 0,
                    sold_at TIMESTAMPTZ,
                    status VARCHAR(24) NOT NULL DEFAULT 'active',
                    returned_at TIMESTAMPTZ,
                    note TEXT,
                    created_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
                    created_at TIMESTAMPTZ,
                    updated_at TIMESTAMPTZ
                )""",
            ),
        )
        await conn.execute(
            text(
                "CREATE INDEX IF NOT EXISTS idx_sales_kpi_manual_sales_company_pipeline_sold "
                "ON sales_kpi_manual_sales(company_id, pipeline_id, sold_at)",
            ),
        )
        await conn.execute(
            text(
                """CREATE TABLE IF NOT EXISTS sales_kpi_plan_item_specialists (
                    id SERIAL PRIMARY KEY,
                    plan_item_id INTEGER NOT NULL REFERENCES sales_kpi_plan_items(id) ON DELETE CASCADE,
                    specialist_id INTEGER NOT NULL REFERENCES booking_specialists(id) ON DELETE CASCADE,
                    CONSTRAINT uq_sales_kpi_plan_item_specialist UNIQUE (plan_item_id, specialist_id)
                )""",
            ),
        )
        await conn.execute(
            text("ALTER TABLE sales_kpi_manual_sales ADD COLUMN IF NOT EXISTS stream_no INTEGER"),
        )
        # group_no: один раз переносим старые stream_no → группа
        group_exists = (
            await conn.execute(
                text(
                    "SELECT 1 FROM information_schema.columns "
                    "WHERE table_name = 'sales_kpi_manual_sales' AND column_name = 'group_no'"
                )
            )
        ).first()
        if not group_exists:
            await conn.execute(text("ALTER TABLE sales_kpi_manual_sales ADD COLUMN group_no INTEGER"))
            await conn.execute(
                text(
                    "UPDATE sales_kpi_manual_sales SET group_no = stream_no "
                    "WHERE group_no IS NULL AND stream_no IS NOT NULL"
                )
            )
            await conn.execute(text("UPDATE sales_kpi_manual_sales SET stream_no = NULL WHERE stream_no IS NOT NULL"))
        await conn.execute(
            text("ALTER TABLE sales_kpi_manual_sales ADD COLUMN IF NOT EXISTS status_reason TEXT"),
        )
        await conn.execute(
            text(
                "ALTER TABLE sales_kpi_manual_sales ADD COLUMN IF NOT EXISTS "
                "first_paid_amount NUMERIC(14, 2) NOT NULL DEFAULT 0",
            ),
        )
        await conn.execute(
            text(
                "UPDATE sales_kpi_manual_sales SET first_paid_amount = paid_amount "
                "WHERE first_paid_amount = 0 AND paid_amount > 0",
            ),
        )
        await conn.execute(
            text(
                """CREATE TABLE IF NOT EXISTS sales_kpi_manual_sale_payments (
                    id SERIAL PRIMARY KEY,
                    company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
                    sale_id INTEGER NOT NULL REFERENCES sales_kpi_manual_sales(id) ON DELETE CASCADE,
                    amount NUMERIC(14, 2) NOT NULL DEFAULT 0,
                    is_first BOOLEAN NOT NULL DEFAULT FALSE,
                    note TEXT,
                    paid_at TIMESTAMPTZ,
                    created_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
                    created_at TIMESTAMPTZ
                )""",
            ),
        )
        await conn.execute(
            text(
                "CREATE INDEX IF NOT EXISTS idx_sales_kpi_manual_sale_payments_sale "
                "ON sales_kpi_manual_sale_payments(sale_id, id)",
            ),
        )


async def ensure_chat_performance_indexes(conn: AsyncConnection, database_url: str) -> None:
    low = database_url.lower()
    if "sqlite" in low:
        try:
            await conn.execute(
                text("ALTER TABLE chat_threads ADD COLUMN last_message_direction VARCHAR(8)"),
            )
        except Exception:  # noqa: BLE001 — column may already exist
            pass
        try:
            await conn.execute(
                text(
                    """
                    UPDATE chat_threads
                    SET last_message_direction = (
                        SELECT m.direction FROM chat_messages m
                        WHERE m.thread_id = chat_threads.id
                        ORDER BY m.id DESC LIMIT 1
                    )
                    WHERE last_message_direction IS NULL
                    """
                ),
            )
        except Exception:  # noqa: BLE001
            pass
        await conn.execute(
            text("CREATE INDEX IF NOT EXISTS idx_chat_threads_company_pipeline_updated ON chat_threads(company_id, pipeline_id, updated_at, id)"),
        )
        await conn.execute(
            text("CREATE INDEX IF NOT EXISTS idx_chat_threads_company_lead ON chat_threads(company_id, lead_id)"),
        )
        await conn.execute(
            text(
                "CREATE INDEX IF NOT EXISTS idx_chat_threads_company_pipeline_last_dir "
                "ON chat_threads(company_id, pipeline_id, last_message_direction)",
            ),
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
            text("ALTER TABLE chat_threads ADD COLUMN IF NOT EXISTS last_message_direction VARCHAR(8)"),
        )
        # One-shot backfill — только пока есть NULL (полный DISTINCT ON по messages
        # на каждом старте держит Amvera в 503 на минуты).
        need_backfill = (
            await conn.execute(
                text(
                    "SELECT 1 FROM chat_threads WHERE last_message_direction IS NULL LIMIT 1"
                )
            )
        ).first()
        if need_backfill is not None:
            await conn.execute(
                text(
                    """
                    UPDATE chat_threads AS t
                    SET last_message_direction = m.direction
                    FROM (
                        SELECT DISTINCT ON (thread_id) thread_id, direction
                        FROM chat_messages
                        ORDER BY thread_id, id DESC
                    ) AS m
                    WHERE t.id = m.thread_id
                      AND t.last_message_direction IS NULL
                    """
                ),
            )
        await conn.execute(
            text(
                "CREATE INDEX IF NOT EXISTS idx_chat_threads_company_pipeline_updated ON chat_threads(company_id, pipeline_id, updated_at DESC, id DESC)",
            ),
        )
        await conn.execute(
            text("CREATE INDEX IF NOT EXISTS idx_chat_threads_company_lead ON chat_threads(company_id, lead_id)"),
        )
        await conn.execute(
            text(
                "CREATE INDEX IF NOT EXISTS idx_chat_threads_company_pipeline_last_dir "
                "ON chat_threads(company_id, pipeline_id, last_message_direction)",
            ),
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


async def ensure_clinic_staff_roles(conn: AsyncConnection, database_url: str) -> None:
    """Куратор и Администратор клиники (+ гарантия accountant в enum)."""
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
    for val in ("accountant", "curator", "administrator"):
        if await ac.scalar(exists_q, {"val": val}) is None:
            await ac.execute(text(f"ALTER TYPE user_role ADD VALUE '{val}'"))


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
    low = (database_url or "").lower()
    sqlite = "sqlite" in low or "aiosqlite" in low
    pg = "postgresql" in low or "postgres" in low
    if not sqlite and not pg:
        sqlite = True
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
        await conn.execute(
            text(
                "CREATE INDEX IF NOT EXISTS ix_finance_osv_rows_company_txn_expense "
                "ON finance_osv_rows (company_id, txn_date DESC, id DESC)"
            ),
        )

    for col, ddl_sqlite, ddl_pg in (
        ("osv_sheet_url", "VARCHAR(500)", "VARCHAR(500)"),
        ("osv_sheet_name", "VARCHAR(120)", "VARCHAR(120)"),
    ):
        if sqlite:
            r = await conn.execute(text("PRAGMA table_info(finance_company_settings)"))
            cols = {row[1] for row in r.fetchall()}
            if col not in cols:
                await conn.execute(text(f"ALTER TABLE finance_company_settings ADD COLUMN {col} {ddl_sqlite}"))
        elif pg:
            await conn.execute(
                text(f"ALTER TABLE finance_company_settings ADD COLUMN IF NOT EXISTS {col} {ddl_pg}"),
            )


async def ensure_lead_extra_phones_tables(conn: AsyncConnection, database_url: str) -> None:
    low = database_url.lower()
    sqlite = "sqlite" in low
    pg = "postgresql" in low or "postgres" in low
    if sqlite:
        await conn.execute(
            text(
                """CREATE TABLE IF NOT EXISTS lead_extra_phones (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    company_id INTEGER,
                    lead_id INTEGER NOT NULL,
                    phone VARCHAR(64) NOT NULL,
                    label VARCHAR(64),
                    sort_order INTEGER NOT NULL DEFAULT 0,
                    created_at DATETIME,
                    FOREIGN KEY(company_id) REFERENCES companies(id) ON DELETE CASCADE,
                    FOREIGN KEY(lead_id) REFERENCES leads(id) ON DELETE CASCADE
                )"""
            ),
        )
        await conn.execute(
            text("CREATE INDEX IF NOT EXISTS ix_lead_extra_phones_lead_id ON lead_extra_phones (lead_id)"),
        )
        await conn.execute(
            text("CREATE INDEX IF NOT EXISTS ix_lead_extra_phones_phone ON lead_extra_phones (phone)"),
        )
    elif pg:
        await conn.execute(
            text(
                """CREATE TABLE IF NOT EXISTS lead_extra_phones (
                    id SERIAL PRIMARY KEY,
                    company_id INTEGER REFERENCES companies(id) ON DELETE CASCADE,
                    lead_id INTEGER NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
                    phone VARCHAR(64) NOT NULL,
                    label VARCHAR(64),
                    sort_order INTEGER NOT NULL DEFAULT 0,
                    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
                )"""
            ),
        )
        await conn.execute(text("CREATE INDEX IF NOT EXISTS ix_lead_extra_phones_lead_id ON lead_extra_phones (lead_id)"))
        await conn.execute(text("CREATE INDEX IF NOT EXISTS ix_lead_extra_phones_phone ON lead_extra_phones (phone)"))


async def ensure_booking_specialist_directions(conn: AsyncConnection, database_url: str) -> None:
    """Many-to-many specialist↔direction; backfill from booking_specialists.direction_id."""
    low = database_url.lower()
    sqlite = "sqlite" in low
    pg = "postgresql" in low or "postgres" in low
    if sqlite:
        await conn.execute(
            text(
                """CREATE TABLE IF NOT EXISTS booking_specialist_directions (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    specialist_id INTEGER NOT NULL REFERENCES booking_specialists(id) ON DELETE CASCADE,
                    direction_id INTEGER NOT NULL REFERENCES booking_directions(id) ON DELETE CASCADE,
                    UNIQUE (specialist_id, direction_id)
                )"""
            ),
        )
        await conn.execute(
            text(
                "CREATE INDEX IF NOT EXISTS ix_booking_specialist_directions_specialist_id "
                "ON booking_specialist_directions (specialist_id)"
            ),
        )
        await conn.execute(
            text(
                "CREATE INDEX IF NOT EXISTS ix_booking_specialist_directions_direction_id "
                "ON booking_specialist_directions (direction_id)"
            ),
        )
        await conn.execute(
            text(
                """INSERT OR IGNORE INTO booking_specialist_directions (specialist_id, direction_id)
                   SELECT id, direction_id FROM booking_specialists
                   WHERE direction_id IS NOT NULL"""
            ),
        )
    elif pg:
        await conn.execute(
            text(
                """CREATE TABLE IF NOT EXISTS booking_specialist_directions (
                    id SERIAL PRIMARY KEY,
                    specialist_id INTEGER NOT NULL REFERENCES booking_specialists(id) ON DELETE CASCADE,
                    direction_id INTEGER NOT NULL REFERENCES booking_directions(id) ON DELETE CASCADE,
                    CONSTRAINT uq_booking_specialist_direction UNIQUE (specialist_id, direction_id)
                )"""
            ),
        )
        await conn.execute(
            text(
                "CREATE INDEX IF NOT EXISTS ix_booking_specialist_directions_specialist_id "
                "ON booking_specialist_directions (specialist_id)"
            ),
        )
        await conn.execute(
            text(
                "CREATE INDEX IF NOT EXISTS ix_booking_specialist_directions_direction_id "
                "ON booking_specialist_directions (direction_id)"
            ),
        )
        await conn.execute(
            text(
                """INSERT INTO booking_specialist_directions (specialist_id, direction_id)
                   SELECT s.id, s.direction_id FROM booking_specialists s
                   WHERE s.direction_id IS NOT NULL
                     AND NOT EXISTS (
                       SELECT 1 FROM booking_specialist_directions x
                       WHERE x.specialist_id = s.id AND x.direction_id = s.direction_id
                     )"""
            ),
        )


async def ensure_sales_crm_space_migration(conn: AsyncConnection, database_url: str) -> None:
    """Второе CRM-пространство: crm_mode, desk sales, email/phone per company."""
    low = database_url.lower()
    sqlite = "sqlite" in low
    pg = "postgresql" in low or "asyncpg" in low

    if sqlite:
        r = await conn.execute(text("PRAGMA table_info(companies)"))
        cols = {row[1] for row in r.fetchall()}
        if cols and "crm_mode" not in cols:
            await conn.execute(text("ALTER TABLE companies ADD COLUMN crm_mode VARCHAR(32) DEFAULT 'clinic'"))
        await conn.execute(text("UPDATE companies SET crm_mode = 'clinic' WHERE crm_mode IS NULL OR crm_mode = ''"))

        await conn.execute(
            text(
                """CREATE TABLE IF NOT EXISTS manager_desk_sales (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    company_id INTEGER NOT NULL,
                    pipeline_id INTEGER,
                    manager_user_id INTEGER NOT NULL,
                    client_name VARCHAR(255) NOT NULL,
                    client_phone VARCHAR(64) NOT NULL,
                    activity_sphere VARCHAR(255) NOT NULL DEFAULT '',
                    service_amount NUMERIC(14, 2) NOT NULL DEFAULT 0,
                    paid_amount NUMERIC(14, 2) NOT NULL DEFAULT 0,
                    sold_at DATETIME,
                    status VARCHAR(24) NOT NULL DEFAULT 'active',
                    note TEXT,
                    created_by_user_id INTEGER,
                    created_at DATETIME,
                    updated_at DATETIME
                )"""
            ),
        )
        await conn.execute(
            text("CREATE INDEX IF NOT EXISTS ix_manager_desk_sales_company_id ON manager_desk_sales (company_id)"),
        )
        await conn.execute(
            text(
                "CREATE INDEX IF NOT EXISTS ix_manager_desk_sales_manager_user_id "
                "ON manager_desk_sales (manager_user_id)"
            ),
        )
        # SQLite: recreate unique indexes for per-company email/phone when possible
        await conn.execute(text("DROP INDEX IF EXISTS uq_users_company_email"))
        await conn.execute(text("DROP INDEX IF EXISTS uq_users_company_phone"))
        await conn.execute(
            text(
                "CREATE UNIQUE INDEX IF NOT EXISTS uq_users_company_email "
                "ON users (company_id, email) WHERE company_id IS NOT NULL"
            ),
        )
        await conn.execute(
            text(
                "CREATE UNIQUE INDEX IF NOT EXISTS uq_users_company_phone "
                "ON users (company_id, phone) WHERE company_id IS NOT NULL AND phone IS NOT NULL"
            ),
        )
        return

    if not pg:
        return

    await conn.execute(text("ALTER TABLE companies ADD COLUMN IF NOT EXISTS crm_mode VARCHAR(32) DEFAULT 'clinic'"))
    await conn.execute(text("UPDATE companies SET crm_mode = 'clinic' WHERE crm_mode IS NULL OR btrim(crm_mode) = ''"))
    await conn.execute(text("CREATE INDEX IF NOT EXISTS ix_companies_crm_mode ON companies (crm_mode)"))

    await conn.execute(
        text(
            """CREATE TABLE IF NOT EXISTS manager_desk_sales (
                id SERIAL PRIMARY KEY,
                company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
                pipeline_id INTEGER REFERENCES pipelines(id) ON DELETE SET NULL,
                manager_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                client_name VARCHAR(255) NOT NULL,
                client_phone VARCHAR(64) NOT NULL,
                activity_sphere VARCHAR(255) NOT NULL DEFAULT '',
                service_amount NUMERIC(14, 2) NOT NULL DEFAULT 0,
                paid_amount NUMERIC(14, 2) NOT NULL DEFAULT 0,
                sold_at TIMESTAMPTZ,
                status VARCHAR(24) NOT NULL DEFAULT 'active',
                note TEXT,
                created_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
                created_at TIMESTAMPTZ,
                updated_at TIMESTAMPTZ
            )"""
        ),
    )
    await conn.execute(text("CREATE INDEX IF NOT EXISTS ix_manager_desk_sales_company_id ON manager_desk_sales (company_id)"))
    await conn.execute(
        text("CREATE INDEX IF NOT EXISTS ix_manager_desk_sales_manager_user_id ON manager_desk_sales (manager_user_id)"),
    )
    await conn.execute(
        text("CREATE INDEX IF NOT EXISTS ix_manager_desk_sales_pipeline_id ON manager_desk_sales (pipeline_id)"),
    )

    # Drop global unique on users.email / users.phone (names vary by PG/SQLAlchemy)
    for cons in (
        "users_email_key",
        "uq_users_email",
        "users_phone_key",
        "uq_users_phone",
    ):
        await conn.execute(text(f"ALTER TABLE users DROP CONSTRAINT IF EXISTS {cons}"))

    await conn.execute(text("DROP INDEX IF EXISTS users_email_key"))
    await conn.execute(text("DROP INDEX IF EXISTS users_phone_key"))
    await conn.execute(text("DROP INDEX IF EXISTS ix_users_email"))
    await conn.execute(text("DROP INDEX IF EXISTS ix_users_phone"))
    await conn.execute(text("CREATE INDEX IF NOT EXISTS ix_users_email ON users (email)"))
    await conn.execute(text("CREATE INDEX IF NOT EXISTS ix_users_phone ON users (phone)"))

    await conn.execute(text("DROP INDEX IF EXISTS uq_users_company_email"))
    await conn.execute(
        text(
            "CREATE UNIQUE INDEX IF NOT EXISTS uq_users_company_email "
            "ON users (company_id, email) WHERE company_id IS NOT NULL"
        ),
    )
    await conn.execute(text("DROP INDEX IF EXISTS uq_users_company_phone"))
    await conn.execute(
        text(
            "CREATE UNIQUE INDEX IF NOT EXISTS uq_users_company_phone "
            "ON users (company_id, phone) WHERE company_id IS NOT NULL AND phone IS NOT NULL AND btrim(phone) <> ''"
        ),
    )

    # pipelines / lead_sources: allow same name in different companies
    for cons in ("pipelines_name_key", "uq_pipelines_name", "pipelines_name_key1"):
        await conn.execute(text(f"ALTER TABLE pipelines DROP CONSTRAINT IF EXISTS {cons}"))
    await conn.execute(text("DROP INDEX IF EXISTS pipelines_name_key"))
    await conn.execute(text("DROP INDEX IF EXISTS uq_pipelines_company_name"))
    await conn.execute(
        text(
            "CREATE UNIQUE INDEX IF NOT EXISTS uq_pipelines_company_name "
            "ON pipelines (company_id, name) WHERE company_id IS NOT NULL"
        ),
    )

    for cons in ("lead_sources_name_key", "uq_lead_sources_name"):
        await conn.execute(text(f"ALTER TABLE lead_sources DROP CONSTRAINT IF EXISTS {cons}"))
    await conn.execute(text("DROP INDEX IF EXISTS lead_sources_name_key"))
    await conn.execute(text("DROP INDEX IF EXISTS uq_lead_sources_company_name"))
    await conn.execute(
        text(
            "CREATE UNIQUE INDEX IF NOT EXISTS uq_lead_sources_company_name "
            "ON lead_sources (company_id, name) WHERE company_id IS NOT NULL"
        ),
    )


async def ensure_pipeline_stage_automation(conn: AsyncConnection, database_url: str) -> None:
    """Правила автоматизации при входе лида в стадию канбана."""
    low = database_url.lower()
    sqlite = "sqlite" in low
    pg = "postgresql" in low or "asyncpg" in low or "postgres" in low

    cols = (
        ("on_enter_create_task", "INTEGER" if sqlite else "BOOLEAN"),
        ("on_enter_task_title", "VARCHAR(255)"),
        ("on_enter_task_description", "TEXT"),
        ("on_enter_task_deadline_hours", "INTEGER"),
    )

    if sqlite:
        r = await conn.execute(text("PRAGMA table_info(pipeline_stages)"))
        existing = {row[1] for row in r.fetchall()}
        for name, col_type in cols:
            if name not in existing:
                await conn.execute(text(f"ALTER TABLE pipeline_stages ADD COLUMN {name} {col_type}"))
        return

    if not pg:
        return

    for name, col_type in cols:
        await conn.execute(
            text(
                f"ALTER TABLE pipeline_stages ADD COLUMN IF NOT EXISTS {name} {col_type}",
            ),
        )


async def ensure_sales_field_visits_migration(conn: AsyncConnection, database_url: str) -> None:
    """Полевой трекер визитов менеджеров (crm_mode=sales)."""
    low = database_url.lower()
    sqlite = "sqlite" in low
    pg = "postgresql" in low or "asyncpg" in low

    if sqlite:
        await conn.execute(
            text(
                """CREATE TABLE IF NOT EXISTS sales_field_visits (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    company_id INTEGER NOT NULL,
                    manager_user_id INTEGER NOT NULL,
                    manager_name VARCHAR(255) NOT NULL,
                    lead_id INTEGER,
                    client_name VARCHAR(255) NOT NULL,
                    client_phone VARCHAR(64) NOT NULL DEFAULT '',
                    enterprise_type VARCHAR(255) NOT NULL DEFAULT '',
                    lat NUMERIC(10, 7) NOT NULL,
                    lon NUMERIC(10, 7) NOT NULL,
                    accuracy_m NUMERIC(10, 2),
                    address VARCHAR(512),
                    note TEXT,
                    visited_at DATETIME,
                    created_at DATETIME
                )"""
            ),
        )
        await conn.execute(
            text("CREATE INDEX IF NOT EXISTS ix_sales_field_visits_company_id ON sales_field_visits (company_id)"),
        )
        await conn.execute(
            text(
                "CREATE INDEX IF NOT EXISTS ix_sales_field_visits_manager_user_id "
                "ON sales_field_visits (manager_user_id)"
            ),
        )
        await conn.execute(
            text("CREATE INDEX IF NOT EXISTS ix_sales_field_visits_visited_at ON sales_field_visits (visited_at)"),
        )
        return

    if not pg:
        return

    await conn.execute(
        text(
            """CREATE TABLE IF NOT EXISTS sales_field_visits (
                id SERIAL PRIMARY KEY,
                company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
                manager_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                manager_name VARCHAR(255) NOT NULL,
                lead_id INTEGER REFERENCES leads(id) ON DELETE SET NULL,
                client_name VARCHAR(255) NOT NULL,
                client_phone VARCHAR(64) NOT NULL DEFAULT '',
                enterprise_type VARCHAR(255) NOT NULL DEFAULT '',
                lat NUMERIC(10, 7) NOT NULL,
                lon NUMERIC(10, 7) NOT NULL,
                accuracy_m NUMERIC(10, 2),
                address VARCHAR(512),
                note TEXT,
                visited_at TIMESTAMPTZ,
                created_at TIMESTAMPTZ
            )"""
        ),
    )
    await conn.execute(text("CREATE INDEX IF NOT EXISTS ix_sales_field_visits_company_id ON sales_field_visits (company_id)"))
    await conn.execute(
        text("CREATE INDEX IF NOT EXISTS ix_sales_field_visits_manager_user_id ON sales_field_visits (manager_user_id)"),
    )
    await conn.execute(text("CREATE INDEX IF NOT EXISTS ix_sales_field_visits_lead_id ON sales_field_visits (lead_id)"))
    await conn.execute(text("CREATE INDEX IF NOT EXISTS ix_sales_field_visits_visited_at ON sales_field_visits (visited_at)"))


async def ensure_lead_waiting_callbacks(conn: AsyncConnection, database_url: str) -> None:
    """Callback «В ожидании»: дата связи, Боль, напоминания."""
    low = database_url.lower()
    sqlite = "sqlite" in low
    if sqlite:
        await conn.execute(
            text(
                """CREATE TABLE IF NOT EXISTS lead_waiting_callbacks (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    company_id INTEGER NOT NULL,
                    lead_id INTEGER NOT NULL,
                    manager_id INTEGER,
                    created_by_user_id INTEGER,
                    client_name VARCHAR(255) NOT NULL,
                    client_phone VARCHAR(64) NOT NULL DEFAULT '',
                    pain_text TEXT NOT NULL DEFAULT '',
                    scheduled_at DATETIME NOT NULL,
                    status VARCHAR(32) NOT NULL DEFAULT 'scheduled',
                    client_reminder_sent_at DATETIME,
                    manager_notified_at DATETIME,
                    created_at DATETIME
                )"""
            ),
        )
    else:
        await conn.execute(
            text(
                """CREATE TABLE IF NOT EXISTS lead_waiting_callbacks (
                    id SERIAL PRIMARY KEY,
                    company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
                    lead_id INTEGER NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
                    manager_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
                    created_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
                    client_name VARCHAR(255) NOT NULL,
                    client_phone VARCHAR(64) NOT NULL DEFAULT '',
                    pain_text TEXT NOT NULL DEFAULT '',
                    scheduled_at TIMESTAMPTZ NOT NULL,
                    status VARCHAR(32) NOT NULL DEFAULT 'scheduled',
                    client_reminder_sent_at TIMESTAMPTZ,
                    manager_notified_at TIMESTAMPTZ,
                    created_at TIMESTAMPTZ DEFAULT NOW()
                )"""
            ),
        )
    await conn.execute(
        text("CREATE INDEX IF NOT EXISTS ix_lead_waiting_callbacks_company_id ON lead_waiting_callbacks (company_id)"),
    )
    await conn.execute(
        text("CREATE INDEX IF NOT EXISTS ix_lead_waiting_callbacks_lead_id ON lead_waiting_callbacks (lead_id)"),
    )
    await conn.execute(
        text("CREATE INDEX IF NOT EXISTS ix_lead_waiting_callbacks_scheduled_at ON lead_waiting_callbacks (scheduled_at)"),
    )
    await conn.execute(
        text("CREATE INDEX IF NOT EXISTS ix_lead_waiting_callbacks_status ON lead_waiting_callbacks (status)"),
    )


async def ensure_lead_reactivated_at(conn: AsyncConnection, database_url: str) -> None:
    """Колонка leads.reactivated_at — grace после вечерней раздачи из Архива."""
    low = database_url.lower()
    sqlite = "sqlite" in low
    if sqlite:
        r = await conn.execute(text("PRAGMA table_info(leads)"))
        cols = {row[1] for row in r.fetchall()}
        if "reactivated_at" not in cols:
            await conn.execute(text("ALTER TABLE leads ADD COLUMN reactivated_at DATETIME"))
    else:
        await conn.execute(
            text("ALTER TABLE leads ADD COLUMN IF NOT EXISTS reactivated_at TIMESTAMPTZ"),
        )
    await conn.execute(
        text("CREATE INDEX IF NOT EXISTS ix_leads_reactivated_at ON leads (reactivated_at)"),
    )


async def ensure_lead_archived_from_stage(conn: AsyncConnection, database_url: str) -> None:
    """Колонка leads.archived_from_stage — двойная метка (напр. Удачно + Архив)."""
    low = database_url.lower()
    sqlite = "sqlite" in low
    if sqlite:
        r = await conn.execute(text("PRAGMA table_info(leads)"))
        cols = {row[1] for row in r.fetchall()}
        if "archived_from_stage" not in cols:
            await conn.execute(text("ALTER TABLE leads ADD COLUMN archived_from_stage VARCHAR(120)"))
    else:
        await conn.execute(
            text("ALTER TABLE leads ADD COLUMN IF NOT EXISTS archived_from_stage VARCHAR(120)"),
        )


async def ensure_settle_completed_booking_debts(conn: AsyncConnection, database_url: str) -> None:
    """One-shot: у уже завершённых записей с долгом проставить полную оплату.

    Нужно после введения обязательного остатка при «Пришёл» — исторические явки
    без доплаты считаем оплаченными (как на бумаге).
    """
    low = database_url.lower()
    sqlite = "sqlite" in low
    if sqlite:
        await conn.execute(
            text(
                """CREATE TABLE IF NOT EXISTS app_data_patches (
                    name TEXT PRIMARY KEY,
                    applied_at DATETIME
                )"""
            ),
        )
    else:
        await conn.execute(
            text(
                """CREATE TABLE IF NOT EXISTS app_data_patches (
                    name TEXT PRIMARY KEY,
                    applied_at TIMESTAMPTZ
                )"""
            ),
        )

    patch_name = "settle_completed_booking_debts_2026_08"
    existing = await conn.execute(
        text("SELECT 1 FROM app_data_patches WHERE name = :n LIMIT 1"),
        {"n": patch_name},
    )
    if existing.first() is not None:
        return

    await conn.execute(
        text(
            """
            UPDATE booking_appointments
            SET paid_amount = service_amount
            WHERE status = 'completed'
              AND service_amount > 0
              AND paid_amount < service_amount
            """
        ),
    )
    if sqlite:
        await conn.execute(
            text("INSERT INTO app_data_patches (name, applied_at) VALUES (:n, CURRENT_TIMESTAMP)"),
            {"n": patch_name},
        )
    else:
        await conn.execute(
            text("INSERT INTO app_data_patches (name, applied_at) VALUES (:n, NOW())"),
            {"n": patch_name},
        )


async def ensure_fix_kurs_direction_and_session_pay(conn: AsyncConnection, database_url: str) -> None:
    """One-shot: (1) Курс/протокол в service_title → правильный direction_id;
    (2) предоплата сеансов массажа размазана по дням, а не только на первый.
    """
    import logging

    log = logging.getLogger("crm.migrate")
    try:
        await _ensure_fix_kurs_direction_and_session_pay_impl(conn, database_url)
    except Exception as exc:  # noqa: BLE001 — не валим старт API из‑за one-shot патча
        log.exception("fix_kurs_direction_and_session_pay failed (skipped): %s", exc)


async def _ensure_fix_kurs_direction_and_session_pay_impl(conn: AsyncConnection, database_url: str) -> None:
    import re
    from collections import defaultdict
    from datetime import timezone

    low = database_url.lower()
    sqlite = "sqlite" in low
    if sqlite:
        await conn.execute(
            text(
                """CREATE TABLE IF NOT EXISTS app_data_patches (
                    name TEXT PRIMARY KEY,
                    applied_at DATETIME
                )"""
            ),
        )
    else:
        await conn.execute(
            text(
                """CREATE TABLE IF NOT EXISTS app_data_patches (
                    name TEXT PRIMARY KEY,
                    applied_at TIMESTAMPTZ
                )"""
            ),
        )

    patch_name = "fix_kurs_direction_and_session_pay_2026_08"
    existing = await conn.execute(
        text("SELECT 1 FROM app_data_patches WHERE name = :n LIMIT 1"),
        {"n": patch_name},
    )
    if existing.first() is not None:
        return

    def _name_key(name: str | None) -> str:
        s = re.sub(r"\s*\[архив #\d+\]\s*$", "", (name or "").strip(), flags=re.IGNORECASE)
        return " ".join(s.split()).casefold()

    def _is_course(name: str | None) -> bool:
        k = _name_key(name)
        if not k:
            return False
        if k in {"курс", "курс 15", "курс 90", "протокол", "пртокол"}:
            return True
        if k.startswith("курс ") or k.startswith("протокол"):
            return True
        if "курс" in k and ("15" in k or "90" in k or "руз" in k or "калон" in k):
            return True
        if "протокол" in k or "пртокол" in k:
            return True
        return False

    def _split_prepaid(total_paid: float, day_prices: list[float]) -> list[float]:
        remaining = max(0.0, float(total_paid or 0))
        out: list[float] = []
        for price in day_prices:
            p = max(0.0, float(price or 0))
            pay = min(remaining, p) if p > 0 else 0.0
            out.append(round(pay, 2))
            remaining = max(0.0, remaining - pay)
        if remaining > 0.009 and out:
            out[0] = round(out[0] + remaining, 2)
        return out

    dirs = (
        await conn.execute(
            text(
                "SELECT id, company_id, name, "
                "CASE WHEN course_streams_enabled THEN 1 ELSE 0 END AS cse "
                "FROM booking_directions"
            )
        )
    ).mappings().all()
    dirs_by_company: dict[int, list] = defaultdict(list)
    dir_by_id: dict[int, dict] = {}
    for d in dirs:
        row = dict(d)
        dirs_by_company[int(row["company_id"])].append(row)
        dir_by_id[int(row["id"])] = row

    def _find_course_dir(company_id: int, title: str):
        key = _name_key(title)
        rows = dirs_by_company.get(company_id, [])
        exact = [d for d in rows if _name_key(d["name"]) == key and _is_course(d["name"])]
        if exact:
            return exact[0]
        soft = []
        for d in rows:
            if not _is_course(d["name"]):
                continue
            dk = _name_key(d["name"])
            if key in dk or dk in key:
                soft.append(d)
            elif ("15" in key and "15" in dk) or ("90" in key and "90" in dk) or (
                "протокол" in key and "протокол" in dk
            ):
                soft.append(d)
        return soft[0] if soft else None

    # --- 1) Remap course/protocol titles stuck on consultation direction ---
    appts = (
        await conn.execute(
            text(
                """
                SELECT a.id, a.company_id, a.direction_id, a.service_title, a.specialist_id,
                       a.patient_phone, a.lead_id, a.start_at, a.service_amount, a.paid_amount,
                       a.status, a.created_at
                FROM booking_appointments a
                WHERE a.status IN ('booked', 'completed', 'no_show')
                """
            )
        )
    ).mappings().all()

    for a in appts:
        title = (a["service_title"] or "").strip()
        if not _is_course(title):
            continue
        cur_dir = dir_by_id.get(int(a["direction_id"]))
        if cur_dir is None:
            continue
        # Уже правильное направление-курс — пропускаем.
        if _is_course(cur_dir["name"]):
            continue
        # Чиним: title=Курс/Протокол, а direction = консультация (или другое не-курс).
        target = _find_course_dir(int(a["company_id"]), title)
        if target is None:
            continue
        if int(target["id"]) == int(a["direction_id"]):
            continue
        await conn.execute(
            text("UPDATE booking_appointments SET direction_id = :did WHERE id = :aid"),
            {"did": int(target["id"]), "aid": int(a["id"])},
        )
        # привязка направления к специалисту (если таблицы есть)
        try:
            exists_link = await conn.execute(
                text(
                    """
                    SELECT 1 FROM booking_specialist_directions
                    WHERE specialist_id = :sid AND direction_id = :did LIMIT 1
                    """
                ),
                {"sid": int(a["specialist_id"]), "did": int(target["id"])},
            )
            if exists_link.first() is None:
                await conn.execute(
                    text(
                        """
                        INSERT INTO booking_specialist_directions (specialist_id, direction_id)
                        VALUES (:sid, :did)
                        """
                    ),
                    {"sid": int(a["specialist_id"]), "did": int(target["id"])},
                )
        except Exception:
            # таблица/уникальный ключ может отличаться — направление уже на записи
            pass

    # reload appointments after remap for session pay
    appts = (
        await conn.execute(
            text(
                """
                SELECT a.id, a.company_id, a.direction_id, a.service_title, a.specialist_id,
                       a.patient_phone, a.lead_id, a.start_at, a.service_amount, a.paid_amount,
                       a.status, a.created_at
                FROM booking_appointments a
                WHERE a.status IN ('booked', 'completed', 'no_show')
                """
            )
        )
    ).mappings().all()

    specs = (
        await conn.execute(
            text(
                """
                SELECT id, CASE WHEN course_streams_enabled THEN 1 ELSE 0 END AS cse
                FROM booking_specialists
                """
            )
        )
    ).mappings().all()
    spec_cse = {int(s["id"]): bool(s["cse"]) for s in specs}

    def _session_billing(a) -> bool:
        d = dir_by_id.get(int(a["direction_id"]))
        if d and bool(d.get("cse")):
            return True
        return bool(spec_cse.get(int(a["specialist_id"])))

    def _phone_key(phone: str | None) -> str:
        digits = "".join(ch for ch in (phone or "") if ch.isdigit())
        return digits[-9:] if len(digits) >= 9 else digits

    def _ymd(dt) -> str:
        if dt is None:
            return ""
        if getattr(dt, "tzinfo", None) is None:
            # naive → treat as UTC
            return str(dt)[:10]
        # Asia/Dushanbe ≈ UTC+5 for booking calendar grouping
        from datetime import timedelta

        local = dt.astimezone(timezone.utc) + timedelta(hours=5)
        return local.strftime("%Y-%m-%d")

    # --- 2) Redistribute prepaid across consecutive session days ---
    groups: dict[tuple, list] = defaultdict(list)
    for a in appts:
        if not _session_billing(a):
            continue
        key = (
            int(a["company_id"]),
            int(a["specialist_id"]),
            _phone_key(a["patient_phone"]),
            (a["service_title"] or "").strip().casefold(),
            int(a["direction_id"]),
        )
        groups[key].append(dict(a))

    for _gkey, rows in groups.items():
        rows.sort(key=lambda r: (r["start_at"], r["id"]))
        i = 0
        while i < len(rows):
            series = [rows[i]]
            j = i + 1
            while j < len(rows):
                prev_ymd = _ymd(series[-1]["start_at"])
                cur_ymd = _ymd(rows[j]["start_at"])
                # consecutive calendar day
                try:
                    from datetime import date, timedelta

                    p = date.fromisoformat(prev_ymd)
                    c = date.fromisoformat(cur_ymd)
                    if c == p + timedelta(days=1):
                        series.append(rows[j])
                        j += 1
                        continue
                except Exception:
                    pass
                break
            if len(series) >= 2:
                day_prices = [float(r["service_amount"] or 0) for r in series]
                day_paids = [float(r["paid_amount"] or 0) for r in series]
                total_paid = sum(day_paids)
                # типичный баг: вся предоплата на первом дне, остальные 0 при service>0
                later_unpaid = any(
                    day_prices[k] > 0.009 and day_paids[k] < 0.009 for k in range(1, len(series))
                )
                first_over = day_paids[0] > day_prices[0] + 0.009
                if later_unpaid and (first_over or total_paid > day_prices[0] + 0.009):
                    new_paids = _split_prepaid(total_paid, day_prices)
                    for r, pay in zip(series, new_paids):
                        if abs(float(r["paid_amount"] or 0) - pay) > 0.009:
                            await conn.execute(
                                text(
                                    "UPDATE booking_appointments SET paid_amount = :p WHERE id = :aid"
                                ),
                                {"p": pay, "aid": int(r["id"])},
                            )
            i = j if j > i else i + 1

    if sqlite:
        await conn.execute(
            text("INSERT INTO app_data_patches (name, applied_at) VALUES (:n, CURRENT_TIMESTAMP)"),
            {"n": patch_name},
        )
    else:
        await conn.execute(
            text("INSERT INTO app_data_patches (name, applied_at) VALUES (:n, NOW())"),
            {"n": patch_name},
        )


async def ensure_fix_ayub_massage_prepaid_10x150(conn: AsyncConnection, database_url: str) -> None:
    """One-shot: Бахтиёрзода Аюб — массаж 10×150, предоплата 1500 размазана по сеансам."""
    import logging

    log = logging.getLogger("crm.migrate")
    try:
        await _fix_ayub_massage_prepaid_10x150_body(conn, database_url)
    except Exception as exc:  # noqa: BLE001
        log.exception("fix_ayub_massage_prepaid_10x150 failed (skipped): %s", exc)


async def _fix_ayub_massage_prepaid_10x150_body(conn: AsyncConnection, database_url: str) -> None:
    low = database_url.lower()
    sqlite = "sqlite" in low
    if sqlite:
        await conn.execute(
            text(
                """CREATE TABLE IF NOT EXISTS app_data_patches (
                    name TEXT PRIMARY KEY,
                    applied_at DATETIME
                )"""
            ),
        )
    else:
        await conn.execute(
            text(
                """CREATE TABLE IF NOT EXISTS app_data_patches (
                    name TEXT PRIMARY KEY,
                    applied_at TIMESTAMPTZ
                )"""
            ),
        )

    patch_name = "fix_ayub_massage_prepaid_10x150_2026_08"
    existing = await conn.execute(
        text("SELECT 1 FROM app_data_patches WHERE name = :n LIMIT 1"),
        {"n": patch_name},
    )
    if existing.first() is not None:
        return

    # 10 сеансов пакета (прод): 03–14 авг 2026, Абдулоева Рухшона.
    target_ids = (2350, 2351, 2352, 2353, 2355, 2356, 2357, 2358, 2359, 2606)
    id_list = ",".join(str(i) for i in target_ids)

    found = (
        await conn.execute(
            text(f"SELECT id FROM booking_appointments WHERE id IN ({id_list}) ORDER BY start_at ASC, id ASC")
        )
    ).scalars().all()
    ids = [int(x) for x in found]

    if len(ids) < 10:
        # fallback: телефон + окно дат + массаж
        rows = (
            await conn.execute(
                text(
                    """
                    SELECT id
                    FROM booking_appointments
                    WHERE patient_phone LIKE :phone
                      AND start_at >= :d0
                      AND start_at < :d1
                      AND lower(coalesce(service_title, '')) LIKE '%масс%'
                    ORDER BY start_at ASC, id ASC
                    """
                ),
                {
                    "phone": "%002020010%",
                    "d0": "2026-08-03T00:00:00+00:00" if not sqlite else "2026-08-03",
                    "d1": "2026-08-15T00:00:00+00:00" if not sqlite else "2026-08-15",
                },
            )
        ).scalars().all()
        ids = [int(x) for x in rows[:10]]

    for aid in ids[:10]:
        await conn.execute(
            text(
                """
                UPDATE booking_appointments
                SET service_amount = 150, paid_amount = 150
                WHERE id = :aid
                """
            ),
            {"aid": aid},
        )

    if sqlite:
        await conn.execute(
            text("INSERT INTO app_data_patches (name, applied_at) VALUES (:n, CURRENT_TIMESTAMP)"),
            {"n": patch_name},
        )
    else:
        await conn.execute(
            text("INSERT INTO app_data_patches (name, applied_at) VALUES (:n, NOW())"),
            {"n": patch_name},
        )


async def ensure_fix_aug2026_konsult_to_kurs15(conn: AsyncConnection, database_url: str) -> None:
    """One-shot: август 2026 — записи, в кассе «15-Руза», в CRM ошибочно «Консультация» → Курс 15."""
    import logging

    log = logging.getLogger("crm.migrate")
    try:
        await _fix_aug2026_konsult_to_kurs15_body(conn, database_url)
    except Exception as exc:  # noqa: BLE001
        log.exception("fix_aug2026_konsult_to_kurs15 failed (skipped): %s", exc)


async def _fix_aug2026_konsult_to_kurs15_body(conn: AsyncConnection, database_url: str) -> None:
    import logging

    log = logging.getLogger("crm.migrate")
    low = database_url.lower()
    sqlite = "sqlite" in low
    if sqlite:
        await conn.execute(
            text(
                """CREATE TABLE IF NOT EXISTS app_data_patches (
                    name TEXT PRIMARY KEY,
                    applied_at DATETIME
                )"""
            ),
        )
    else:
        await conn.execute(
            text(
                """CREATE TABLE IF NOT EXISTS app_data_patches (
                    name TEXT PRIMARY KEY,
                    applied_at TIMESTAMPTZ
                )"""
            ),
        )

    patch_name = "fix_aug2026_konsult_to_kurs15_v1"
    existing = await conn.execute(
        text("SELECT 1 FROM app_data_patches WHERE name = :n LIMIT 1"),
        {"n": patch_name},
    )
    if existing.first() is not None:
        return

    # Prod appointment ids (company 1), verified 2026-08 against cash «15-Руза Курс».
    target_ids = (
        2244,  # Чамшедзода Манучехр 06.08
        2246,  # Омонов Алиахмад 03.08
        2247,  # Сулаймони Абубакр 03.08
        2248,  # Сабзаева Сухайло 03.08
        2250,  # Омонов Ёсинчон 03.08
        2251,  # Омонов Мухаммад 03.08
        2286,  # Зоиров Умарчон 14.08
        2410,  # Махмадуллоев Мухаммад 13.08
        2413,  # Мачнунзода Мухаммад 12.08
        2417,  # Саидзода Яхё 13.08
        2444,  # Зафарзода Шахнура 06.08
        2467,  # Хуршедзода Абдулло 08.08
        2475,  # Пахлавонова Гулистон 12.08
        2584,  # Амиршоев Халидчон 13.08
    )
    id_list = ",".join(str(i) for i in target_ids)

    # Resolve Курс 15 direction per company of each appointment.
    rows = (
        await conn.execute(
            text(
                f"""
                SELECT ba.id, ba.company_id, ba.direction_id, bd.name AS dir_name
                FROM booking_appointments ba
                JOIN booking_directions bd ON bd.id = ba.direction_id
                WHERE ba.id IN ({id_list})
                """
            )
        )
    ).mappings().all()

    if not rows:
        # Nothing to fix in this DB (demo/local) — still mark applied to avoid retries.
        if sqlite:
            await conn.execute(
                text("INSERT INTO app_data_patches (name, applied_at) VALUES (:n, CURRENT_TIMESTAMP)"),
                {"n": patch_name},
            )
        else:
            await conn.execute(
                text("INSERT INTO app_data_patches (name, applied_at) VALUES (:n, NOW())"),
                {"n": patch_name},
            )
        return

    # Map company_id -> Курс 15 direction id
    kurs15_by_company: dict[int, int] = {}
    for company_id in {int(r["company_id"]) for r in rows}:
        found = (
            await conn.execute(
                text(
                    """
                    SELECT id FROM booking_directions
                    WHERE company_id = :cid
                      AND lower(trim(name)) IN ('курс 15', '15-руза курс', '15 руза курс')
                    ORDER BY id ASC
                    LIMIT 1
                    """
                ),
                {"cid": company_id},
            )
        ).first()
        if found is None:
            # fallback: name contains both курс and 15
            found = (
                await conn.execute(
                    text(
                        """
                        SELECT id FROM booking_directions
                        WHERE company_id = :cid
                          AND lower(name) LIKE '%курс%'
                          AND name LIKE '%15%'
                          AND lower(name) NOT LIKE '%архив%'
                        ORDER BY id ASC
                        LIMIT 1
                        """
                    ),
                    {"cid": company_id},
                )
            ).first()
        if found is not None:
            kurs15_by_company[company_id] = int(found[0])

    updated = 0
    for r in rows:
        aid = int(r["id"])
        cid = int(r["company_id"])
        dir_name = (r["dir_name"] or "").strip().casefold()
        # Only remap mistaken consultations (and close variants).
        if dir_name not in {"консультация", "консультация (старый дубликат)"} and "консульт" not in dir_name:
            continue
        new_dir = kurs15_by_company.get(cid)
        if not new_dir:
            log.warning("fix_aug2026_konsult_to_kurs15: no Курс 15 for company %s (appt %s)", cid, aid)
            continue
        await conn.execute(
            text(
                """
                UPDATE booking_appointments
                SET direction_id = :did,
                    service_title = 'Курс 15'
                WHERE id = :aid
                """
            ),
            {"did": new_dir, "aid": aid},
        )
        updated += 1

    log.info("fix_aug2026_konsult_to_kurs15: updated %s appointments", updated)

    if sqlite:
        await conn.execute(
            text("INSERT INTO app_data_patches (name, applied_at) VALUES (:n, CURRENT_TIMESTAMP)"),
            {"n": patch_name},
        )
    else:
        await conn.execute(
            text("INSERT INTO app_data_patches (name, applied_at) VALUES (:n, NOW())"),
            {"n": patch_name},
        )


async def ensure_fix_massage_osv_prepaid_aug2026(conn: AsyncConnection, database_url: str) -> None:
    """One-shot: разнести предоплаты массажа из ОСВ по сеансам (авг 2026) + Алия → Курс 15."""
    import logging

    log = logging.getLogger("crm.migrate")
    try:
        await _fix_massage_osv_prepaid_aug2026_body(conn, database_url)
    except Exception as exc:  # noqa: BLE001
        log.exception("fix_massage_osv_prepaid_aug2026 failed (skipped): %s", exc)


async def _fix_massage_osv_prepaid_aug2026_body(conn: AsyncConnection, database_url: str) -> None:
    low = database_url.lower()
    sqlite = "sqlite" in low
    if sqlite:
        await conn.execute(
            text(
                """CREATE TABLE IF NOT EXISTS app_data_patches (
                    name TEXT PRIMARY KEY,
                    applied_at DATETIME
                )"""
            ),
        )
    else:
        await conn.execute(
            text(
                """CREATE TABLE IF NOT EXISTS app_data_patches (
                    name TEXT PRIMARY KEY,
                    applied_at TIMESTAMPTZ
                )"""
            ),
        )

    patch_name = "fix_massage_osv_prepaid_aug2026_v1"
    existing = await conn.execute(
        text("SELECT 1 FROM app_data_patches WHERE name = :n LIMIT 1"),
        {"n": patch_name},
    )
    if existing.first() is not None:
        return

    async def _set_paid(aids: list[int] | tuple[int, ...], *, service: float, paid: float) -> None:
        for aid in aids:
            await conn.execute(
                text(
                    """
                    UPDATE booking_appointments
                    SET service_amount = :svc, paid_amount = :paid
                    WHERE id = :aid
                    """
                ),
                {"svc": service, "paid": paid, "aid": int(aid)},
            )

    # Курбонова Фотима: 900 массаж (6×150) + 600 логопед (4×150)
    await _set_paid((2304, 2723, 2502, 2744, 2745, 2746), service=150, paid=150)
    await _set_paid((2305, 2306, 2503, 2504, 2747, 2748), service=150, paid=0)
    await _set_paid((2448, 2449, 2742, 2743), service=150, paid=150)

    # Розизода Иброхим: 2250 на 14 сеансов (первый 300, остальные 150)
    await _set_paid((1900,), service=300, paid=300)
    await _set_paid(
        (1901, 2004, 2005, 2006, 2007, 2008, 2009, 2192, 2193, 2208, 2209, 2210, 2211),
        service=150,
        paid=150,
    )

    # Ибодулозода Гулбахор: 2250 = 15×150
    await _set_paid(
        (2080, 2081, 2119, 2120, 2121, 2122, 2123, 2124, 2403, 2404, 2405, 2406, 2407, 2408, 2541),
        service=150,
        paid=150,
    )
    await _set_paid((2542, 2543), service=150, paid=0)

    # Сулаймони Абубакр: 1500 = 10×150
    await _set_paid(
        (2293, 2294, 2296, 2476, 2477, 2478, 2479, 2480, 2481, 2681),
        service=150,
        paid=150,
    )
    await _set_paid((2682, 2683, 2684, 2685, 2686, 2855, 2856), service=150, paid=0)

    # Хикматов Сино: 1350 = 9×150
    await _set_paid((2805, 2907, 2908, 2909, 2910, 2911, 3055, 3056, 3057), service=150, paid=150)
    await _set_paid((3058, 3059, 3060), service=150, paid=0)

    # Хуршедзода Абдулло: 1500 = 10×150
    await _set_paid(
        (2752, 2753, 2794, 2921, 2922, 2923, 2924, 2925, 2926, 3039),
        service=150,
        paid=150,
    )

    # Яхёев Мансур: 1950 = 13×150
    await _set_paid(
        (2637, 2700, 2701, 2702, 2703, 2704, 2857, 2896, 2897, 2898, 2899, 2900, 3068),
        service=150,
        paid=150,
    )
    await _set_paid((3069, 3070), service=150, paid=0)

    # Нусратуллозода Ёсуман: 1950 = 13×150
    await _set_paid(
        (2705, 2706, 2707, 2708, 2709, 2710, 2882, 2883, 2884, 2885, 2886, 2887, 3006),
        service=150,
        paid=150,
    )
    await _set_paid((2638,), service=150, paid=0)

    # Чунайдуллозода Гулноза: 600 = 4×150
    await _set_paid((2172, 2173, 2174, 1958), service=150, paid=150)

    # Махмуров Абдулло / Махмурова Хатича: по 1350 = 9×150
    await _set_paid((2556, 2557, 2558, 2559, 2651, 2652, 2653, 2654, 2836), service=150, paid=150)
    await _set_paid((2838, 2933), service=150, paid=0)
    await _set_paid((2560, 2561, 2562, 2563, 2657, 2756, 2658, 2660, 2661), service=150, paid=150)
    await _set_paid((2837, 2927), service=150, paid=0)

    # Бахтиёрзода Алия 1000 — в документе ошибка «массаж», это Курс 15
    kurs15 = (
        await conn.execute(
            text(
                """
                SELECT id FROM booking_directions
                WHERE company_id = 1 AND lower(name) LIKE '%курс%15%'
                ORDER BY id ASC LIMIT 1
                """
            )
        )
    ).scalar_one_or_none()
    if kurs15 is not None:
        await conn.execute(
            text(
                """
                UPDATE booking_appointments
                SET direction_id = :did,
                    service_title = 'Курс 15',
                    service_amount = 1000,
                    paid_amount = 1000
                WHERE id = 2566
                """
            ),
            {"did": int(kurs15)},
        )

    if sqlite:
        await conn.execute(
            text("INSERT INTO app_data_patches (name, applied_at) VALUES (:n, CURRENT_TIMESTAMP)"),
            {"n": patch_name},
        )
    else:
        await conn.execute(
            text("INSERT INTO app_data_patches (name, applied_at) VALUES (:n, NOW())"),
            {"n": patch_name},
        )


async def ensure_extra_services_tables(conn: AsyncConnection, database_url: str) -> None:
    """Доп. услуги: типы с % нам/отдаём + журнал продаж."""
    low = database_url.lower()
    sqlite = "sqlite" in low
    if sqlite:
        await conn.execute(
            text(
                """CREATE TABLE IF NOT EXISTS extra_service_types (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    company_id INTEGER NOT NULL,
                    name VARCHAR(255) NOT NULL,
                    keep_percent NUMERIC(7, 2) NOT NULL DEFAULT 0,
                    payout_percent NUMERIC(7, 2) NOT NULL DEFAULT 0,
                    is_active BOOLEAN NOT NULL DEFAULT 1,
                    sort_order INTEGER NOT NULL DEFAULT 0,
                    created_at DATETIME,
                    updated_at DATETIME
                )"""
            ),
        )
        await conn.execute(
            text(
                """CREATE TABLE IF NOT EXISTS extra_service_sales (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    company_id INTEGER NOT NULL,
                    service_type_id INTEGER NOT NULL,
                    client_name VARCHAR(255) NOT NULL,
                    client_phone VARCHAR(64) NOT NULL DEFAULT '',
                    amount NUMERIC(14, 2) NOT NULL DEFAULT 0,
                    keep_percent NUMERIC(7, 2) NOT NULL DEFAULT 0,
                    payout_percent NUMERIC(7, 2) NOT NULL DEFAULT 0,
                    keep_amount NUMERIC(14, 2) NOT NULL DEFAULT 0,
                    payout_amount NUMERIC(14, 2) NOT NULL DEFAULT 0,
                    sold_at DATETIME,
                    note TEXT,
                    status VARCHAR(24) NOT NULL DEFAULT 'active',
                    created_by_user_id INTEGER,
                    created_at DATETIME
                )"""
            ),
        )
    else:
        await conn.execute(
            text(
                """CREATE TABLE IF NOT EXISTS extra_service_types (
                    id SERIAL PRIMARY KEY,
                    company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
                    name VARCHAR(255) NOT NULL,
                    keep_percent NUMERIC(7, 2) NOT NULL DEFAULT 0,
                    payout_percent NUMERIC(7, 2) NOT NULL DEFAULT 0,
                    is_active BOOLEAN NOT NULL DEFAULT TRUE,
                    sort_order INTEGER NOT NULL DEFAULT 0,
                    created_at TIMESTAMPTZ DEFAULT NOW(),
                    updated_at TIMESTAMPTZ DEFAULT NOW()
                )"""
            ),
        )
        await conn.execute(
            text(
                """CREATE TABLE IF NOT EXISTS extra_service_sales (
                    id SERIAL PRIMARY KEY,
                    company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
                    service_type_id INTEGER NOT NULL REFERENCES extra_service_types(id) ON DELETE RESTRICT,
                    client_name VARCHAR(255) NOT NULL,
                    client_phone VARCHAR(64) NOT NULL DEFAULT '',
                    amount NUMERIC(14, 2) NOT NULL DEFAULT 0,
                    keep_percent NUMERIC(7, 2) NOT NULL DEFAULT 0,
                    payout_percent NUMERIC(7, 2) NOT NULL DEFAULT 0,
                    keep_amount NUMERIC(14, 2) NOT NULL DEFAULT 0,
                    payout_amount NUMERIC(14, 2) NOT NULL DEFAULT 0,
                    sold_at TIMESTAMPTZ,
                    note TEXT,
                    status VARCHAR(24) NOT NULL DEFAULT 'active',
                    created_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
                    created_at TIMESTAMPTZ DEFAULT NOW()
                )"""
            ),
        )
    await conn.execute(
        text("CREATE INDEX IF NOT EXISTS ix_extra_service_types_company_id ON extra_service_types (company_id)"),
    )
    await conn.execute(
        text("CREATE INDEX IF NOT EXISTS ix_extra_service_sales_company_id ON extra_service_sales (company_id)"),
    )
    await conn.execute(
        text("CREATE INDEX IF NOT EXISTS ix_extra_service_sales_service_type_id ON extra_service_sales (service_type_id)"),
    )
    await conn.execute(
        text("CREATE INDEX IF NOT EXISTS ix_extra_service_sales_sold_at ON extra_service_sales (sold_at)"),
    )
    await conn.execute(
        text("CREATE INDEX IF NOT EXISTS ix_extra_service_sales_status ON extra_service_sales (status)"),
    )


async def ensure_fix_kurs15_price_2000_to_1300(conn: AsyncConnection, database_url: str) -> None:
    """One-shot: Курс 15 с ценой 2000 при оплате 1300 → стоимость 1300 (убирает фейковый долг 700)."""
    import logging

    log = logging.getLogger("crm.migrate")
    try:
        await _fix_kurs15_price_2000_to_1300_body(conn, database_url)
    except Exception as exc:  # noqa: BLE001
        log.exception("fix_kurs15_price_2000_to_1300 failed (skipped): %s", exc)


async def _fix_kurs15_price_2000_to_1300_body(conn: AsyncConnection, database_url: str) -> None:
    low = database_url.lower()
    sqlite = "sqlite" in low
    if sqlite:
        await conn.execute(
            text(
                """CREATE TABLE IF NOT EXISTS app_data_patches (
                    name TEXT PRIMARY KEY,
                    applied_at DATETIME
                )"""
            ),
        )
    else:
        await conn.execute(
            text(
                """CREATE TABLE IF NOT EXISTS app_data_patches (
                    name TEXT PRIMARY KEY,
                    applied_at TIMESTAMPTZ
                )"""
            ),
        )

    patch_name = "fix_kurs15_price_2000_to_1300_aug2026_v1"
    existing = await conn.execute(
        text("SELECT 1 FROM app_data_patches WHERE name = :n LIMIT 1"),
        {"n": patch_name},
    )
    if existing.first() is not None:
        return

    # Цена сеанса Курс 15 = 1300. Записи с service_amount=2000 и paid≈1300 давали ложный долг 700.
    await conn.execute(
        text(
            """
            UPDATE booking_appointments
            SET service_amount = paid_amount
            WHERE abs(service_amount - 2000) < 0.01
              AND abs(paid_amount - 1300) < 0.01
              AND (
                lower(coalesce(service_title, '')) LIKE '%курс%15%'
                OR lower(coalesce(service_title, '')) LIKE '%15%курс%'
              )
            """
        ),
    )
    if sqlite:
        await conn.execute(
            text("INSERT INTO app_data_patches (name, applied_at) VALUES (:n, CURRENT_TIMESTAMP)"),
            {"n": patch_name},
        )
    else:
        await conn.execute(
            text("INSERT INTO app_data_patches (name, applied_at) VALUES (:n, NOW())"),
            {"n": patch_name},
        )
