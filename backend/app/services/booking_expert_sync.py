"""Синхронизация колонок онлайн-записи с активными экспертами из «Сотрудники»."""

from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import BookingSpecialist, User, UserRole


async def ensure_active_expert_booking_profiles(db: AsyncSession, company_id: int) -> None:
    """Активный эксперт в CRM всегда доступен для новых записей в сетке."""
    rows = (
        await db.execute(
            select(BookingSpecialist)
            .join(User, User.id == BookingSpecialist.crm_user_id)
            .where(
                User.company_id == company_id,
                User.is_active.is_(True),
                User.role == UserRole.expert,
            ),
        )
    ).scalars().all()
    changed = False
    for spec in rows:
        if not spec.is_active or spec.company_id != company_id:
            spec.is_active = True
            spec.company_id = company_id
            changed = True
    if changed:
        await db.flush()
