"""Номера визитов и потоки курсов (формат поток:день, например 1:10)."""

from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass
from datetime import datetime
from zoneinfo import ZoneInfo

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.models import BookingAppointment, BookingDirection, BookingSpecialist


@dataclass(frozen=True)
class CourseStreamSettings:
    enabled: bool = False
    max_days: int = 15
    min_day_for_next: int = 10
    gap_days: int = 10


@dataclass(frozen=True)
class VisitLabelInfo:
    visit_number: int | None = None
    visit_stream: int | None = None
    visit_stream_day: int | None = None
    visit_label: str | None = None


def course_stream_settings_from_specialist(s: BookingSpecialist) -> CourseStreamSettings:
    return CourseStreamSettings(
        enabled=bool(getattr(s, "course_streams_enabled", False)),
        max_days=max(1, int(getattr(s, "course_stream_max_days", 15) or 15)),
        min_day_for_next=max(1, int(getattr(s, "course_stream_min_day_for_next", 10) or 10)),
        gap_days=max(1, int(getattr(s, "course_stream_gap_days", 10) or 10)),
    )


def _booking_tz() -> ZoneInfo:
    return ZoneInfo(settings.booking_timezone)


def _calendar_day_in_stream(stream_start: datetime, at: datetime) -> int:
    tz = _booking_tz()
    d0 = stream_start.astimezone(tz).date()
    d1 = at.astimezone(tz).date()
    return max(1, (d1 - d0).days + 1)


def _gap_days_between(last_at: datetime, at: datetime) -> int:
    tz = _booking_tz()
    return (at.astimezone(tz).date() - last_at.astimezone(tz).date()).days


def compute_course_stream_labels(
    appointments: list[tuple[int, datetime]],
    cfg: CourseStreamSettings,
) -> dict[int, VisitLabelInfo]:
    """appointments: [(id, start_at)] отсортированы по start_at."""
    if not appointments:
        return {}
    stream = 1
    stream_start: datetime | None = None
    last_visit_at: datetime | None = None
    max_day_in_stream = 0
    out: dict[int, VisitLabelInfo] = {}

    for appt_id, at in appointments:
        if stream_start is None:
            stream_start = at
            day = 1
            max_day_in_stream = 1
        else:
            day_candidate = _calendar_day_in_stream(stream_start, at)
            gap = _gap_days_between(last_visit_at, at) if last_visit_at else 0
            new_stream = False
            if day_candidate > cfg.max_days:
                new_stream = True
            elif max_day_in_stream >= cfg.min_day_for_next and gap >= cfg.gap_days:
                new_stream = True
            if new_stream:
                stream += 1
                stream_start = at
                day = 1
                max_day_in_stream = 1
            else:
                day = day_candidate
                max_day_in_stream = max(max_day_in_stream, day)

        label = f"{stream}:{day}"
        out[int(appt_id)] = VisitLabelInfo(
            visit_number=day,
            visit_stream=stream,
            visit_stream_day=day,
            visit_label=label,
        )
        last_visit_at = at

    return out


def compute_simple_visit_numbers(appointments: list[tuple[int, datetime]]) -> dict[int, VisitLabelInfo]:
    out: dict[int, VisitLabelInfo] = {}
    for idx, (appt_id, _at) in enumerate(appointments, start=1):
        out[int(appt_id)] = VisitLabelInfo(visit_number=idx, visit_label=str(idx))
    return out


def visit_group_key(
    phone: str | None,
    specialist_id: int,
    *,
    norm_phone,
    direction_id: int | None = None,
    use_direction: bool = False,
) -> tuple[str, int]:
    digits = norm_phone(phone) or ""
    if len(digits) >= 9:
        digits = digits[-9:]
    elif not digits:
        digits = (phone or "").strip().lower()
    if use_direction and direction_id is not None:
        return (digits, int(direction_id))
    return (digits, int(specialist_id))


def course_stream_settings_from_direction(d: BookingDirection) -> CourseStreamSettings:
    return CourseStreamSettings(
        enabled=bool(getattr(d, "course_streams_enabled", False)),
        max_days=max(1, int(getattr(d, "course_stream_max_days", 15) or 15)),
        min_day_for_next=max(1, int(getattr(d, "course_stream_min_day_for_next", 10) or 10)),
        gap_days=max(1, int(getattr(d, "course_stream_gap_days", 10) or 10)),
    )


async def visit_labels_for_ids(
    db: AsyncSession,
    *,
    company_id: int,
    appointment_ids: list[int],
    norm_phone,
) -> dict[int, VisitLabelInfo]:
    if not appointment_ids:
        return {}
    targets = (
        await db.execute(
            select(BookingAppointment.specialist_id).where(
                BookingAppointment.id.in_(appointment_ids),
                BookingAppointment.company_id == company_id,
            )
        )
    ).all()
    spec_ids = {int(r[0]) for r in targets}
    if not spec_ids:
        return {}

    spec_rows = (
        await db.execute(select(BookingSpecialist).where(BookingSpecialist.id.in_(spec_ids)))
    ).scalars().all()
    spec_cfg = {int(s.id): course_stream_settings_from_specialist(s) for s in spec_rows}

    dir_ids = (
        await db.execute(
            select(BookingAppointment.direction_id).where(
                BookingAppointment.company_id == company_id,
                BookingAppointment.specialist_id.in_(spec_ids),
            )
        )
    ).all()
    direction_ids = {int(r[0]) for r in dir_ids if r[0] is not None}
    dir_rows = (
        await db.execute(select(BookingDirection).where(BookingDirection.id.in_(direction_ids)))
    ).scalars().all() if direction_ids else []
    dir_cfg = {int(d.id): course_stream_settings_from_direction(d) for d in dir_rows}

    rows = (
        await db.execute(
            select(
                BookingAppointment.id,
                BookingAppointment.specialist_id,
                BookingAppointment.direction_id,
                BookingAppointment.patient_phone,
                BookingAppointment.start_at,
            )
            .where(
                BookingAppointment.company_id == company_id,
                BookingAppointment.specialist_id.in_(spec_ids),
                BookingAppointment.status != "cancelled",
            )
            .order_by(BookingAppointment.start_at.asc(), BookingAppointment.id.asc())
        )
    ).all()

    groups: dict[tuple[str, int], list[tuple[int, datetime]]] = defaultdict(list)
    group_meta: dict[tuple[str, int], tuple[bool, CourseStreamSettings]] = {}
    for aid, sid, did, phone, start in rows:
        did_int = int(did) if did is not None else None
        d_cfg = dir_cfg.get(did_int, CourseStreamSettings()) if did_int else CourseStreamSettings()
        s_cfg = spec_cfg.get(int(sid), CourseStreamSettings())
        use_dir = bool(d_cfg.enabled)
        cfg = d_cfg if use_dir else s_cfg
        key = visit_group_key(
            phone,
            int(sid),
            norm_phone=norm_phone,
            direction_id=did_int,
            use_direction=use_dir,
        )
        groups[key].append((int(aid), start))
        group_meta[key] = (bool(cfg.enabled), cfg)

    visit_map: dict[int, VisitLabelInfo] = {}
    for key, appts in groups.items():
        if not appts:
            continue
        enabled, cfg = group_meta.get(key, (False, CourseStreamSettings()))
        if enabled:
            labeled = compute_course_stream_labels(appts, cfg)
        else:
            labeled = compute_simple_visit_numbers(appts)
        visit_map.update(labeled)

    default = VisitLabelInfo(visit_number=1, visit_label="1")
    return {int(aid): visit_map.get(int(aid), default) for aid in appointment_ids}
