"""Стадии воронки (чат + канбан): 6 канонических колонок и миграция со старых имён."""

from __future__ import annotations

from collections import defaultdict
from datetime import UTC, datetime, timedelta

from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import (
    BookingAppointment,
    ChatMessage,
    ChatThread,
    Deal,
    Integration,
    Lead,
    Pipeline,
    PipelineStage,
)
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

# Ключи вкладок (Архив — только автоматический, менеджеру не в Status).
SALES_STAGE_KEYS: tuple[tuple[str, str], ...] = (
    ("new", "Новый лид"),
    ("in_progress", "В обработке"),
    ("waiting", "В ожидании"),
    ("won", "Удачно"),
    ("lost", "Отказ"),
    ("archive", "Архив"),
)

MANAGER_CHAT_STAGE_KEYS: tuple[tuple[str, str], ...] = tuple(
    (k, n) for k, n in SALES_STAGE_KEYS if k != "archive"
)
# Менеджер вручную: ожидание / работа / исход. «Новый лид» и «Архив» — авто.
MANAGER_SETTABLE_STAGE_NAMES: frozenset[str] = frozenset(
    {"В обработке", "В работе", "В ожидании", "Удачно", "Отказ"},
)
AUTO_ONLY_STAGE_NAMES: frozenset[str] = frozenset(
    {"Новый лид", "Архив"},
)
ARCHIVE_STAGE_NAME = "Архив"

# Склад (Bitrix / старый WhatsApp / GREEN API): без свежей активности → Архив.
# Не держим десятки тысяч «Новый лид» только из‑за старого входящего в истории.
WAREHOUSE_RECENT_DAYS = 45
_REDISTRIBUTE_BATCH = 2000

SALES_STAGE_KEY_TO_NAME: dict[str, str] = {k: n for k, n in SALES_STAGE_KEYS}
SALES_STAGE_NAME_TO_KEY: dict[str, str] = {n: k for k, n in SALES_STAGE_KEYS}

# Старые имена клиники / Bitrix / seed → новые чат-стадии.
_LEGACY_NAME_TO_SALES: dict[str, str] = {
    "Новый": "Новый лид",
    "Новый лид": "Новый лид",
    "Квалифицирован": "В обработке",
    "В обработке": "В обработке",
    "В работе": "В обработке",
    "Запись": "Удачно",
    "У эксперта": "В обработке",
    "Оказание услуги": "В обработке",
    "Доп. услуги": "В ожидании",
    "В ожидании": "В ожидании",
    "Оплачено": "Удачно",
    "Успешно реализован": "Архив",
    "Удачно": "Удачно",
    "Потерян": "Отказ",
    "Неуспешно": "Отказ",
    "Отказ": "Отказ",
    "Архив": "Архив",
    # Bitrix / импорт / каналы-как-стадии → Архив (склад, не удалять).
    "Лиды из битрикс": "Архив",
    "Лиды из Битрикс": "Архив",
    "Битрикс": "Архив",
    "Bitrix": "Архив",
    "Инстаграм": "Архив",
    "Instagram": "Архив",
    "WhatsApp": "Архив",
    "Whatsapp": "Архив",
    "Telegram": "Архив",
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


def _as_utc(dt: datetime | None) -> datetime | None:
    if dt is None:
        return None
    if dt.tzinfo is None:
        return dt.replace(tzinfo=UTC)
    return dt.astimezone(UTC)


def _is_recent(dt: datetime | None, *, now: datetime, days: int = WAREHOUSE_RECENT_DAYS) -> bool:
    stamp = _as_utc(dt)
    if stamp is None:
        return False
    return stamp >= (now - timedelta(days=days))


def _is_warehouse_source(source: str | None) -> bool:
    src = (source or "").strip().lower()
    if not src:
        return False
    tokens = (
        "bitrix",
        "битрикс",
        "b24",
        "bx24",
        "whatsapp",
        "whats app",
        "green api",
        "greenapi",
        "instagram",
        "инстаграм",
        "telegram",
        "телеграм",
    )
    return any(token in src for token in tokens)


def classify_lead_stage_name(
    *,
    current_name: str | None,
    appointment_statuses: set[str],
    has_outbound: bool,
    last_direction: str | None,
    has_any_chat: bool = True,
    source: str | None = None,
    last_message_at: datetime | None = None,
    lead_created_at: datetime | None = None,
    reactivated_at: datetime | None = None,
    now: datetime | None = None,
) -> str:
    """
    Жёсткие сигналы (запись) перекрывают ручные стадии.
    Склад Bitrix/WhatsApp/GREEN API без свежей активности → Архив (не удалять).
    «Новый лид» только при свежем входящем (или только что созданном без чата).
    «Удачно» (запись / явка) в Архив не уходит.
    После вечерней реактивации из Архива — grace по reactivated_at.
    """
    cur = (current_name or "").strip()
    statuses = {str(s).strip().lower() for s in appointment_statuses}
    clock = _as_utc(now) or datetime.now(UTC)

    if "completed" in statuses:
        # Явка / завершённый визит — успех остаётся в «Удачно», не в Архив.
        return "Удачно"
    if "booked" in statuses:
        return "Удачно"
    if statuses.intersection({"cancelled", "no_show", "lost"}) and cur in (
        "",
        "Новый лид",
        "Новый",
        "В обработке",
        "В работе",
        "В ожидании",
        "Удачно",
    ):
        return "Отказ"

    if cur == ARCHIVE_STAGE_NAME:
        # Свежая активность вытаскивает из Архива (иначе «живые» чаты висят в складе).
        if has_outbound:
            if (last_direction or "").strip().lower() == "in":
                return "В ожидании"
            # Только исходящее без нового входящего — склад остаётся Архивом
            # (авто-приветствие по старому контакту не делает его «в работе»).
            activity = last_message_at or lead_created_at
            if activity is not None and _is_recent(activity, now=clock):
                # Есть недавняя активность в треде — после автоответа ждём менеджера как новый вход.
                if (last_direction or "").strip().lower() == "out":
                    return "Новый лид"
            return ARCHIVE_STAGE_NAME
        if has_any_chat and (last_direction or "").strip().lower() == "in":
            activity = last_message_at or lead_created_at
            if activity is None or _is_recent(activity, now=clock):
                return "Новый лид"
        return ARCHIVE_STAGE_NAME

    # Вечерняя раздача из Архива: не возвращаем в Архив, пока grace жив и нет исходящих.
    if (
        cur in ("", "Новый лид", "Новый")
        and not has_outbound
        and _is_recent(reactivated_at, now=clock)
    ):
        return "Новый лид"

    # Явный склад из «Новый*» → Архив, если нет свежей активности.
    if cur in ("", "Новый лид", "Новый") and _is_warehouse_source(source):
        if has_outbound:
            pass  # ниже по чату
        else:
            activity = last_message_at or lead_created_at
            if has_any_chat and (last_direction or "").strip().lower() == "in":
                if activity is None or _is_recent(activity, now=clock):
                    return "Новый лид"
                return ARCHIVE_STAGE_NAME
            if not has_any_chat:
                if activity is not None and _is_recent(activity, now=clock):
                    return "Новый лид"
                return ARCHIVE_STAGE_NAME
            return ARCHIVE_STAGE_NAME

    # Ручные стадии менеджера не откатываем без записи.
    if cur in MANAGER_SETTABLE_STAGE_NAMES:
        return cur

    if has_outbound:
        if (last_direction or "").strip().lower() == "in":
            return "В ожидании"
        return "В обработке"

    # Нет исходящих: «Новый лид» при свежем входящем (или без метки — не ломаем тесты/край).
    if has_any_chat and (last_direction or "").strip().lower() == "in":
        activity = last_message_at or lead_created_at
        if activity is None or _is_recent(activity, now=clock):
            return "Новый лид"
        return ARCHIVE_STAGE_NAME

    # Без чата: свежесозданный остаётся новым, остальное — склад в Архив.
    if not has_any_chat:
        if lead_created_at is not None and _is_recent(lead_created_at, now=clock):
            return "Новый лид"
        return ARCHIVE_STAGE_NAME
    return ARCHIVE_STAGE_NAME


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


async def redistribute_pipeline_leads_by_activity(
    db: AsyncSession,
    *,
    company_id: int,
    pipeline_id: int,
    stage_ids: dict[str, int] | None = None,
) -> int:
    """Раскладывает лиды воронки по стадиям по записи/чату. Возвращает число обновлений.

    Батчами (не одним IN на 30k+ id — asyncpg ломается на >32767 bind params).
    """
    ids = stage_ids or await ensure_sales_pipeline_chat_stages(
        db, company_id=company_id, pipeline_id=pipeline_id,
    )
    if not ids:
        return 0

    stage_id_set = set(ids.values())
    id_to_name = {sid: name for name, sid in ids.items()}
    clock = datetime.now(UTC)
    updated = 0
    last_id = 0

    while True:
        leads = (
            await db.execute(
                select(Lead.id, Lead.status_id, Lead.source, Lead.created_at, Lead.reactivated_at)
                .where(
                    Lead.company_id == company_id,
                    Lead.status_id.in_(stage_id_set),
                    Lead.id > last_id,
                )
                .order_by(Lead.id.asc())
                .limit(_REDISTRIBUTE_BATCH),
            )
        ).all()
        if not leads:
            break

        last_id = int(leads[-1][0])
        lead_ids = [int(r[0]) for r in leads]
        id_to_status = {int(r[0]): int(r[1]) for r in leads}
        id_to_source = {int(r[0]): (r[2] if r[2] is None else str(r[2])) for r in leads}
        id_to_created = {int(r[0]): r[3] for r in leads}
        id_to_reactivated = {int(r[0]): r[4] for r in leads}

        appt_rows = (
            await db.execute(
                select(BookingAppointment.lead_id, BookingAppointment.status).where(
                    BookingAppointment.company_id == company_id,
                    BookingAppointment.lead_id.in_(lead_ids),
                ),
            )
        ).all()
        appts_by_lead: dict[int, set[str]] = defaultdict(set)
        for lid, st in appt_rows:
            if lid is None:
                continue
            appts_by_lead[int(lid)].add(str(st or ""))

        out_rows = (
            await db.execute(
                select(ChatThread.lead_id)
                .join(ChatMessage, ChatMessage.thread_id == ChatThread.id)
                .where(
                    ChatThread.company_id == company_id,
                    ChatThread.lead_id.in_(lead_ids),
                    ChatMessage.direction == "out",
                )
                .distinct(),
            )
        ).all()
        has_out = {int(r[0]) for r in out_rows if r[0] is not None}

        any_chat_rows = (
            await db.execute(
                select(ChatThread.lead_id)
                .join(ChatMessage, ChatMessage.thread_id == ChatThread.id)
                .where(
                    ChatThread.company_id == company_id,
                    ChatThread.lead_id.in_(lead_ids),
                )
                .distinct(),
            )
        ).all()
        has_any_chat = {int(r[0]) for r in any_chat_rows if r[0] is not None}

        last_msg_sq = (
            select(
                ChatThread.lead_id.label("lead_id"),
                func.max(ChatMessage.id).label("max_msg_id"),
            )
            .join(ChatMessage, ChatMessage.thread_id == ChatThread.id)
            .where(ChatThread.company_id == company_id, ChatThread.lead_id.in_(lead_ids))
            .group_by(ChatThread.lead_id)
            .subquery()
        )
        last_dir_rows = (
            await db.execute(
                select(
                    last_msg_sq.c.lead_id,
                    ChatMessage.direction,
                    ChatMessage.created_at,
                ).join(
                    ChatMessage,
                    ChatMessage.id == last_msg_sq.c.max_msg_id,
                ),
            )
        ).all()
        last_dir = {int(lid): str(direction) for lid, direction, _ in last_dir_rows if lid is not None}
        last_at = {int(lid): created for lid, _, created in last_dir_rows if lid is not None}

        moves: dict[int, list[int]] = defaultdict(list)
        for lid in lead_ids:
            cur_sid = id_to_status[lid]
            cur_name = id_to_name.get(cur_sid)
            target_name = classify_lead_stage_name(
                current_name=cur_name,
                appointment_statuses=appts_by_lead.get(lid, set()),
                has_outbound=lid in has_out,
                last_direction=last_dir.get(lid),
                has_any_chat=lid in has_any_chat,
                source=id_to_source.get(lid),
                last_message_at=last_at.get(lid),
                lead_created_at=id_to_created.get(lid),
                reactivated_at=id_to_reactivated.get(lid),
                now=clock,
            )
            target_sid = ids.get(target_name)
            if target_sid is None or target_sid == cur_sid:
                continue
            moves[int(target_sid)].append(lid)

        for target_sid, lids in moves.items():
            await db.execute(
                update(Lead)
                .where(Lead.company_id == company_id, Lead.id.in_(lids))
                .values(status_id=int(target_sid)),
            )
            updated += len(lids)

        await db.flush()

    return updated


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


async def redistribute_all_pipelines_leads(db: AsyncSession) -> int:
    """Раскладка лидов по всем воронкам. Возвращает суммарное число обновлений."""
    pipes = (await db.execute(select(Pipeline).order_by(Pipeline.id.asc()))).scalars().all()
    total = 0
    for p in pipes:
        if p.company_id is None:
            continue
        total += await redistribute_pipeline_leads_by_activity(
            db,
            company_id=int(p.company_id),
            pipeline_id=int(p.id),
        )
    return total


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
