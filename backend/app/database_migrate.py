"""Лёгкие правки схемы без Alembic (SQLite / PostgreSQL)."""

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncConnection


async def ensure_booking_specialist_columns(conn: AsyncConnection, database_url: str) -> None:
    if "sqlite" in database_url:
        r = await conn.execute(text("PRAGMA table_info(booking_specialists)"))
        cols = {row[1] for row in r.fetchall()}
        if "specialization" not in cols:
            await conn.execute(text("ALTER TABLE booking_specialists ADD COLUMN specialization VARCHAR(255)"))
        return

    if "postgresql" in database_url or "asyncpg" in database_url:
        await conn.execute(
            text(
                "ALTER TABLE booking_specialists ADD COLUMN IF NOT EXISTS specialization VARCHAR(255)"
            )
        )
        return
