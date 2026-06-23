"""Кто видит полный телефон пациента; маскирование для ролей без доступа."""

from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Pipeline, User, UserRole
from app.services.chief_expert_access import is_chief_expert

_FULL_PHONE_ROLES = frozenset(
    {
        UserRole.super_owner,
        UserRole.owner,
        UserRole.admin,
        UserRole.manager,
    },
)


def mask_patient_phone(phone: str | None) -> str:
    if not phone or not str(phone).strip():
        return "—"
    digits = "".join(ch for ch in str(phone) if ch.isdigit())
    if len(digits) >= 4:
        return f"+*** *** **{digits[-2:]}"
    return "***"


async def can_view_full_patient_phone(
    db: AsyncSession,
    user: User,
    pipeline_id: int | None,
) -> bool:
    if user.role in _FULL_PHONE_ROLES:
        return True
    if user.role == UserRole.expert and pipeline_id is not None:
        pipe = await db.get(Pipeline, int(pipeline_id))
        if pipe is not None and pipe.expert_user_id is not None:
            return int(pipe.expert_user_id) == int(user.id)
    if user.role == UserRole.expert and await is_chief_expert(db, user):
        return True
    return False


async def resolve_phone_fields(
    db: AsyncSession,
    user: User,
    pipeline_id: int | None,
    raw_phone: str | None,
) -> tuple[str | None, str, bool]:
    """Возвращает (phone для API, phone_display, can_view_full)."""
    can_view = await can_view_full_patient_phone(db, user, pipeline_id)
    if not raw_phone or not str(raw_phone).strip():
        return None, "—", can_view
    if can_view:
        return str(raw_phone).strip(), str(raw_phone).strip(), True
    return None, mask_patient_phone(raw_phone), False


async def expert_pipeline_ids(db: AsyncSession, user_id: int) -> set[int]:
    rows = (
        await db.execute(select(Pipeline.id).where(Pipeline.expert_user_id == int(user_id)))
    ).all()
    return {int(r[0]) for r in rows}
