from pathlib import Path
from typing import Annotated
from uuid import uuid4

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import CurrentUser
from app.database import get_db
from app.models import Deal, TaskStatus, UserRole
from app.schemas.deal import DealRead, ProtocolConfirmBody

router = APIRouter(prefix="/deals", tags=["deals"])

UPLOAD_DIR = Path(__file__).resolve().parents[2] / "uploads" / "protocols"


@router.post("/{deal_id}/protocol/confirm", response_model=DealRead)
async def protocol_confirm(
    deal_id: int,
    body: ProtocolConfirmBody,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentUser,
) -> DealRead:
    if current_user.role != UserRole.expert:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Expert only")

    deal = await db.get(Deal, deal_id)
    if deal is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Deal not found")
    if not deal.is_protocol:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Deal is not a protocol")
    if not deal.protocol_requested:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="No active protocol request")

    if body.confirmed:
        deal.protocol_confirmed = True
    else:
        deal.protocol_confirmed = False
        deal.protocol_requested = False

    await db.flush()
    await db.refresh(deal)
    return DealRead.model_validate(deal)


@router.post("/{deal_id}/protocol/upload", response_model=DealRead)
async def protocol_upload(
    deal_id: int,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentUser,
    file: UploadFile = File(...),
) -> DealRead:
    if current_user.role != UserRole.expert:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Expert only")

    deal = await db.get(Deal, deal_id)
    if deal is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Deal not found")
    if not deal.is_protocol:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Deal is not a protocol")
    if not deal.protocol_confirmed:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Подтвердите протокол перед загрузкой файла")

    UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
    suffix = Path(file.filename).suffix
    name = f"{deal.lead_id or 0}_{deal.id}_{uuid4().hex}{suffix}"
    dst = UPLOAD_DIR / name
    data = await file.read()
    dst.write_bytes(data)

    deal.protocol_file_path = str(dst)
    await db.flush()
    await db.refresh(deal)
    return DealRead.model_validate(deal)

