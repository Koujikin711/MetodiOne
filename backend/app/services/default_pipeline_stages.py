"""Стандартные стадии новой воронки — единые 6 колонок (клиника и sales)."""

from app.schemas.pipeline import PipelineStageCreate
from app.services.lead_sales_stages import SALES_CHAT_STAGE_SPECS


def default_pipeline_stage_creates(*, crm_mode: str | None = None) -> list[PipelineStageCreate]:
    _ = crm_mode  # единый набор стадий для всех режимов
    return [
        PipelineStageCreate(name=name, order=idx, color=color)
        for idx, (name, color) in enumerate(SALES_CHAT_STAGE_SPECS)
    ]
