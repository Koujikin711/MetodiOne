"""Имя пациента для журнала куратора — из онлайн-записи, не из чата/источника."""

from __future__ import annotations

from datetime import UTC, datetime

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import BookingAppointment


def pick_latest_booking_identity(
    rows: list[tuple[int, str | None, str | None, datetime | None, int]],
) -> dict[int, tuple[str, str]]:
    """Последняя не отменённая запись на Lead: (patient_name, patient_phone)."""
    best: dict[int, tuple[tuple, str, str]] = {}
    for lead_id, name, phone, start_at, appt_id in rows:
        lid = int(lead_id)
        at = start_at or datetime.min.replace(tzinfo=UTC)
        if at.tzinfo is None:
            at = at.replace(tzinfo=UTC)
        key = (at, int(appt_id))
        prev = best.get(lid)
        if prev is not None and key <= prev[0]:
            continue
        best[lid] = (key, (name or "").strip(), (phone or "").strip())
    return {lid: (name, phone) for lid, (_, name, phone) in best.items()}


def display_patient_identity(
    *,
    lead_name: str | None,
    lead_phone: str | None,
    booking: tuple[str, str] | None,
) -> tuple[str, str]:
    """Имя и телефон: онлайн-запись важнее имени из чата. Пустое имя записи не затирает карточку."""
    bname, bphone = booking or ("", "")
    name = bname or (lead_name or "").strip() or "—"
    phone = bphone or (lead_phone or "").strip()
    return name, phone


async def load_booking_identity_by_lead(
    db: AsyncSession,
    *,
    company_id: int,
    lead_ids: list[int],
) -> dict[int, tuple[str, str]]:
    if not lead_ids:
        return {}
    rows = (
        await db.execute(
            select(
                BookingAppointment.lead_id,
                BookingAppointment.patient_name,
                BookingAppointment.patient_phone,
                BookingAppointment.start_at,
                BookingAppointment.id,
            ).where(
                BookingAppointment.company_id == company_id,
                BookingAppointment.lead_id.in_(lead_ids),
                BookingAppointment.status.notin_(("cancelled",)),
            ),
        )
    ).all()
    return pick_latest_booking_identity(
        [(int(lid), name, phone, start_at, int(aid)) for lid, name, phone, start_at, aid in rows if lid is not None],
    )
