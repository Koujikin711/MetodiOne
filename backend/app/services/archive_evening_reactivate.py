"""Вечерняя раздача архивных лидов менеджерам как «Новый лид».

Правило: из «Архив», первое обращение ≥ 2 месяцев назад → каждому активному
менеджеру компании по 5 лидов в «Новый лид» (раз в календарный вечер).
"""

from __future__ import annotations

import logging
import uuid
from datetime import UTC, datetime, timedelta
from zoneinfo import ZoneInfo

from sqlalchemy import func, or_, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.models import (
    ChatMessage,
    ChatThread,
    Company,
    Lead,
    Pipeline,
    PipelineStage,
    SystemAuditEvent,
)
from app.services.lead_assignment import list_company_manager_ids
from app.services.lead_sales_stages import ARCHIVE_STAGE_NAME, stage_id_by_name_in_pipeline

logger = logging.getLogger(__name__)

LEADS_PER_MANAGER = 5
FIRST_CONTACT_MIN_DAYS = 60
# Не брать снова лиды, реактивированные недавно (цикл «игнор → Архив → снова»).
REACTIVATION_COOLDOWN_DAYS = 14
EVENING_HOUR_LOCAL = 19  # Asia/Dushanbe 19:00–19:59
AUDIT_ACTION = "archive_evening_reactivate_done"
_BATCH = 2000


def _tz() -> ZoneInfo:
    try:
        return ZoneInfo(settings.booking_timezone or "Asia/Dushanbe")
    except Exception:
        return ZoneInfo("Asia/Dushanbe")


def _local_now() -> datetime:
    return datetime.now(UTC).astimezone(_tz())


def _is_evening_window(local: datetime | None = None) -> bool:
    clock = local or _local_now()
    return clock.hour == EVENING_HOUR_LOCAL


async def _already_done_today(db: AsyncSession, *, company_id: int, day_key: str) -> bool:
    row = await db.scalar(
        select(SystemAuditEvent.id)
        .where(
            SystemAuditEvent.company_id == company_id,
            SystemAuditEvent.action == AUDIT_ACTION,
            SystemAuditEvent.details == day_key,
        )
        .limit(1),
    )
    return row is not None


async def _mark_done_today(
    db: AsyncSession,
    *,
    company_id: int,
    day_key: str,
    assigned: int,
    managers: int,
) -> None:
    db.add(
        SystemAuditEvent(
            company_id=company_id,
            entity_type="company",
            entity_id=company_id,
            action=AUDIT_ACTION,
            details=day_key,
            user_id=None,
        ),
    )
    db.add(
        SystemAuditEvent(
            company_id=company_id,
            entity_type="company",
            entity_id=company_id,
            action="archive_evening_reactivate_stats",
            details=f"day={day_key};managers={managers};assigned={assigned}",
            user_id=None,
        ),
    )
    await db.flush()


async def _archive_stage_ids_for_company(db: AsyncSession, *, company_id: int) -> list[int]:
    rows = (
        await db.execute(
            select(PipelineStage.id).where(
                PipelineStage.company_id == company_id,
                PipelineStage.name == ARCHIVE_STAGE_NAME,
            ),
        )
    ).all()
    return [int(r[0]) for r in rows]


async def _new_stage_id_by_pipeline(
    db: AsyncSession,
    *,
    company_id: int,
) -> dict[int, int]:
    """pipeline_id → status_id «Новый лид»."""
    out: dict[int, int] = {}
    pipes = (
        await db.execute(
            select(Pipeline.id).where(Pipeline.company_id == company_id).order_by(Pipeline.id.asc()),
        )
    ).scalars().all()
    for pid in pipes:
        sid = await stage_id_by_name_in_pipeline(db, pipeline_id=int(pid), name="Новый лид")
        if sid is None:
            sid = await stage_id_by_name_in_pipeline(db, pipeline_id=int(pid), name="Новый")
        if sid is not None:
            out[int(pid)] = int(sid)
    return out


async def _pipeline_id_for_stage(db: AsyncSession, *, stage_id: int) -> int | None:
    return await db.scalar(select(PipelineStage.pipeline_id).where(PipelineStage.id == stage_id).limit(1))


async def _pick_archive_pool(
    db: AsyncSession,
    *,
    company_id: int,
    archive_stage_ids: list[int],
    need: int,
    now: datetime,
) -> list[tuple[int, int]]:
    """
    Возвращает [(lead_id, status_id), ...] — самые старые по первому обращению.
    status_id нужен, чтобы узнать pipeline для «Новый лид».
    """
    if need <= 0 or not archive_stage_ids:
        return []

    cutoff = now - timedelta(days=FIRST_CONTACT_MIN_DAYS)
    cooldown = now - timedelta(days=REACTIVATION_COOLDOWN_DAYS)

    first_in = (
        select(
            ChatThread.lead_id.label("lead_id"),
            func.min(ChatMessage.created_at).label("first_at"),
        )
        .join(ChatMessage, ChatMessage.thread_id == ChatThread.id)
        .where(
            ChatThread.company_id == company_id,
            ChatThread.lead_id.is_not(None),
            ChatMessage.direction == "in",
        )
        .group_by(ChatThread.lead_id)
        .subquery()
    )

    first_contact = func.coalesce(first_in.c.first_at, Lead.created_at)

    q = (
        select(Lead.id, Lead.status_id)
        .outerjoin(first_in, first_in.c.lead_id == Lead.id)
        .where(
            Lead.company_id == company_id,
            Lead.status_id.in_(archive_stage_ids),
            first_contact.is_not(None),
            first_contact <= cutoff,
            or_(Lead.reactivated_at.is_(None), Lead.reactivated_at < cooldown),
        )
        .order_by(first_contact.asc(), Lead.id.asc())
        .limit(need)
    )
    rows = (await db.execute(q)).all()
    return [(int(r[0]), int(r[1])) for r in rows]


async def reactivate_company_archive_leads(
    db: AsyncSession,
    *,
    company_id: int,
    now: datetime | None = None,
    leads_per_manager: int = LEADS_PER_MANAGER,
) -> int:
    """Раздаёт архив по менеджерам компании. Возвращает число назначенных лидов."""
    clock = now or datetime.now(UTC)
    if clock.tzinfo is None:
        clock = clock.replace(tzinfo=UTC)

    managers = await list_company_manager_ids(db, company_id=company_id)
    if not managers:
        return 0

    archive_ids = await _archive_stage_ids_for_company(db, company_id=company_id)
    if not archive_ids:
        return 0

    new_by_pipe = await _new_stage_id_by_pipeline(db, company_id=company_id)
    if not new_by_pipe:
        return 0

    need = int(leads_per_manager) * len(managers)
    pool = await _pick_archive_pool(
        db,
        company_id=company_id,
        archive_stage_ids=archive_ids,
        need=need,
        now=clock,
    )
    if not pool:
        return 0

    # status_id → pipeline_id cache
    stage_pipe: dict[int, int] = {}
    for _, sid in pool:
        if sid not in stage_pipe:
            pid = await _pipeline_id_for_stage(db, stage_id=sid)
            if pid is not None:
                stage_pipe[sid] = int(pid)

    batch_id = uuid.uuid4().hex[:12]
    assigned = 0
    cursor = 0
    for mid in managers:
        chunk = pool[cursor : cursor + leads_per_manager]
        cursor += leads_per_manager
        if not chunk:
            break
        for lead_id, status_id in chunk:
            pipe_id = stage_pipe.get(status_id)
            new_sid = new_by_pipe.get(pipe_id) if pipe_id is not None else None
            if new_sid is None:
                continue
            await db.execute(
                update(Lead)
                .where(Lead.id == lead_id, Lead.company_id == company_id)
                .values(
                    status_id=int(new_sid),
                    manager_id=int(mid),
                    reactivated_at=clock,
                ),
            )
            db.add(
                SystemAuditEvent(
                    company_id=company_id,
                    entity_type="lead",
                    entity_id=lead_id,
                    action="manager_reassigned",
                    details=f"batch_id={batch_id};source=archive_evening;manager_id={mid}",
                    user_id=None,
                ),
            )
            assigned += 1

    await db.flush()
    return assigned


async def get_latest_archive_evening_stats(
    db: AsyncSession,
    *,
    company_id: int,
) -> dict[str, object]:
    """Последняя вечерняя раздача Архива для админ-метки."""
    local = _local_now()
    today = local.strftime("%Y-%m-%d")
    row = (
        await db.execute(
            select(SystemAuditEvent)
            .where(
                SystemAuditEvent.company_id == company_id,
                SystemAuditEvent.action == "archive_evening_reactivate_stats",
            )
            .order_by(SystemAuditEvent.id.desc())
            .limit(1),
        )
    ).scalar_one_or_none()

    day: str | None = None
    assigned = 0
    managers = 0
    if row is not None and row.details:
        parts = {}
        for chunk in str(row.details).split(";"):
            if "=" in chunk:
                k, v = chunk.split("=", 1)
                parts[k.strip()] = v.strip()
        day = parts.get("day")
        try:
            assigned = int(parts.get("assigned") or 0)
        except ValueError:
            assigned = 0
        try:
            managers = int(parts.get("managers") or 0)
        except ValueError:
            managers = 0

    return {
        "day": day,
        "assigned": assigned,
        "managers": managers,
        "ran_today": bool(day and day == today),
        "has_run": day is not None,
    }


async def run_archive_evening_reactivate_tick(
    db: AsyncSession,
    *,
    force: bool = False,
    local_now: datetime | None = None,
) -> int:
    """
    Тик раз в ~минуту из _reminder_loop.
    В 19:00 локального TZ (booking_timezone) — по одному прогону на компанию в день.
    force=True — игнор окна (для тестов/ручного вызова).
    """
    local = local_now or _local_now()
    if not force and not _is_evening_window(local):
        return 0

    day_key = local.strftime("%Y-%m-%d")
    now_utc = datetime.now(UTC)
    total = 0

    companies = (
        await db.execute(select(Company.id).order_by(Company.id.asc()))
    ).scalars().all()

    for cid in companies:
        company_id = int(cid)
        if await _already_done_today(db, company_id=company_id, day_key=day_key):
            continue
        managers = await list_company_manager_ids(db, company_id=company_id)
        if not managers:
            await _mark_done_today(db, company_id=company_id, day_key=day_key, assigned=0, managers=0)
            continue
        n = await reactivate_company_archive_leads(
            db,
            company_id=company_id,
            now=now_utc,
        )
        await _mark_done_today(
            db,
            company_id=company_id,
            day_key=day_key,
            assigned=n,
            managers=len(managers),
        )
        if n:
            logger.info(
                "archive evening reactivate company=%s assigned=%s managers=%s",
                company_id,
                n,
                len(managers),
            )
        total += n

    return total
