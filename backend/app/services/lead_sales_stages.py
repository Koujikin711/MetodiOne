"""Стадии воронки (чат + канбан): 6 канонических колонок и миграция со старых имён."""

from __future__ import annotations

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Deal, Integration, Lead, Pipeline, PipelineStage
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

# Старые имена клиники / Bitrix / seed → новые чат-стадии.
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
    # Bitrix / импорт / каналы как «стадии»
    "Лиды из битрикс": "Новый лид",
    "Лиды из Битрикс": "Новый лид",
    "Битрикс": "Новый лид",
    "Bitrix": "Новый лид",
    "Инстаграм": "Новый лид",
    "Instagram": "Новый лид",
    "WhatsApp": "Новый лид",
    "Whatsapp": "Новый лид",
    "Telegram": "Новый лид",
}


def sales_stage_name_for_key(key: str | None) -> str | None:
    if not key:
        return None
    return SALES_STAGE_KEY_TO_NAME.get(str(key).strip().lower())


def resolve_stage_name_aliases(name: str) -> list[str]:
    """Имена для поиска стадии: запрошенное + канонический алиас после миграции."""
    raw = (name or "").strip()
    if not raw:
        return []
    out: list[str] = [raw]
    mapped = _LEGACY_NAME_TO_SALES.get(raw)
    if mapped and mapped not in out:
        out.append(mapped)
    return out


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


async def _repoint_stage_refs(
    db: AsyncSession,
    *,
    company_id: int,
    from_stage_id: int,
    to_stage_id: int,
) -> None:
    if from_stage_id == to_stage_id:
        return
    await db.execute(
        update(Lead)
        .where(Lead.status_id == from_stage_id, Lead.company_id == company_id)
        .values(status_id=to_stage_id),
    )
    await db.execute(
        update(Deal).where(Deal.stage_id == from_stage_id).values(stage_id=to_stage_id),
    )
    await db.execute(
        update(Integration).where(Integration.stage_id == from_stage_id).values(stage_id=to_stage_id),
    )


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

    default_target = by_name["Новый лид"]

    # Перенос лидов со старых стадий на канонические + удаление хвостов.
    for st in list(rows):
        name = str(st.name)
        if name in SALES_STAGE_NAMES:
            continue
        target_name = _LEGACY_NAME_TO_SALES.get(name, "Новый лид")
        target = by_name.get(target_name) or default_target
        if target.id == st.id:
            continue
        await _repoint_stage_refs(
            db,
            company_id=company_id,
            from_stage_id=int(st.id),
            to_stage_id=int(target.id),
        )
        reason = await stage_delete_block_reason(db, st.id)
        if not reason:
            await db.delete(st)
            by_name.pop(name, None)

    await db.flush()

    # Ещё раз: любые неканонические стадии (включая новые Bitrix-имена) → Новый лид.
    leftover = (
        await db.execute(
            select(PipelineStage).where(
                PipelineStage.company_id == company_id,
                PipelineStage.pipeline_id == pipeline_id,
            ),
        )
    ).scalars().all()
    for st in leftover:
        name = str(st.name)
        if name in SALES_STAGE_NAMES:
            continue
        await _repoint_stage_refs(
            db,
            company_id=company_id,
            from_stage_id=int(st.id),
            to_stage_id=int(default_target.id),
        )
        reason = await stage_delete_block_reason(db, st.id)
        if not reason:
            await db.delete(st)

    await db.flush()

    fresh = (
        await db.execute(
            select(PipelineStage).where(
                PipelineStage.company_id == company_id,
                PipelineStage.pipeline_id == pipeline_id,
            ),
        )
    ).scalars().all()
    return {str(s.name): int(s.id) for s in fresh if str(s.name) in SALES_STAGE_NAMES}


async def ensure_all_pipelines_chat_stages(db: AsyncSession) -> int:
    """Прогоняет 6 канонических стадий по всем воронкам всех компаний. Возвращает число воронок."""
    pipes = (await db.execute(select(Pipeline).order_by(Pipeline.id.asc()))).scalars().all()
    for p in pipes:
        if p.company_id is None:
            continue
        await ensure_sales_pipeline_chat_stages(
            db,
            company_id=int(p.company_id),
            pipeline_id=int(p.id),
        )
    return len(pipes)


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
