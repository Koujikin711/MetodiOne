import math
from datetime import UTC, date, datetime, time, timedelta
from decimal import Decimal
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import and_, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import CurrentCompanyId, CurrentUser
from app.database import get_db
from app.models import AttendanceGeofence, AttendancePing, AttendanceShift, User, UserRole
from app.schemas.attendance import (
    AttendanceEmployeeSummary,
    AttendanceGeofenceCreate,
    AttendanceGeofenceRead,
    AttendanceGeofenceUpdate,
    AttendanceMyStatusRead,
    AttendancePingBody,
    AttendancePingRead,
    AttendancePoint,
    AttendanceReportRead,
    AttendanceShiftEndBody,
    AttendanceShiftRead,
    AttendanceShiftStartBody,
)

router = APIRouter(prefix="/attendance", tags=["attendance"])

EARTH_RADIUS_M = 6371000.0
MAX_ACCEPTABLE_ACCURACY_M = 150
MAX_JUMP_SPEED_KMH = 220.0


def _can_manage_geofences(role: UserRole) -> bool:
    return role in (UserRole.owner, UserRole.admin)


def _can_view_reports(role: UserRole) -> bool:
    return role in (UserRole.owner, UserRole.admin, UserRole.manager)


def _dist_m(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    p1 = math.radians(lat1)
    p2 = math.radians(lat2)
    dp = math.radians(lat2 - lat1)
    dl = math.radians(lon2 - lon1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return EARTH_RADIUS_M * 2 * math.atan2(math.sqrt(a), math.sqrt(max(1e-12, 1 - a)))


def _shift_to_read(s: AttendanceShift) -> AttendanceShiftRead:
    duration_sec: int | None = None
    if s.end_at is not None:
        duration_sec = max(int((s.end_at - s.start_at).total_seconds()), 0)
    return AttendanceShiftRead(
        id=s.id,
        user_id=s.user_id,
        geofence_id=s.geofence_id,
        start_at=s.start_at,
        end_at=s.end_at,
        started_in_geofence=s.started_in_geofence,
        ended_in_geofence=s.ended_in_geofence,
        suspicious=s.suspicious,
        suspicious_reason=s.suspicious_reason,
        duration_sec=duration_sec,
    )


def _ping_to_read(p: AttendancePing) -> AttendancePingRead:
    return AttendancePingRead(
        id=p.id,
        user_id=p.user_id,
        shift_id=p.shift_id,
        geofence_id=p.geofence_id,
        inside_geofence=p.inside_geofence,
        distance_to_geofence_m=p.distance_to_geofence_m,
        suspicious=p.suspicious,
        suspicious_reason=p.suspicious_reason,
        created_at=p.created_at,
    )


async def _get_geofence_or_404(db: AsyncSession, company_id: int, geofence_id: int) -> AttendanceGeofence:
    gf = await db.get(AttendanceGeofence, geofence_id)
    if gf is None or gf.company_id != company_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Геозона не найдена")
    return gf


def _point_geofence_state(point: AttendancePoint, gf: AttendanceGeofence) -> tuple[int, bool]:
    dist = _dist_m(point.latitude, point.longitude, float(gf.latitude), float(gf.longitude))
    dist_i = int(round(dist))
    return dist_i, dist <= float(gf.radius_m)


@router.get("/geofences", response_model=list[AttendanceGeofenceRead])
async def list_geofences(
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentUser,
    company_id: CurrentCompanyId,
) -> list[AttendanceGeofenceRead]:
    rows = await db.execute(
        select(AttendanceGeofence)
        .where(AttendanceGeofence.company_id == company_id)
        .order_by(AttendanceGeofence.is_active.desc(), AttendanceGeofence.id.desc())
    )
    items = rows.scalars().all()
    return [
        AttendanceGeofenceRead(
            id=x.id,
            name=x.name,
            address=x.address,
            latitude=float(x.latitude),
            longitude=float(x.longitude),
            radius_m=x.radius_m,
            is_active=x.is_active,
            created_at=x.created_at,
            updated_at=x.updated_at,
        )
        for x in items
    ]


@router.post("/geofences", response_model=AttendanceGeofenceRead, status_code=status.HTTP_201_CREATED)
async def create_geofence(
    body: AttendanceGeofenceCreate,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentUser,
    company_id: CurrentCompanyId,
) -> AttendanceGeofenceRead:
    if not _can_manage_geofences(current_user.role):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Недостаточно прав")
    item = AttendanceGeofence(
        company_id=company_id,
        name=body.name.strip(),
        address=(body.address or "").strip() or None,
        latitude=Decimal(str(body.latitude)),
        longitude=Decimal(str(body.longitude)),
        radius_m=body.radius_m,
        is_active=body.is_active,
    )
    db.add(item)
    await db.flush()
    await db.refresh(item)
    return AttendanceGeofenceRead(
        id=item.id,
        name=item.name,
        address=item.address,
        latitude=float(item.latitude),
        longitude=float(item.longitude),
        radius_m=item.radius_m,
        is_active=item.is_active,
        created_at=item.created_at,
        updated_at=item.updated_at,
    )


@router.patch("/geofences/{geofence_id}", response_model=AttendanceGeofenceRead)
async def update_geofence(
    geofence_id: int,
    body: AttendanceGeofenceUpdate,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentUser,
    company_id: CurrentCompanyId,
) -> AttendanceGeofenceRead:
    if not _can_manage_geofences(current_user.role):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Недостаточно прав")
    item = await _get_geofence_or_404(db, company_id, geofence_id)
    if body.name is not None:
        item.name = body.name.strip()
    if body.address is not None:
        item.address = body.address.strip() or None
    if body.latitude is not None:
        item.latitude = Decimal(str(body.latitude))
    if body.longitude is not None:
        item.longitude = Decimal(str(body.longitude))
    if body.radius_m is not None:
        item.radius_m = body.radius_m
    if body.is_active is not None:
        item.is_active = body.is_active
    await db.flush()
    await db.refresh(item)
    return AttendanceGeofenceRead(
        id=item.id,
        name=item.name,
        address=item.address,
        latitude=float(item.latitude),
        longitude=float(item.longitude),
        radius_m=item.radius_m,
        is_active=item.is_active,
        created_at=item.created_at,
        updated_at=item.updated_at,
    )


@router.get("/my/status", response_model=AttendanceMyStatusRead)
async def my_status(
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentUser,
    company_id: CurrentCompanyId,
) -> AttendanceMyStatusRead:
    active_shift = (
        await db.execute(
            select(AttendanceShift).where(
                AttendanceShift.company_id == company_id,
                AttendanceShift.user_id == current_user.id,
                AttendanceShift.end_at.is_(None),
            )
        )
    ).scalars().first()
    now = datetime.now(UTC)
    day_start = datetime.combine(now.date(), time.min, tzinfo=UTC)
    day_end = day_start + timedelta(days=1)
    rows = await db.execute(
        select(AttendanceShift.start_at, AttendanceShift.end_at).where(
            AttendanceShift.company_id == company_id,
            AttendanceShift.user_id == current_user.id,
            AttendanceShift.start_at >= day_start,
            AttendanceShift.start_at < day_end,
        )
    )
    total_sec = 0
    for start_at, end_at in rows.all():
        e = end_at or now
        total_sec += max(int((e - start_at).total_seconds()), 0)
    return AttendanceMyStatusRead(
        active_shift=_shift_to_read(active_shift) if active_shift else None,
        today_total_sec=total_sec,
    )


@router.post("/shifts/start", response_model=AttendanceShiftRead, status_code=status.HTTP_201_CREATED)
async def start_shift(
    body: AttendanceShiftStartBody,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentUser,
    company_id: CurrentCompanyId,
) -> AttendanceShiftRead:
    if body.accuracy_m is not None and body.accuracy_m > MAX_ACCEPTABLE_ACCURACY_M:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Слабая точность геолокации")
    existing = (
        await db.execute(
            select(AttendanceShift).where(
                AttendanceShift.company_id == company_id,
                AttendanceShift.user_id == current_user.id,
                AttendanceShift.end_at.is_(None),
            )
        )
    ).scalars().first()
    if existing is not None:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Смена уже начата")
    geofence_id = body.geofence_id
    started_in_geofence = False
    suspicious_reason: str | None = None
    if geofence_id is not None:
        gf = await _get_geofence_or_404(db, company_id, geofence_id)
        _, started_in_geofence = _point_geofence_state(body, gf)
        if not started_in_geofence:
            suspicious_reason = "Старт вне геозоны"
    shift = AttendanceShift(
        company_id=company_id,
        user_id=current_user.id,
        geofence_id=geofence_id,
        start_latitude=Decimal(str(body.latitude)),
        start_longitude=Decimal(str(body.longitude)),
        start_accuracy_m=body.accuracy_m,
        started_in_geofence=started_in_geofence,
        suspicious=not started_in_geofence if geofence_id is not None else False,
        suspicious_reason=suspicious_reason,
    )
    db.add(shift)
    await db.flush()
    return _shift_to_read(shift)


@router.post("/shifts/end", response_model=AttendanceShiftRead)
async def end_shift(
    body: AttendanceShiftEndBody,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentUser,
    company_id: CurrentCompanyId,
) -> AttendanceShiftRead:
    shift = await db.get(AttendanceShift, body.shift_id)
    if shift is None or shift.company_id != company_id or shift.user_id != current_user.id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Смена не найдена")
    if shift.end_at is not None:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Смена уже закрыта")
    if body.accuracy_m is not None and body.accuracy_m > MAX_ACCEPTABLE_ACCURACY_M:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Слабая точность геолокации")
    shift.end_at = datetime.now(UTC)
    shift.end_latitude = Decimal(str(body.latitude))
    shift.end_longitude = Decimal(str(body.longitude))
    shift.end_accuracy_m = body.accuracy_m
    if shift.geofence_id is not None:
        gf = await _get_geofence_or_404(db, company_id, shift.geofence_id)
        _, inside = _point_geofence_state(body, gf)
        shift.ended_in_geofence = inside
        if not inside:
            shift.suspicious = True
            shift.suspicious_reason = "Выход вне геозоны"
    await db.flush()
    return _shift_to_read(shift)


@router.post("/ping", response_model=AttendancePingRead, status_code=status.HTTP_201_CREATED)
async def push_ping(
    body: AttendancePingBody,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentUser,
    company_id: CurrentCompanyId,
) -> AttendancePingRead:
    geofence_id = body.geofence_id
    active_shift = (
        await db.execute(
            select(AttendanceShift).where(
                AttendanceShift.company_id == company_id,
                AttendanceShift.user_id == current_user.id,
                AttendanceShift.end_at.is_(None),
            )
        )
    ).scalars().first()
    if body.shift_id is not None:
        active_shift = await db.get(AttendanceShift, body.shift_id)
        if active_shift is None or active_shift.company_id != company_id or active_shift.user_id != current_user.id:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Смена не найдена")
    if geofence_id is None and active_shift is not None:
        geofence_id = active_shift.geofence_id
    dist_i: int | None = None
    inside = False
    if geofence_id is not None:
        gf = await _get_geofence_or_404(db, company_id, geofence_id)
        dist_i, inside = _point_geofence_state(body, gf)
    suspicious = False
    reasons: list[str] = []
    if body.accuracy_m is not None and body.accuracy_m > MAX_ACCEPTABLE_ACCURACY_M:
        suspicious = True
        reasons.append("Низкая точность GPS")

    prev_ping = (
        await db.execute(
            select(AttendancePing)
            .where(
                AttendancePing.company_id == company_id,
                AttendancePing.user_id == current_user.id,
            )
            .order_by(AttendancePing.created_at.desc())
            .limit(1)
        )
    ).scalars().first()
    if prev_ping is not None:
        seconds = max((datetime.now(UTC) - prev_ping.created_at).total_seconds(), 1.0)
        jump_m = _dist_m(body.latitude, body.longitude, float(prev_ping.latitude), float(prev_ping.longitude))
        speed_kmh = (jump_m / seconds) * 3.6
        if speed_kmh > MAX_JUMP_SPEED_KMH:
            suspicious = True
            reasons.append("Подозрительный прыжок координат")

    ping = AttendancePing(
        company_id=company_id,
        user_id=current_user.id,
        shift_id=active_shift.id if active_shift else None,
        geofence_id=geofence_id,
        latitude=Decimal(str(body.latitude)),
        longitude=Decimal(str(body.longitude)),
        accuracy_m=body.accuracy_m,
        distance_to_geofence_m=dist_i,
        inside_geofence=inside,
        suspicious=suspicious,
        suspicious_reason="; ".join(reasons) if reasons else None,
    )
    db.add(ping)
    await db.flush()
    return _ping_to_read(ping)


@router.get("/report", response_model=AttendanceReportRead)
async def attendance_report(
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentUser,
    company_id: CurrentCompanyId,
    date_from: date = Query(...),
    date_to: date = Query(...),
    user_id: int | None = Query(default=None, ge=1),
) -> AttendanceReportRead:
    if not _can_view_reports(current_user.role):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Недостаточно прав")
    if date_to < date_from:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Неверный период")
    if (date_to - date_from).days > 93:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Максимальный период отчета 93 дня")

    dt_from = datetime.combine(date_from, time.min, tzinfo=UTC)
    dt_to = datetime.combine(date_to + timedelta(days=1), time.min, tzinfo=UTC)
    filters = [
        AttendanceShift.company_id == company_id,
        AttendanceShift.start_at >= dt_from,
        AttendanceShift.start_at < dt_to,
    ]
    if user_id is not None:
        filters.append(AttendanceShift.user_id == user_id)
    rows = await db.execute(
        select(
            AttendanceShift.user_id,
            User.full_name,
            User.email,
            AttendanceShift.start_at,
            AttendanceShift.end_at,
            AttendanceShift.suspicious,
        )
        .join(User, User.id == AttendanceShift.user_id)
        .where(and_(*filters))
        .order_by(User.full_name.asc().nulls_last(), User.id.asc())
    )
    now = datetime.now(UTC)
    agg: dict[int, AttendanceEmployeeSummary] = {}
    for uid, full_name, email, start_at, end_at, suspicious in rows.all():
        item = agg.get(uid)
        if item is None:
            item = AttendanceEmployeeSummary(
                user_id=uid,
                full_name=full_name,
                email=email,
                total_sec=0,
                shifts_count=0,
                suspicious_events=0,
            )
            agg[uid] = item
        item.shifts_count += 1
        item.total_sec += max(int(((end_at or now) - start_at).total_seconds()), 0)
        if suspicious:
            item.suspicious_events += 1

    ping_filters = [
        AttendancePing.company_id == company_id,
        AttendancePing.created_at >= dt_from,
        AttendancePing.created_at < dt_to,
        AttendancePing.suspicious.is_(True),
    ]
    if user_id is not None:
        ping_filters.append(AttendancePing.user_id == user_id)
    ping_rows = await db.execute(
        select(AttendancePing.user_id, func.count())
        .where(and_(*ping_filters))
        .group_by(AttendancePing.user_id)
    )
    for uid, cnt in ping_rows.all():
        if uid in agg:
            agg[uid].suspicious_events += int(cnt)

    return AttendanceReportRead(
        date_from=date_from,
        date_to=date_to,
        employees=sorted(agg.values(), key=lambda x: x.total_sec, reverse=True),
    )
