from __future__ import annotations

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Integration, User


async def count_company_active_users(db: AsyncSession, company_id: int) -> int:
    r = await db.execute(
        select(func.count()).select_from(User).where(User.company_id == company_id, User.is_active.is_(True)),
    )
    return int(r.scalar_one() or 0)


async def count_company_integrations(db: AsyncSession, company_id: int) -> int:
    r = await db.execute(select(func.count()).select_from(Integration).where(Integration.company_id == company_id))
    return int(r.scalar_one() or 0)
