"""Дневной журнал куратора: таблица Дата · ФИО · Дневник питания · Фото · Жалоба."""

from __future__ import annotations

from datetime import UTC, date, datetime
from typing import Annotated

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, UploadFile, status
from fastapi.responses import FileResponse
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import CurrentCompanyId, CurrentUser
from app.database import get_db
from app.models import CuratorDailyEntry, User, UserRole
from app.schemas.curator_journal import (
    CuratorDailyEntryCreate,
    CuratorDailyEntryOut,
    CuratorDailyEntryUpdate,
)
from app.services.curator_journal_media import (
    delete_curator_photo,
    resolve_curator_photo,
    save_curator_photo,
)

router = APIRouter(prefix="/curator-journal", tags=["curator-journal"])

_ACCESS_ROLES = (
    UserRole.curator,
    UserRole.owner,
    UserRole.super_owner,
    UserRole.admin,
    UserRole.administrator,
)


def _assert_access(user: CurrentUser) -> None:
    if user.role not in _ACCESS_ROLES:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Дневник куратора доступен куратору и владельцу",
        )


def _entry_out(row: CuratorDailyEntry, created_by_name: str | None = None) -> CuratorDailyEntryOut:
    has_photo = bool(row.photo_path)
    return CuratorDailyEntryOut(
        id=int(row.id),
        company_id=int(row.company_id),
        entry_date=row.entry_date,
        full_name=row.full_name,
        food_diary=row.food_diary,
        has_photo=has_photo,
        photo_url=f"/api/curator-journal/entries/{int(row.id)}/photo" if has_photo else None,
        complaint=row.complaint,
        created_by_user_id=int(row.created_by_user_id) if row.created_by_user_id is not None else None,
        created_by_name=created_by_name,
        created_at=row.created_at,
        updated_at=row.updated_at,
    )


async def _creator_name(db: AsyncSession, user_id: int | None) -> str | None:
    if user_id is None:
        return None
    u = await db.get(User, int(user_id))
    if u is None:
        return None
    return (str(u.full_name or "").strip() or str(u.email or "").strip() or f"#{u.id}")


async def _get_entry(
    db: AsyncSession,
    *,
    entry_id: int,
    company_id: int,
) -> CuratorDailyEntry:
    row = await db.get(CuratorDailyEntry, entry_id)
    if row is None or int(row.company_id) != int(company_id):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Запись не найдена")
    return row


@router.get("/entries", response_model=list[CuratorDailyEntryOut])
async def list_entries(
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentUser,
    company_id: CurrentCompanyId,
    date_from: date | None = Query(None),
    date_to: date | None = Query(None),
    q: str | None = Query(None, max_length=200),
) -> list[CuratorDailyEntryOut]:
    _assert_access(current_user)
    stmt = select(CuratorDailyEntry).where(CuratorDailyEntry.company_id == company_id)
    if date_from is not None:
        stmt = stmt.where(CuratorDailyEntry.entry_date >= date_from)
    if date_to is not None:
        stmt = stmt.where(CuratorDailyEntry.entry_date <= date_to)
    if q and q.strip():
        needle = f"%{q.strip()}%"
        stmt = stmt.where(CuratorDailyEntry.full_name.ilike(needle))
    stmt = stmt.order_by(CuratorDailyEntry.entry_date.desc(), CuratorDailyEntry.id.desc())
    rows = (await db.execute(stmt)).scalars().all()
    out: list[CuratorDailyEntryOut] = []
    for row in rows:
        out.append(_entry_out(row, await _creator_name(db, row.created_by_user_id)))
    return out


@router.post("/entries", response_model=CuratorDailyEntryOut, status_code=status.HTTP_201_CREATED)
async def create_entry(
    body: CuratorDailyEntryCreate,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentUser,
    company_id: CurrentCompanyId,
) -> CuratorDailyEntryOut:
    _assert_access(current_user)
    name = body.full_name.strip()
    if not name:
        raise HTTPException(status_code=400, detail="Укажите ФИО")
    now = datetime.now(UTC)
    row = CuratorDailyEntry(
        company_id=company_id,
        entry_date=body.entry_date,
        full_name=name,
        food_diary=(body.food_diary or "").strip() or None,
        complaint=(body.complaint or "").strip() or None,
        created_by_user_id=int(current_user.id),
        created_at=now,
        updated_at=now,
    )
    db.add(row)
    await db.commit()
    await db.refresh(row)
    return _entry_out(row, await _creator_name(db, row.created_by_user_id))


@router.patch("/entries/{entry_id}", response_model=CuratorDailyEntryOut)
async def update_entry(
    entry_id: int,
    body: CuratorDailyEntryUpdate,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentUser,
    company_id: CurrentCompanyId,
) -> CuratorDailyEntryOut:
    _assert_access(current_user)
    row = await _get_entry(db, entry_id=entry_id, company_id=company_id)
    if body.entry_date is not None:
        row.entry_date = body.entry_date
    if body.full_name is not None:
        name = body.full_name.strip()
        if not name:
            raise HTTPException(status_code=400, detail="Укажите ФИО")
        row.full_name = name
    if body.food_diary is not None:
        row.food_diary = body.food_diary.strip() or None
    if body.complaint is not None:
        row.complaint = body.complaint.strip() or None
    row.updated_at = datetime.now(UTC)
    await db.commit()
    await db.refresh(row)
    return _entry_out(row, await _creator_name(db, row.created_by_user_id))


@router.delete("/entries/{entry_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_entry(
    entry_id: int,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentUser,
    company_id: CurrentCompanyId,
) -> None:
    _assert_access(current_user)
    row = await _get_entry(db, entry_id=entry_id, company_id=company_id)
    delete_curator_photo(row.photo_path)
    await db.delete(row)
    await db.commit()

@router.post("/entries/with-photo", response_model=CuratorDailyEntryOut, status_code=status.HTTP_201_CREATED)
async def create_entry_with_photo(
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentUser,
    company_id: CurrentCompanyId,
    entry_date: date = Form(...),
    full_name: str = Form(...),
    food_diary: str | None = Form(None),
    complaint: str | None = Form(None),
    file: UploadFile | None = File(None),
) -> CuratorDailyEntryOut:
    """Создать строку и сразу прикрепить фото (удобно с телефона)."""
    _assert_access(current_user)
    name = (full_name or "").strip()
    if not name:
        raise HTTPException(status_code=400, detail="Укажите ФИО")
    now = datetime.now(UTC)
    row = CuratorDailyEntry(
        company_id=company_id,
        entry_date=entry_date,
        full_name=name,
        food_diary=(food_diary or "").strip() or None,
        complaint=(complaint or "").strip() or None,
        created_by_user_id=int(current_user.id),
        created_at=now,
        updated_at=now,
    )
    db.add(row)
    await db.flush()
    if file is not None and file.filename:
        content = await file.read()
        if content:
            try:
                relative, mime = save_curator_photo(
                    int(row.id),
                    file.filename,
                    content,
                    mime=file.content_type,
                )
            except ValueError as e:
                raise HTTPException(status_code=400, detail=str(e)) from e
            row.photo_path = relative
            row.photo_mime = mime
    await db.commit()
    await db.refresh(row)
    return _entry_out(row, await _creator_name(db, row.created_by_user_id))


@router.post("/entries/{entry_id}/photo", response_model=CuratorDailyEntryOut)
async def upload_photo(
    entry_id: int,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentUser,
    company_id: CurrentCompanyId,
    file: UploadFile = File(...),
) -> CuratorDailyEntryOut:
    _assert_access(current_user)
    row = await _get_entry(db, entry_id=entry_id, company_id=company_id)
    content = await file.read()
    try:
        relative, mime = save_curator_photo(
            int(row.id),
            file.filename,
            content,
            mime=file.content_type,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    if row.photo_path and row.photo_path != relative:
        delete_curator_photo(row.photo_path)
    row.photo_path = relative
    row.photo_mime = mime
    row.updated_at = datetime.now(UTC)
    await db.commit()
    await db.refresh(row)
    return _entry_out(row, await _creator_name(db, row.created_by_user_id))


@router.get("/entries/{entry_id}/photo")
async def get_photo(
    entry_id: int,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentUser,
    company_id: CurrentCompanyId,
) -> FileResponse:
    _assert_access(current_user)
    row = await _get_entry(db, entry_id=entry_id, company_id=company_id)
    path = resolve_curator_photo(row.photo_path)
    if path is None:
        raise HTTPException(status_code=404, detail="Фото не найдено")
    media = row.photo_mime or "image/jpeg"
    return FileResponse(path, media_type=media, filename=path.name)
