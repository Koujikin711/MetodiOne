"""Стандартные стадии новой воронки (имена совпадают с настройками онлайн-записи)."""

from app.config import settings
from app.schemas.pipeline import PipelineStageCreate


def default_pipeline_stage_creates() -> list[PipelineStageCreate]:
    specs: list[tuple[str, int, str]] = [
        ("Новый", 0, "#64748b"),
        (settings.booking_queue_stage_name, 1, "#6366f1"),
        (settings.booking_stage_after_book, 2, "#8b5cf6"),
        (settings.booking_stage_completed, 3, "#22c55e"),
        (settings.booking_stage_lost, 4, "#ef4444"),
    ]
    return [PipelineStageCreate(name=n, order=o, color=c) for n, o, c in specs]
