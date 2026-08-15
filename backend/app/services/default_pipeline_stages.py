"""Стандартные стадии новой воронки (клиника vs sales чат-канбан)."""

from app.config import settings
from app.schemas.pipeline import PipelineStageCreate
from app.services.lead_sales_stages import SALES_CHAT_STAGE_SPECS


def default_pipeline_stage_creates(*, crm_mode: str | None = None) -> list[PipelineStageCreate]:
    mode = (crm_mode or "clinic").strip().lower()
    if mode == "sales":
        return [
            PipelineStageCreate(name=name, order=idx, color=color)
            for idx, (name, color) in enumerate(SALES_CHAT_STAGE_SPECS)
        ]

    specs: list[tuple[str, int, str]] = [
        ("Новый", 0, "#64748b"),
        (settings.booking_queue_stage_name, 1, "#6366f1"),
        (settings.booking_stage_after_book, 2, "#8b5cf6"),
        ("У эксперта", 3, "#0ea5e9"),
        ("Оказание услуги", 4, "#14b8a6"),
        ("Доп. услуги", 5, "#f59e0b"),
        ("Оплачено", 6, "#22c55e"),
        (settings.booking_stage_completed, 7, "#16a34a"),
        (settings.booking_stage_lost, 8, "#ef4444"),
    ]
    return [PipelineStageCreate(name=n, order=o, color=c) for n, o, c in specs]
