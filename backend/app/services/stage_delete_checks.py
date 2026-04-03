"""Проверки перед удалением стадии/воронки (FK RESTRICT)."""

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Deal, Integration, Lead, PipelineStage


async def stage_delete_block_reason(db: AsyncSession, stage_id: int) -> str | None:
    n_leads = await db.scalar(select(func.count()).select_from(Lead).where(Lead.status_id == stage_id))
    if n_leads and int(n_leads) > 0:
        return f"На стадии есть лиды ({int(n_leads)}). Переместите их на другую стадию."
    n_deals = await db.scalar(select(func.count()).select_from(Deal).where(Deal.stage_id == stage_id))
    if n_deals and int(n_deals) > 0:
        return f"Есть сделки, привязанные к стадии ({int(n_deals)})."
    n_int = await db.scalar(
        select(func.count()).select_from(Integration).where(Integration.stage_id == stage_id),
    )
    if n_int and int(n_int) > 0:
        return f"Есть интеграции с этой стадией ({int(n_int)}). Измените или удалите их в разделе «Интеграции»."
    return None


async def pipeline_delete_block_reason(db: AsyncSession, pipeline_id: int) -> str | None:
    n_int = await db.scalar(
        select(func.count()).select_from(Integration).where(Integration.pipeline_id == pipeline_id),
    )
    if n_int and int(n_int) > 0:
        return f"К воронке привязаны интеграции ({int(n_int)}). Удалите или перенастройте их."
    rows = await db.execute(select(PipelineStage).where(PipelineStage.pipeline_id == pipeline_id))
    stages = rows.scalars().all()
    for st in stages:
        reason = await stage_delete_block_reason(db, st.id)
        if reason:
            return f"Стадия «{st.name}»: {reason}"
    return None
