"""Слияние дублей WhatsApp-диалогов (один chatId / один лид → один тред)."""

from __future__ import annotations

import logging
import re
from collections import defaultdict

from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import ChatMessage, ChatThread, ChatThreadUserRead, Company
from app.services.phone_match import phones_equivalent, whatsapp_e164_digits

logger = logging.getLogger(__name__)

_C_US_RE = re.compile(r"^(\d+)@c\.us$", re.IGNORECASE)


def normalize_whatsapp_chat_id(external_chat_id: str | None, *, default_cc: str = "992") -> str | None:
    """992…@c.us / 9…@c.us → канонический E.164@c.us."""
    ext = (external_chat_id or "").strip()
    if not ext:
        return None
    m = _C_US_RE.match(ext)
    if not m:
        return ext
    digits = whatsapp_e164_digits(m.group(1), default_cc=default_cc)
    if len(digits) < 9:
        return ext
    return f"{digits}@c.us"


def _chat_phone_key(external_chat_id: str | None) -> str | None:
    """Ключ дедупа по последним 9 цифрам WhatsApp chatId."""
    ext = (external_chat_id or "").strip()
    if not ext:
        return None
    m = _C_US_RE.match(ext)
    if not m:
        return None
    digits = whatsapp_e164_digits(m.group(1))
    if len(digits) < 9:
        return None
    return digits[-9:]


async def _message_count(db: AsyncSession, thread_id: int) -> int:
    return int(
        (
            await db.execute(
                select(func.count()).select_from(ChatMessage).where(ChatMessage.thread_id == int(thread_id)),
            )
        ).scalar()
        or 0,
    )


def _pick_keeper(threads: list[ChatThread], msg_counts: dict[int, int]) -> ChatThread:
    def score(th: ChatThread) -> tuple[int, int, int]:
        tid = int(th.id)
        has_ext = 1 if (th.external_chat_id or "").strip() else 0
        return (msg_counts.get(tid, 0), has_ext, -tid)  # больше сообщений, есть chatId, меньший id

    return max(threads, key=score)


async def merge_thread_into(
    db: AsyncSession,
    *,
    keeper: ChatThread,
    loser: ChatThread,
) -> None:
    """Переносит сообщения и read-markers с loser на keeper, затем удаляет loser."""
    if int(keeper.id) == int(loser.id):
        return
    await db.execute(
        update(ChatMessage)
        .where(ChatMessage.thread_id == int(loser.id))
        .values(thread_id=int(keeper.id)),
    )
    loser_reads = (
        await db.execute(
            select(ChatThreadUserRead).where(ChatThreadUserRead.thread_id == int(loser.id)),
        )
    ).scalars().all()
    for rr in loser_reads:
        keeper_rr = (
            await db.execute(
                select(ChatThreadUserRead)
                .where(
                    ChatThreadUserRead.user_id == int(rr.user_id),
                    ChatThreadUserRead.thread_id == int(keeper.id),
                )
                .limit(1),
            )
        ).scalars().first()
        if keeper_rr is None:
            rr.thread_id = int(keeper.id)
        else:
            keeper_rr.last_read_message_id = max(
                int(keeper_rr.last_read_message_id or 0),
                int(rr.last_read_message_id or 0),
            )
            await db.delete(rr)
    # Канонический chatId / lead
    if (loser.external_chat_id or "").strip() and not (keeper.external_chat_id or "").strip():
        keeper.external_chat_id = loser.external_chat_id
    else:
        k_norm = normalize_whatsapp_chat_id(keeper.external_chat_id)
        l_norm = normalize_whatsapp_chat_id(loser.external_chat_id)
        if k_norm and l_norm and phones_equivalent(k_norm.split("@", 1)[0], l_norm.split("@", 1)[0]):
            keeper.external_chat_id = k_norm if len(k_norm) >= len(l_norm) else l_norm
    if keeper.lead_id is None and loser.lead_id is not None:
        keeper.lead_id = loser.lead_id
    if keeper.pipeline_id is None and loser.pipeline_id is not None:
        keeper.pipeline_id = loser.pipeline_id
    if not (keeper.title or "").strip() and (loser.title or "").strip():
        keeper.title = loser.title
    await db.delete(loser)
    await db.flush()


async def merge_duplicate_chat_threads(
    db: AsyncSession,
    *,
    company_id: int | None = None,
    limit_companies: int = 50,
) -> dict[str, int]:
    """Сливает дубли:

    1) одинаковый (company, provider, external_chat_id);
    2) несколько green_api-тредов на один lead_id;
    3) эквивалентные @c.us (разный формат номера) в компании.
    """
    if company_id is not None:
        company_ids = [int(company_id)]
    else:
        company_ids = list(
            (
                await db.execute(select(Company.id).order_by(Company.id.asc()).limit(limit_companies))
            ).scalars().all(),
        )

    merged_exact = 0
    merged_lead = 0
    merged_phone = 0

    for cid in company_ids:
        threads = (
            await db.execute(
                select(ChatThread)
                .where(ChatThread.company_id == int(cid))
                .order_by(ChatThread.id.asc()),
            )
        ).scalars().all()
        if not threads:
            continue

        msg_counts: dict[int, int] = {}
        for th in threads:
            msg_counts[int(th.id)] = await _message_count(db, int(th.id))

        # 1) exact chatId
        by_exact: dict[tuple[str, str], list[ChatThread]] = defaultdict(list)
        for th in threads:
            ext = (th.external_chat_id or "").strip()
            if not ext:
                continue
            by_exact[(th.provider or "", ext)].append(th)
        for _key, group in by_exact.items():
            if len(group) < 2:
                continue
            keeper = _pick_keeper(group, msg_counts)
            for loser in group:
                if int(loser.id) == int(keeper.id):
                    continue
                await merge_thread_into(db, keeper=keeper, loser=loser)
                merged_exact += 1
                msg_counts[int(keeper.id)] = msg_counts.get(int(keeper.id), 0) + msg_counts.get(int(loser.id), 0)

        # refresh list after deletes
        threads = (
            await db.execute(
                select(ChatThread)
                .where(ChatThread.company_id == int(cid))
                .order_by(ChatThread.id.asc()),
            )
        ).scalars().all()
        msg_counts = {int(th.id): await _message_count(db, int(th.id)) for th in threads}

        # 2) one green_api thread per lead
        by_lead: dict[int, list[ChatThread]] = defaultdict(list)
        for th in threads:
            if (th.provider or "") != "green_api" or th.lead_id is None:
                continue
            by_lead[int(th.lead_id)].append(th)
        for _lid, group in by_lead.items():
            if len(group) < 2:
                continue
            keeper = _pick_keeper(group, msg_counts)
            for loser in group:
                if int(loser.id) == int(keeper.id):
                    continue
                await merge_thread_into(db, keeper=keeper, loser=loser)
                merged_lead += 1
                msg_counts[int(keeper.id)] = msg_counts.get(int(keeper.id), 0) + msg_counts.get(int(loser.id), 0)

        threads = (
            await db.execute(
                select(ChatThread)
                .where(ChatThread.company_id == int(cid))
                .order_by(ChatThread.id.asc()),
            )
        ).scalars().all()
        msg_counts = {int(th.id): await _message_count(db, int(th.id)) for th in threads}

        # 3) equivalent @c.us phone keys (green_api)
        by_phone: dict[tuple[str, str], list[ChatThread]] = defaultdict(list)
        for th in threads:
            if (th.provider or "") != "green_api":
                continue
            key = _chat_phone_key(th.external_chat_id)
            if key is None:
                continue
            by_phone[(th.provider or "", key)].append(th)
        for _key, group in by_phone.items():
            if len(group) < 2:
                continue
            keeper = _pick_keeper(group, msg_counts)
            canon = normalize_whatsapp_chat_id(keeper.external_chat_id) or keeper.external_chat_id
            if canon:
                keeper.external_chat_id = canon
            for loser in group:
                if int(loser.id) == int(keeper.id):
                    continue
                await merge_thread_into(db, keeper=keeper, loser=loser)
                merged_phone += 1

        await db.flush()

    total = merged_exact + merged_lead + merged_phone
    if total:
        logger.info(
            "chat_thread_dedup: exact=%s lead=%s phone=%s",
            merged_exact,
            merged_lead,
            merged_phone,
        )
    return {
        "merged_exact": merged_exact,
        "merged_lead": merged_lead,
        "merged_phone": merged_phone,
        "merged_total": total,
    }
