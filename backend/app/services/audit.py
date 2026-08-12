from sqlalchemy.ext.asyncio import AsyncSession

from app.models import SystemAuditEvent, User


async def write_audit_event(
    db: AsyncSession,
    *,
    entity_type: str,
    action: str,
    current_user: User | None,
    entity_id: int | None = None,
    details: str | None = None,
) -> SystemAuditEvent:
    ev = SystemAuditEvent(
        company_id=(current_user.company_id if current_user else None),
        entity_type=entity_type,
        entity_id=entity_id,
        action=action,
        details=details,
        user_id=(current_user.id if current_user else None),
    )
    db.add(ev)
    await db.flush()
    return ev


async def log_audit_event(
    db: AsyncSession,
    *,
    entity_type: str,
    action: str,
    current_user: User | None,
    entity_id: int | None = None,
    details: str | None = None,
) -> SystemAuditEvent:
    return await write_audit_event(
        db,
        entity_type=entity_type,
        action=action,
        current_user=current_user,
        entity_id=entity_id,
        details=details,
    )
