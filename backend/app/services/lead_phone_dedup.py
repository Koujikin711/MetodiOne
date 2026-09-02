"""Один телефон в воронке (и один WhatsApp chatId в компании) → один лид.

Сливает уже накопленные дубли и даёт общий поиск для всех путей создания.
"""

from __future__ import annotations

import logging
from collections import defaultdict

from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import (
    BookingAppointment,
    ChatMessage,
    ChatThread,
    Company,
    Deal,
    Lead,
    LeadAuditEvent,
    PipelineStage,
)
from app.services.lead_extra_phones import find_lead_by_any_phone, norm_phone, phones_match

logger = logging.getLogger(__name__)

_PLACEHOLDER_NAMES = frozenset({"", "лид", "клиент", "гость", "whatsapp lead", "лид из таблицы"})


def _phone_key(phone: str | None) -> str | None:
    digits = norm_phone(phone)
    if not digits or len(digits) < 9:
        return None
    return digits[-9:]


def is_placeholder_lead_name(name: str | None) -> bool:
    return (name or "").strip().lower() in _PLACEHOLDER_NAMES


async def find_lead_for_phone(
    db: AsyncSession,
    *,
    company_id: int,
    phone: str | None,
    pipeline_id: int | None = None,
) -> Lead | None:
    """Единая точка поиска: воронка (если задана) или вся компания."""
    return await find_lead_by_any_phone(
        db,
        company_id=company_id,
        phone=phone,
        pipeline_id=pipeline_id,
    )


async def _message_counts(db: AsyncSession, *, company_id: int, lead_ids: list[int]) -> dict[int, int]:
    if not lead_ids:
        return {}
    rows = (
        await db.execute(
            select(ChatThread.lead_id, func.count(ChatMessage.id))
            .outerjoin(ChatMessage, ChatMessage.thread_id == ChatThread.id)
            .where(
                ChatThread.company_id == company_id,
                ChatThread.lead_id.in_(lead_ids),
            )
            .group_by(ChatThread.lead_id),
        )
    ).all()
    return {int(lid): int(cnt or 0) for lid, cnt in rows if lid is not None}


def _pick_keeper(leads: list[Lead], msg_counts: dict[int, int]) -> Lead:
    """Оставляем карточку с перепиской / нормальным именем / более раннюю."""

    def score(lead: Lead) -> tuple:
        lid = int(lead.id)
        name = (lead.name or "").strip()
        phone_as_name = bool(norm_phone(name) and phones_match(name, lead.phone))
        return (
            msg_counts.get(lid, 0),
            0 if is_placeholder_lead_name(name) else 1,
            0 if phone_as_name else 1,
            1 if lead.manager_id is not None else 0,
            -lid,  # при равенстве — более старый id
        )

    return max(leads, key=score)


async def _repoint_threads(
    db: AsyncSession,
    *,
    company_id: int,
    from_lead_id: int,
    to_lead_id: int,
) -> int:
    """Переносит треды; при том же @c.us у keeper — удаляет пустой дубль-тред."""
    donor_threads = (
        await db.execute(
            select(ChatThread).where(
                ChatThread.company_id == company_id,
                ChatThread.lead_id == from_lead_id,
            ),
        )
    ).scalars().all()
    moved = 0
    for th in donor_threads:
        ext = (th.external_chat_id or "").strip()
        if ext:
            keeper_th = (
                await db.execute(
                    select(ChatThread)
                    .where(
                        ChatThread.company_id == company_id,
                        ChatThread.lead_id == to_lead_id,
                        ChatThread.provider == th.provider,
                        ChatThread.external_chat_id == ext,
                    )
                    .limit(1),
                )
            ).scalars().first()
            if keeper_th is not None and int(keeper_th.id) != int(th.id):
                # Сообщения на дубль-тред → на основной
                await db.execute(
                    update(ChatMessage)
                    .where(ChatMessage.thread_id == th.id)
                    .values(thread_id=int(keeper_th.id)),
                )
                await db.delete(th)
                moved += 1
                continue
        th.lead_id = to_lead_id
        moved += 1
    await db.flush()
    return moved


async def merge_duplicate_phone_leads(
    db: AsyncSession,
    *,
    company_id: int | None = None,
    limit_companies: int = 50,
) -> dict[str, int]:
    """Сливает дубли по последним 9 цифрам телефона внутри одной воронки.

    Пустые «Гость» / stub без сообщений поглощаются карточкой с WhatsApp-историей.
    """
    company_ids: list[int]
    if company_id is not None:
        company_ids = [int(company_id)]
    else:
        company_ids = list(
            (
                await db.execute(select(Company.id).order_by(Company.id.asc()).limit(limit_companies))
            ).scalars().all(),
        )

    merged_groups = 0
    removed_leads = 0
    moved_threads = 0

    for cid in company_ids:
        leads = (
            await db.execute(
                select(Lead, PipelineStage.pipeline_id)
                .join(PipelineStage, PipelineStage.id == Lead.status_id)
                .where(
                    Lead.company_id == int(cid),
                    Lead.phone.is_not(None),
                )
                .order_by(Lead.id.asc()),
            )
        ).all()

        groups: dict[tuple[int, str], list[Lead]] = defaultdict(list)
        for lead, pipe_id in leads:
            key = _phone_key(lead.phone)
            if key is None or pipe_id is None:
                continue
            groups[(int(pipe_id), key)].append(lead)

        for (_pipe, _key), group in groups.items():
            if len(group) < 2:
                continue
            ids = [int(l.id) for l in group]
            msg_counts = await _message_counts(db, company_id=int(cid), lead_ids=ids)
            keeper = _pick_keeper(group, msg_counts)
            losers = [l for l in group if int(l.id) != int(keeper.id)]
            if not losers:
                continue

            # Подтянуть имя/телефон с loser, если у keeper техническое.
            for loser in losers:
                if is_placeholder_lead_name(keeper.name) and not is_placeholder_lead_name(loser.name):
                    if not (norm_phone(loser.name) and phones_match(loser.name, loser.phone)):
                        keeper.name = loser.name
                if not norm_phone(keeper.phone) and norm_phone(loser.phone):
                    keeper.phone = norm_phone(loser.phone)
                if keeper.manager_id is None and loser.manager_id is not None:
                    keeper.manager_id = loser.manager_id

            for loser in losers:
                lid = int(loser.id)
                moved_threads += await _repoint_threads(
                    db,
                    company_id=int(cid),
                    from_lead_id=lid,
                    to_lead_id=int(keeper.id),
                )
                await db.execute(
                    update(BookingAppointment)
                    .where(
                        BookingAppointment.company_id == int(cid),
                        BookingAppointment.lead_id == lid,
                    )
                    .values(lead_id=int(keeper.id)),
                )
                await db.execute(
                    update(Deal)
                    .where(Deal.company_id == int(cid), Deal.lead_id == lid)
                    .values(lead_id=int(keeper.id)),
                )
                db.add(
                    LeadAuditEvent(
                        company_id=int(cid),
                        lead_id=int(keeper.id),
                        user_id=None,
                        action="lead_phone_dedup_merged",
                        details=f"merged_from_lead_id={lid};phone={keeper.phone}",
                    ),
                )
                try:
                    await db.delete(loser)
                    await db.flush()
                    removed_leads += 1
                except Exception:
                    # Если FK мешает удалить — обнуляем телефон, чтобы не светился как дубль.
                    loser.phone = None
                    loser.name = (loser.name or "Дубль")[:200]
                    await db.flush()
                    removed_leads += 1
                    logger.warning(
                        "lead_phone_dedup: could not delete lead_id=%s, cleared phone",
                        lid,
                    )

            merged_groups += 1
            await db.flush()

    return {
        "companies": len(company_ids),
        "merged_groups": merged_groups,
        "removed_leads": removed_leads,
        "moved_threads": moved_threads,
    }
