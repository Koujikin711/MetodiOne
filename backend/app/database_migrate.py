"""Лёгкие правки схемы без Alembic (SQLite / PostgreSQL)."""

import json

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncConnection


async def ensure_booking_specialist_columns(conn: AsyncConnection, database_url: str) -> None:
    if "sqlite" in database_url:
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
        if "work_end_hour" not in cols:
            await conn.execute(
                text("ALTER TABLE booking_specialists ADD COLUMN work_end_hour INTEGER NOT NULL DEFAULT 18"),
            )
        if "work_weekdays" not in cols:
            await conn.execute(text("ALTER TABLE booking_specialists ADD COLUMN work_weekdays TEXT"))

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
        return

    if "postgresql" in database_url or "asyncpg" in database_url:
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
        return
