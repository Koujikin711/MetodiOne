"""Baseline: существующая схема создаётся через app.database_migrate при старте API.

Новые изменения добавляйте отдельными ревизиями: alembic revision -m "описание"
"""

revision = "001_baseline_note"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
