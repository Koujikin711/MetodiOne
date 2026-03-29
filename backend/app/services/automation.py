from datetime import UTC, datetime, timedelta

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Lead, PipelineStage, Task, TaskStatus

AUTOMATION_TASK_TITLE = "🚀 Подключить услуги и проверить оплату"
AUTOMATION_TASK_DESCRIPTION = "Лид перешел в стадию оплаты. Нужно подготовить документы."


def _stage_triggers_automation(stage: PipelineStage, max_order: int) -> bool:
    n = stage.name.strip().lower()
    if n == "оплачено":
        return True
    if "успешно" in n and "реализован" in n:
        return True
    if stage.order == max_order and "потерян" not in n and "lost" not in n:
        return True
    return False


async def process_lead_automation(
    session: AsyncSession,
    lead_id: int,
    new_status_id: int,
) -> bool:
    """
    Создаёт задачу при переходе лида на этап «Оплачено» / успешная сделка / последний этап (кроме «Потерян»).
    Возвращает True, если задача создана.
    """
    stage = await session.get(PipelineStage, new_status_id)
    if stage is None:
        return False

    max_order_result = await session.execute(select(func.max(PipelineStage.order)))
    max_order = max_order_result.scalar_one()
    if max_order is None:
        max_order = 0

    if not _stage_triggers_automation(stage, max_order):
        return False

    dup = await session.execute(
        select(Task.id).where(
            Task.related_lead_id == lead_id,
            Task.title == AUTOMATION_TASK_TITLE,
        ).limit(1)
    )
    if dup.scalar_one_or_none() is not None:
        return False

    lead = await session.get(Lead, lead_id)
    if lead is None:
        return False

    deadline = datetime.now(UTC) + timedelta(hours=24)
    task = Task(
        title=AUTOMATION_TASK_TITLE,
        description=AUTOMATION_TASK_DESCRIPTION,
        deadline=deadline,
        status=TaskStatus.pending,
        assigned_to=lead.manager_id,
        related_lead_id=lead_id,
    )
    session.add(task)
    await session.flush()
    return True
