from typing import Annotated

from fastapi import APIRouter, Depends, Query, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import CurrentCompanyId, CurrentUser
from app.database import get_db
from app.models import SystemAuditEvent, User, UserRole
from app.schemas.audit import SystemAuditEventRead

router = APIRouter(prefix="/audit", tags=["audit"])


@router.get("", response_model=list[SystemAuditEventRead], status_code=status.HTTP_200_OK)
async def list_audit_events(
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentUser,
    company_id: CurrentCompanyId,
    entity_type: str | None = Query(default=None),
    entity_id: int | None = Query(default=None),
    limit: int = Query(default=200, ge=1, le=500),
) -> list[SystemAuditEventRead]:
    if current_user.role not in (UserRole.owner, UserRole.admin):
        return []

    q = (
        select(SystemAuditEvent, User)
        .outerjoin(User, User.id == SystemAuditEvent.user_id)
        .where(SystemAuditEvent.company_id == company_id)
    )
    if entity_type:
        q = q.where(SystemAuditEvent.entity_type == entity_type.strip())
    if entity_id is not None:
        q = q.where(SystemAuditEvent.entity_id == entity_id)
    q = q.order_by(SystemAuditEvent.created_at.desc(), SystemAuditEvent.id.desc()).limit(limit)
    rows = (await db.execute(q)).all()
    return [
        SystemAuditEventRead(
            id=evt.id,
            entity_type=evt.entity_type,
            entity_id=evt.entity_id,
            action=evt.action,
            details=evt.details,
            user_id=evt.user_id,
            user_name=((usr.full_name or "").strip() or usr.email) if usr else None,
            created_at=evt.created_at,
        )
        for evt, usr in rows
    ]
