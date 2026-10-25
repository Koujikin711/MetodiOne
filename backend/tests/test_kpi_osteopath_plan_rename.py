"""С октября 2026 строка процента «Остеопат» становится «Консультация»."""

import asyncio
from pathlib import Path

from sqlalchemy import text
from sqlalchemy.ext.asyncio import create_async_engine

from app.database_migrate import ensure_kpi_plan_osteopath_to_consultation


SCHEMA = """
CREATE TABLE booking_directions (
    id INTEGER PRIMARY KEY,
    company_id INTEGER NOT NULL,
    name TEXT NOT NULL
);
CREATE TABLE sales_kpi_plan_items (
    id INTEGER PRIMARY KEY,
    company_id INTEGER NOT NULL,
    pipeline_id INTEGER NOT NULL,
    year_month TEXT NOT NULL,
    name TEXT NOT NULL,
    manager_percent NUMERIC NOT NULL DEFAULT 0,
    direction_id INTEGER,
    sort_order INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE sales_kpi_plan_item_specialists (
    id INTEGER PRIMARY KEY,
    plan_item_id INTEGER NOT NULL,
    specialist_id INTEGER NOT NULL
);
CREATE TABLE sales_kpi_plan_item_services (
    id INTEGER PRIMARY KEY,
    plan_item_id INTEGER NOT NULL,
    direction_id INTEGER NOT NULL
);
CREATE TABLE sales_kpi_manual_sales (
    id INTEGER PRIMARY KEY,
    plan_item_id INTEGER NOT NULL
);
"""


def test_october_osteopath_percent_moves_to_consultation(tmp_path: Path):
    db_path = tmp_path / "plan.sqlite3"
    engine = create_async_engine(f"sqlite+aiosqlite:///{db_path}")

    async def _run() -> None:
        async with engine.begin() as conn:
            for stmt in SCHEMA.split(";"):
                if stmt.strip():
                    await conn.execute(text(stmt))
            await conn.execute(
                text(
                    """
                    INSERT INTO booking_directions (id, company_id, name) VALUES
                      (1, 1, 'Остиопат'),
                      (2, 1, 'Консультация'),
                      (3, 1, 'Консультация (продажи)'),
                      (4, 1, 'Консультация [архив #1]')
                    """
                ),
            )
            await conn.execute(
                text(
                    """
                    INSERT INTO sales_kpi_plan_items
                      (id, company_id, pipeline_id, year_month, name, manager_percent, direction_id, sort_order)
                    VALUES
                      (1, 1, 1, '2026-09-01', 'Остеопат', 4, 1, 1),
                      (2, 1, 1, '2026-10-01', 'Остеопат', 4, 1, 1),
                      (3, 1, 1, '2026-10-01', 'Курс 15', 10, NULL, 0),
                      (4, 1, 1, '2026-11-01', 'Остиопат', 4, 1, 1)
                    """
                ),
            )
            await conn.execute(
                text("INSERT INTO sales_kpi_plan_item_specialists (id, plan_item_id, specialist_id) VALUES (1, 2, 9)"),
            )
            await conn.execute(
                text("INSERT INTO sales_kpi_plan_item_services (id, plan_item_id, direction_id) VALUES (1, 2, 1)"),
            )
            await ensure_kpi_plan_osteopath_to_consultation(conn, "sqlite+aiosqlite:///")
            await ensure_kpi_plan_osteopath_to_consultation(conn, "sqlite+aiosqlite:///")

            rows = (
                await conn.execute(
                    text(
                        """
                        SELECT id, year_month, name, manager_percent, direction_id
                        FROM sales_kpi_plan_items
                        ORDER BY id
                        """
                    ),
                )
            ).mappings().all()
            by_id = {int(row["id"]): row for row in rows}
            assert by_id[1]["name"] == "Остеопат"
            assert int(by_id[1]["direction_id"]) == 1
            assert by_id[2]["name"] == "Консультация"
            assert str(by_id[2]["manager_percent"]) in {"4", "4.0", "4.00"}
            assert int(by_id[2]["direction_id"]) == 2
            assert by_id[3]["name"] == "Курс 15"
            assert by_id[4]["name"] == "Консультация"
            assert int(by_id[4]["direction_id"]) == 2
            specs = (
                await conn.execute(text("SELECT COUNT(*) FROM sales_kpi_plan_item_specialists"))
            ).scalar_one()
            links = (
                await conn.execute(text("SELECT COUNT(*) FROM sales_kpi_plan_item_services"))
            ).scalar_one()
            assert int(specs) == 0
            assert int(links) == 0

        await engine.dispose()

    asyncio.run(_run())


def test_existing_consultation_row_drops_osteopath_without_sales(tmp_path: Path):
    db_path = tmp_path / "both.sqlite3"
    engine = create_async_engine(f"sqlite+aiosqlite:///{db_path}")

    async def _run() -> None:
        async with engine.begin() as conn:
            for stmt in SCHEMA.split(";"):
                if stmt.strip():
                    await conn.execute(text(stmt))
            await conn.execute(
                text("INSERT INTO booking_directions (id, company_id, name) VALUES (2, 1, 'Консультация')"),
            )
            await conn.execute(
                text(
                    """
                    INSERT INTO sales_kpi_plan_items
                      (id, company_id, pipeline_id, year_month, name, manager_percent, direction_id, sort_order)
                    VALUES
                      (1, 1, 1, '2026-10-01', 'Консультация', 4, 2, 1),
                      (2, 1, 1, '2026-10-01', 'Остеопат', 4, NULL, 2)
                    """
                ),
            )
            await ensure_kpi_plan_osteopath_to_consultation(conn, "sqlite+aiosqlite:///")
            names = (
                await conn.execute(text("SELECT name FROM sales_kpi_plan_items ORDER BY id"))
            ).scalars().all()
            assert list(names) == ["Консультация"]
        await engine.dispose()

    asyncio.run(_run())
