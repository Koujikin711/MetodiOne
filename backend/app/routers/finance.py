from datetime import datetime
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import CurrentCompanyId, CurrentUser
from app.database import get_db
from app.models import FinanceCompanySettings, FinanceOsvRow, UserRole
from app.schemas.finance_v2 import (
    FinanceDdsReportRead,
    FinanceIntegrateResultRead,
    FinanceIntegrationStatusRead,
    FinanceOpiuReportRead,
    FinanceOsvSummaryRead,
)
from app.services.finance_integrate import run_finance_integrate
from app.services.finance_report_build import build_dds_report, build_opiu_report, load_osv_summary

router = APIRouter(prefix="/finance", tags=["finance"])

_FINANCE_ROLES = frozenset(
    {
        UserRole.owner,
        UserRole.admin,
        UserRole.super_owner,
        UserRole.finance_analyst,
        UserRole.accountant,
    },
)


def _require_finance(user: CurrentUser) -> None:
    if user.role not in _FINANCE_ROLES:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Нет доступа к финансам")


@router.get("/integration-status", response_model=FinanceIntegrationStatusRead)
async def integration_status(
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentUser,
    company_id: CurrentCompanyId,
) -> FinanceIntegrationStatusRead:
    _require_finance(current_user)
    from app.services.finance_integrate import _get_gmail_integration

    integ = await _get_gmail_integration(db, company_id)
    cfg = integ.config if integ and isinstance(integ.config, dict) else {}
    email = str(cfg.get("email") or cfg.get("gmail_email") or "").strip() or None
    settings = (
        await db.execute(select(FinanceCompanySettings).where(FinanceCompanySettings.company_id == company_id))
    ).scalars().first()
    count = int(
        await db.scalar(select(func.count()).select_from(FinanceOsvRow).where(FinanceOsvRow.company_id == company_id))
        or 0,
    )
    return FinanceIntegrationStatusRead(
        gmail_connected=integ is not None and bool(email),
        gmail_email=email,
        last_sync_at=settings.updated_at if settings else None,
        osv_rows_count=count,
    )


@router.post("/integrate", response_model=FinanceIntegrateResultRead)
async def integrate_finance(
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentUser,
    company_id: CurrentCompanyId,
) -> FinanceIntegrateResultRead:
    """Забрать ОСВ из Gmail (вложения CSV/XLSX и уведомления) и из CRM (оплаты)."""
    _require_finance(current_user)
    if current_user.role == UserRole.finance_analyst:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Интеграция доступна владельцу и бухгалтеру")
    result = await run_finance_integrate(db, company_id)
    await db.commit()
    return FinanceIntegrateResultRead(**result)


@router.get("/osv", response_model=FinanceOsvSummaryRead)
async def get_osv(
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentUser,
    company_id: CurrentCompanyId,
    year: int = Query(default_factory=lambda: datetime.now().year, ge=2020, le=2100),
    month: int | None = Query(default=None, ge=1, le=12),
    limit: int = Query(default=500, ge=1, le=2000),
) -> FinanceOsvSummaryRead:
    _require_finance(current_user)
    return await load_osv_summary(db, company_id=company_id, year=year, month=month, limit=limit)


@router.get("/reports/dds", response_model=FinanceDdsReportRead)
async def get_dds_report(
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentUser,
    company_id: CurrentCompanyId,
    year: int = Query(default_factory=lambda: datetime.now().year, ge=2020, le=2100),
) -> FinanceDdsReportRead:
    _require_finance(current_user)
    return await build_dds_report(db, company_id=company_id, year=year)


@router.get("/reports/opiu", response_model=FinanceOpiuReportRead)
async def get_opiu_report(
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentUser,
    company_id: CurrentCompanyId,
    year: int = Query(default_factory=lambda: datetime.now().year, ge=2020, le=2100),
) -> FinanceOpiuReportRead:
    _require_finance(current_user)
    return await build_opiu_report(db, company_id=company_id, year=year)
