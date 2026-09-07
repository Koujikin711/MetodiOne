"""Visibility of chat threads by lead vs thread pipeline."""

from app.routers.chat import _thread_pipeline_allowed


def test_thread_pipeline_allowed_uses_or():
    clause = _thread_pipeline_allowed({1, 2})
    # SQLAlchemy BooleanClauseList — оба столбца в выражении.
    sql = str(clause.compile(compile_kwargs={"literal_binds": True}))
    assert "chat_threads.pipeline_id" in sql.lower() or "pipeline_id" in sql.lower()
    assert " OR " in sql.upper()
