import re
from typing import Annotated

from fastapi import APIRouter, Depends, Query, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import CurrentCompanyId, CurrentUser
from app.database import get_db
from app.models import LeadAuditEvent, SystemAuditEvent, User, UserRole
from app.schemas.audit import SystemAuditEventRead

router = APIRouter(prefix="/audit", tags=["audit"])

_ID_IN_DETAILS = re.compile(
    r"\b(?:user_id|actor_user_id|author_user_id|from_manager_id|to_manager_id|manager_id)=(\d+)",
    re.I,
)


def _system_actor_label(action: str) -> str:
    if action.startswith("whatsapp_"):
        return "Система · WhatsApp"
    if action == "ingested":
        return "Система · интеграция"
    return "Система"


def _user_label(usr: User) -> tuple[str, str | None]:
    name = (usr.full_name or "").strip()
    email = (usr.email or "").strip() or None
    if name and email and name.lower() != email.lower():
        return f"{name} · {email}", email
    if name:
        return name, email
    if email:
        return email, email
    return f"Пользователь №{usr.id}", email


def _ids_from_details(details: str | None) -> list[int]:
    if not details:
        return []
    out: list[int] = []
    for m in _ID_IN_DETAILS.finditer(details):
        n = int(m.group(1))
        if n not in out:
            out.append(n)
    return out


def _to_read(
    *,
    evt_id: int,
    entity_type: str,
    entity_id: int | None,
    action: str,
    details: str | None,
    user_id: int | None,
    created_at,
    source: str,
    users: dict[int, User],
) -> SystemAuditEventRead:
    actor_id = user_id
    if actor_id is None:
        fallback = _ids_from_details(details)
        actor_id = fallback[0] if fallback else None
    usr = users.get(actor_id) if actor_id is not None else None
    if usr is not None:
        label, email = _user_label(usr)
        return SystemAuditEventRead(
            id=evt_id,
            entity_type=entity_type,
            entity_id=entity_id,
            action=action,
            details=details,
            user_id=usr.id,
            user_name=label,
            user_email=email,
            source=source,
            created_at=created_at,
        )
    if actor_id is not None:
        return SystemAuditEventRead(
            id=evt_id,
            entity_type=entity_type,
            entity_id=entity_id,
            action=action,
            details=details,
            user_id=actor_id,
            user_name=f"Пользователь №{actor_id}",
            user_email=None,
            source=source,
            created_at=created_at,
        )
    return SystemAuditEventRead(
        id=evt_id,
        entity_type=entity_type,
        entity_id=entity_id,
        action=action,
        details=details,
        user_id=None,
        user_name=_system_actor_label(action),
        user_email=None,
        source=source,
        created_at=created_at,
    )


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

    type_filter = (entity_type or "").strip()
    include_lead = type_filter in ("", "lead")

    sys_q = select(SystemAuditEvent).where(SystemAuditEvent.company_id == company_id)
    if type_filter:
        sys_q = sys_q.where(SystemAuditEvent.entity_type == type_filter)
    if entity_id is not None:
        sys_q = sys_q.where(SystemAuditEvent.entity_id == entity_id)
    sys_q = sys_q.order_by(SystemAuditEvent.created_at.desc(), SystemAuditEvent.id.desc()).limit(limit)
    sys_rows = (await db.execute(sys_q)).scalars().all()

    lead_rows: list[LeadAuditEvent] = []
    if include_lead:
        lead_q = select(LeadAuditEvent).where(LeadAuditEvent.company_id == company_id)
        if entity_id is not None:
            lead_q = lead_q.where(LeadAuditEvent.lead_id == entity_id)
        lead_q = lead_q.order_by(LeadAuditEvent.created_at.desc(), LeadAuditEvent.id.desc()).limit(limit)
        lead_rows = list((await db.execute(lead_q)).scalars().all())

    needed_ids: set[int] = set()
    for evt in sys_rows:
        if evt.user_id:
            needed_ids.add(int(evt.user_id))
        needed_ids.update(_ids_from_details(evt.details))
    for evt in lead_rows:
        if evt.user_id:
            needed_ids.add(int(evt.user_id))
        needed_ids.update(_ids_from_details(evt.details))

    users: dict[int, User] = {}
    if needed_ids:
        found = (await db.execute(select(User).where(User.id.in_(needed_ids)))).scalars().all()
        users = {int(u.id): u for u in found}

    items = [
        _to_read(
            evt_id=int(evt.id),
            entity_type=evt.entity_type,
            entity_id=evt.entity_id,
            action=evt.action,
            details=evt.details,
            user_id=evt.user_id,
            created_at=evt.created_at,
            source="system",
            users=users,
        )
        for evt in sys_rows
    ]
    items.extend(
        _to_read(
            evt_id=int(evt.id),
            entity_type="lead",
            entity_id=evt.lead_id,
            action=evt.action,
            details=evt.details,
            user_id=evt.user_id,
            created_at=evt.created_at,
            source="lead",
            users=users,
        )
        for evt in lead_rows
    )
    items.sort(key=lambda x: (x.created_at, x.id), reverse=True)
    return items[:limit]
