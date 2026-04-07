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
    try:
        await conn.execute(text("ALTER TYPE user_role ADD VALUE 'owner'"))
    except Exception:
        pass
    await conn.execute(text("UPDATE users SET role = 'owner' WHERE role::text = 'admin'"))
