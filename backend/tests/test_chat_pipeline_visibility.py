"""Visibility of chat threads by lead vs thread pipeline."""

from sqlalchemy import select

from app.models import Lead
from app.routers.chat import _apply_lead_created_month, _thread_pipeline_allowed


def test_thread_pipeline_allowed_uses_or():
    clause = _thread_pipeline_allowed({1, 2})
    # SQLAlchemy BooleanClauseList — оба столбца в выражении.
    sql = str(clause.compile(compile_kwargs={"literal_binds": True}))
    assert "chat_threads.pipeline_id" in sql.lower() or "pipeline_id" in sql.lower()
    assert " OR " in sql.upper()


def test_chat_month_includes_archive_handout():
    query = _apply_lead_created_month(select(Lead.id), year_month="2026-09")
    sql = str(query.compile(compile_kwargs={"literal_binds": True})).lower()
    assert "created_at" in sql
    assert "reactivated_at" in sql
    assert " or " in sql
