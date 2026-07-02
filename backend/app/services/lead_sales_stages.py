"""Стадии воронки продаж: резолв имён и стартовая стадия для новых лидов."""

from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import PipelineStage

# Порядок этапов продаж (имена для автоматизации и канбана).
SALES_STAGE_NAMES: tuple[str, ...] = (
    "Новый",
    "Квалифицирован",
    "Запись",
    "У эксперта",
    "Оказание услуги",
    "Доп. услуги",
    "Оплачено",
    "Успешно реализован",
    "Потерян",
)


async def stage_id_by_name_in_pipeline(
    db: AsyncSession,
    *,
    pipeline_id: int,
    name: str,
) -> int | None:
    target = (name or "").strip()
    if not target:
        return None
    return await db.scalar(
        select(PipelineStage.id)
        .where(PipelineStage.pipeline_id == pipeline_id, PipelineStage.name == target)
        .limit(1),
    )


async def first_stage_id_in_pipeline(db: AsyncSession, *, pipeline_id: int) -> int | None:
    return await db.scalar(
        select(PipelineStage.id)
        .where(PipelineStage.pipeline_id == pipeline_id)
        .order_by(PipelineStage.order.asc(), PipelineStage.id.asc())
        .limit(1),
    )


async def resolve_new_lead_stage_id(
    db: AsyncSession,
    *,
    pipeline_id: int,
    preferred_stage_id: int | None = None,
    default_name: str = "Новый",
) -> int | None:
    """Стадия для нового лида: preferred → стадия по имени → первая в воронке."""
    if preferred_stage_id is not None:
        stage = await db.get(PipelineStage, int(preferred_stage_id))
        if stage is not None and stage.pipeline_id == pipeline_id:
            return int(stage.id)

    by_name = await stage_id_by_name_in_pipeline(db, pipeline_id=pipeline_id, name=default_name)
    if by_name is not None:
        return int(by_name)

    first = await first_stage_id_in_pipeline(db, pipeline_id=pipeline_id)
    return int(first) if first is not None else None
