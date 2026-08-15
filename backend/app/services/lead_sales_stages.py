"""Стадии воронки продаж (чат-канбан): резолв имён и стартовая стадия для новых лидов."""

from __future__ import annotations

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Lead, PipelineStage
from app.services.stage_delete_checks import stage_delete_block_reason

# Порядок колонок: входящие → работа → ожидание → исход → архив.
SALES_CHAT_STAGE_SPECS: tuple[tuple[str, str], ...] = (
    ("Новый лид", "#64748b"),
    ("В обработке", "#0ea5e9"),
    ("В ожидании", "#f59e0b"),
    ("Удачно", "#22c55e"),
    ("Отказ", "#ef4444"),
    ("Архив", "#78716c"),
)

SALES_STAGE_NAMES: tuple[str, ...] = tuple(name for name, _ in SALES_CHAT_STAGE_SPECS)

# Ключи вкладок чата менеджера.
SALES_STAGE_KEYS: tuple[tuple[str, str], ...] = (
    ("new", "Новый лид"),
    ("in_progress", "В обработке"),
    ("waiting", "В ожидании"),
    ("won", "Удачно"),
    ("lost", "Отказ"),
    ("archive", "Архив"),
)

SALES_STAGE_KEY_TO_NAME: dict[str, str] = {k: n for k, n in SALES_STAGE_KEYS}
SALES_STAGE_NAME_TO_KEY: dict[str, str] = {n: k for k, n in SALES_STAGE_KEYS}

# Старые имена клиники/seed → новые чат-стадии.
_LEGACY_NAME_TO_SALES: dict[str, str] = {
    "Новый": "Новый лид",
    "Новый лид": "Новый лид",
    "Квалифицирован": "В обработке",
    "В обработке": "В обработке",
    "Запись": "Удачно",
    "У эксперта": "В обработке",
    "Оказание услуги": "В обработке",
    "Доп. услуги": "В ожидании",
    "В ожидании": "В ожидании",
    "Оплачено": "Удачно",
    "Успешно реализован": "Удачно",
    "Удачно": "Удачно",
    "Потерян": "Отказ",
    "Неуспешно": "Отказ",
    "Отказ": "Отказ",
    "Архив": "Архив",
}


def sales_stage_name_for_key(key: str | None) -> str | None:
    if not key:
        return None
    return SALES_STAGE_KEY_TO_NAME.get(str(key).strip().lower())


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
    default_name: str = "Новый лид",
) -> int | None:
    """Стадия для нового лида: preferred → «Новый лид» / «Новый» → первая в воронке."""
    if preferred_stage_id is not None:
        stage = await db.get(PipelineStage, int(preferred_stage_id))
        if stage is not None and stage.pipeline_id == pipeline_id:
            return int(stage.id)

    for name in (default_name, "Новый"):
        by_name = await stage_id_by_name_in_pipeline(db, pipeline_id=pipeline_id, name=name)
        if by_name is not None:
            return int(by_name)

    first = await first_stage_id_in_pipeline(db, pipeline_id=pipeline_id)
    return int(first) if first is not None else None


async def ensure_sales_pipeline_chat_stages(
    db: AsyncSession,
    *,
    company_id: int,
    pipeline_id: int,
) -> dict[str, int]:
    """
    Гарантирует 6 стадий чат-воронки, переносит лиды со старых имён, выставляет порядок.
    Возвращает {имя_стадии: id}.
    """
    rows = (
        await db.execute(
            select(PipelineStage).where(
                PipelineStage.company_id == company_id,
                PipelineStage.pipeline_id == pipeline_id,
            ),
        )
    ).scalars().all()
    by_name = {str(s.name): s for s in rows}

    for order, (name, color) in enumerate(SALES_CHAT_STAGE_SPECS):
        st = by_name.get(name)
        if st is None:
            st = PipelineStage(
                name=name,
                order=order,
                color=color,
                pipeline_id=pipeline_id,
                company_id=company_id,
                on_enter_create_task=False,
            )
            db.add(st)
            await db.flush()
            by_name[name] = st
        else:
            st.order = order
            st.color = color

    await db.flush()

    # Перенос лидов со старых стадий на канонические.
    for st in list(rows):
        target_name = _LEGACY_NAME_TO_SALES.get(str(st.name))
        if target_name is None or target_name == st.name:
            continue
        target = by_name.get(target_name)
        if target is None or target.id == st.id:
            continue
        await db.execute(
            update(Lead)
            .where(Lead.status_id == st.id, Lead.company_id == company_id)
            .values(status_id=target.id),
        )
        reason = await stage_delete_block_reason(db, st.id)
        if not reason:
            await db.delete(st)
            by_name.pop(str(st.name), None)

    await db.flush()

    # Обновить by_name после удалений
    fresh = (
        await db.execute(
            select(PipelineStage).where(
                PipelineStage.company_id == company_id,
                PipelineStage.pipeline_id == pipeline_id,
            ),
        )
    ).scalars().all()
    return {str(s.name): int(s.id) for s in fresh if str(s.name) in SALES_STAGE_NAMES}


async def advance_new_lead_after_manager_reply(
    db: AsyncSession,
    *,
    company_id: int,
    lead_id: int | None,
) -> bool:
    """Новый лид → В обработке после первого ответа менеджера."""
    if lead_id is None:
        return False
    lead = await db.get(Lead, int(lead_id))
    if lead is None or lead.company_id != company_id:
        return False
    await db.refresh(lead, ["stage"])
    if lead.stage is None:
        return False
    name = (lead.stage.name or "").strip()
    if name not in ("Новый лид", "Новый"):
        return False
    pipeline_id = lead.stage.pipeline_id
    if pipeline_id is None:
        return False
    to_id = await stage_id_by_name_in_pipeline(db, pipeline_id=int(pipeline_id), name="В обработке")
    if to_id is None:
        return False
    lead.status_id = int(to_id)
    await db.flush()
    return True
