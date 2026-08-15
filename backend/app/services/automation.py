from datetime import UTC, datetime, timedelta

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Lead, PipelineStage, Task, TaskStatus

AUTOMATION_TASK_TITLE = "🚀 Подключить услуги и проверить оплату"
AUTOMATION_TASK_DESCRIPTION = "Лид перешел в стадию оплаты. Нужно подготовить документы."


def _stage_triggers_legacy_automation(stage: PipelineStage, max_order: int) -> bool:
    n = stage.name.strip().lower()
    if n == "оплачено":
        return True
    if "успешно" in n and "реализован" in n:
        return True
    if stage.order == max_order and "потерян" not in n and "lost" not in n:
        return True
    return False


def stage_should_create_task(stage: PipelineStage, max_order: int) -> bool:
    """
    on_enter_create_task:
      True  → всегда создать задачу
      False → выкл
      None  → эвристика по имени/порядку (совместимость)
    """
    flag = stage.on_enter_create_task
    if flag is True:
        return True
    if flag is False:
        return False
    return _stage_triggers_legacy_automation(stage, max_order)


async def process_lead_automation(
    session: AsyncSession,
    lead_id: int,
    new_status_id: int,
) -> bool:
    """
    Создаёт задачу при входе лида в стадию с включённой автоматизацией
    (или по legacy-эвристике, если правило не задано явно).
    Возвращает True, если задача создана.
    """
    stage = await session.get(PipelineStage, new_status_id)
    if stage is None:
        return False

    max_q = select(func.max(PipelineStage.order)).where(
        PipelineStage.company_id == stage.company_id,
    )
    if stage.pipeline_id is not None:
        max_q = max_q.where(PipelineStage.pipeline_id == stage.pipeline_id)
    max_order_result = await session.execute(max_q)
    max_order = max_order_result.scalar_one()
    if max_order is None:
        max_order = 0

    if not stage_should_create_task(stage, max_order):
        return False

    title = (stage.on_enter_task_title or "").strip() or AUTOMATION_TASK_TITLE
    description = (stage.on_enter_task_description or "").strip() or AUTOMATION_TASK_DESCRIPTION
    hours = stage.on_enter_task_deadline_hours if stage.on_enter_task_deadline_hours else 24
    hours = max(1, min(int(hours), 720))

    dup = await session.execute(
        select(Task.id).where(
            Task.related_lead_id == lead_id,
            Task.title == title,
        ).limit(1)
    )
    if dup.scalar_one_or_none() is not None:
        return False

    lead = await session.get(Lead, lead_id)
    if lead is None:
        return False

    deadline = datetime.now(UTC) + timedelta(hours=hours)
    task = Task(
        company_id=lead.company_id,
        title=title,
        description=description,
        deadline=deadline,
        status=TaskStatus.pending,
        assigned_to=lead.manager_id,
        created_by_user_id=None,
        related_lead_id=lead_id,
    )
    session.add(task)
    await session.flush()
    return True
