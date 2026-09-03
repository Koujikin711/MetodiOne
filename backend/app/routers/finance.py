from datetime import UTC, datetime
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings as app_settings
from app.core.deps import CurrentCompanyId, CurrentUser
from app.database import get_db
from app.models import FinanceCompanySettings, FinanceOsvRow, UserRole
from app.schemas.finance_v2 import (
    FinanceDdsReportRead,
    FinanceExpenseCatalogRead,
    FinanceExpenseCreate,
    FinanceIntegrateResultRead,
    FinanceIntegrationStatusRead,
    FinanceOpiuReportRead,
    FinanceOsvRowRead,
    FinanceOsvSummaryRead,
    FinanceSettingsPatch,
    FinanceSettingsRead,
)
from app.services.chief_expert_access import assert_finance_access, assert_finance_settings_access, is_chief_expert
from app.services.clinic_roles import can_access_expenses
from app.services.finance_expense_catalog import expense_catalog
from app.services.finance_integrate import ensure_finance_settings, get_gmail_integration, run_finance_integrate
from app.services.finance_report_build import build_dds_report, build_opiu_report, load_osv_summary
from app.services.google_sheets_sync import _google_service_account_ready

router = APIRouter(prefix="/finance", tags=["finance"])


def _assert_expenses_access(user) -> None:
    if can_access_expenses(user.role):
        return
    raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Нет доступа к расходам")


def _settings_read(row: FinanceCompanySettings | None) -> FinanceSettingsRead:
    email = app_settings.google_service_account_email.strip() or None
    return FinanceSettingsRead(
        osv_sheet_url=row.osv_sheet_url if row else None,
        osv_sheet_name=row.osv_sheet_name if row else None,
        last_osv_import_from=row.last_osv_import_from if row else None,
        last_osv_import_to=row.last_osv_import_to if row else None,
        google_sheets_ready=_google_service_account_ready(),
        service_account_email=email,
    )


@router.get("/settings", response_model=FinanceSettingsRead)
async def get_finance_settings(
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentUser,
    company_id: CurrentCompanyId,
) -> FinanceSettingsRead:
    await assert_finance_access(db, current_user)
    row = (
        await db.execute(select(FinanceCompanySettings).where(FinanceCompanySettings.company_id == company_id))
    ).scalars().first()
    return _settings_read(row)


@router.patch("/settings", response_model=FinanceSettingsRead)
async def patch_finance_settings(
    body: FinanceSettingsPatch,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentUser,
    company_id: CurrentCompanyId,
) -> FinanceSettingsRead:
    await assert_finance_settings_access(db, current_user)
    row = await ensure_finance_settings(db, company_id)
    if body.osv_sheet_url is not None:
        url = body.osv_sheet_url.strip() or None
        row.osv_sheet_url = url
    if body.osv_sheet_name is not None:
        name = body.osv_sheet_name.strip() or None
        row.osv_sheet_name = name
    row.updated_at = datetime.now(UTC)
    await db.commit()
    await db.refresh(row)
    return _settings_read(row)


@router.get("/integration-status", response_model=FinanceIntegrationStatusRead)
async def integration_status(
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentUser,
    company_id: CurrentCompanyId,
) -> FinanceIntegrationStatusRead:
    await assert_finance_access(db, current_user)
    integ = await get_gmail_integration(db, company_id)
    cfg = integ.config if integ and isinstance(integ.config, dict) else {}
    email = str(cfg.get("email") or cfg.get("gmail_email") or "").strip() or None
    settings = (
        await db.execute(select(FinanceCompanySettings).where(FinanceCompanySettings.company_id == company_id))
    ).scalars().first()
    count = int(
        await db.scalar(select(func.count()).select_from(FinanceOsvRow).where(FinanceOsvRow.company_id == company_id))
        or 0,
    )
    sheet_url = (settings.osv_sheet_url or "").strip() if settings else ""
    return FinanceIntegrationStatusRead(
        gmail_connected=integ is not None and bool(email),
        gmail_email=email,
        sheets_connected=bool(sheet_url),
        osv_sheet_url=sheet_url or None,
        osv_sheet_name=settings.osv_sheet_name if settings else None,
        last_sync_at=settings.updated_at if settings else None,
        last_osv_import_from=settings.last_osv_import_from if settings else None,
        last_osv_import_to=settings.last_osv_import_to if settings else None,
        osv_rows_count=count,
    )


@router.post("/integrate", response_model=FinanceIntegrateResultRead)
async def integrate_finance(
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentUser,
    company_id: CurrentCompanyId,
) -> FinanceIntegrateResultRead:
    """Забрать ОСВ из Google Sheets, Gmail и CRM."""
    await assert_finance_access(db, current_user)
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
    await assert_finance_access(db, current_user)
    return await load_osv_summary(db, company_id=company_id, year=year, month=month, limit=limit)


@router.get("/reports/dds", response_model=FinanceDdsReportRead)
async def get_dds_report(
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentUser,
    company_id: CurrentCompanyId,
    year: int = Query(default_factory=lambda: datetime.now().year, ge=2020, le=2100),
) -> FinanceDdsReportRead:
    await assert_finance_access(db, current_user)
    return await build_dds_report(db, company_id=company_id, year=year)


@router.get("/reports/opiu", response_model=FinanceOpiuReportRead)
async def get_opiu_report(
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentUser,
    company_id: CurrentCompanyId,
    year: int = Query(default_factory=lambda: datetime.now().year, ge=2020, le=2100),
) -> FinanceOpiuReportRead:
    await assert_finance_access(db, current_user)
    return await build_opiu_report(db, company_id=company_id, year=year)


@router.get("/expense-catalog", response_model=FinanceExpenseCatalogRead)
async def get_expense_catalog(
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentUser,
) -> FinanceExpenseCatalogRead:
    _assert_expenses_access(current_user)
    await assert_finance_access(db, current_user)
    return FinanceExpenseCatalogRead(**expense_catalog())


@router.get("/expenses", response_model=list[FinanceOsvRowRead])
async def list_expenses(
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentUser,
    company_id: CurrentCompanyId,
    year: int = Query(default_factory=lambda: datetime.now().year, ge=2020, le=2100),
    month: int | None = Query(default=None, ge=1, le=12),
    limit: int = Query(default=200, ge=1, le=1000),
) -> list[FinanceOsvRowRead]:
    _assert_expenses_access(current_user)
    await assert_finance_access(db, current_user)
    q = (
        select(FinanceOsvRow)
        .where(
            FinanceOsvRow.company_id == company_id,
            FinanceOsvRow.expense > 0,
            func.extract("year", FinanceOsvRow.txn_date) == year,
        )
        .order_by(FinanceOsvRow.txn_date.desc(), FinanceOsvRow.id.desc())
        .limit(limit)
    )
    if month is not None:
        q = q.where(func.extract("month", FinanceOsvRow.txn_date) == month)
    rows = (await db.execute(q)).scalars().all()
    return [FinanceOsvRowRead.model_validate(r) for r in rows]


@router.post("/expenses", response_model=FinanceOsvRowRead, status_code=status.HTTP_201_CREATED)
async def create_expense(
    body: FinanceExpenseCreate,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentUser,
    company_id: CurrentCompanyId,
) -> FinanceOsvRowRead:
    _assert_expenses_access(current_user)
    await assert_finance_access(db, current_user)
    row = FinanceOsvRow(
        company_id=company_id,
        txn_date=body.txn_date,
        revenue=0,
        expense=body.expense,
        bank=(body.bank or "").strip() or None,
        basis=(body.basis or "").strip() or None,
        counterparty=(body.counterparty or "").strip() or None,
        phone=(body.phone or "").strip() or None,
        via_person=(body.via_person or "").strip() or None,
        product_service=(body.product_service or "").strip() or None,
        article=(body.article or "").strip() or None,
        detail_category=(body.detail_category or "").strip() or None,
        brief_category=(body.brief_category or "Расход").strip() or "Расход",
        source="manual",
        external_key=None,
    )
    db.add(row)
    await db.commit()
    await db.refresh(row)
    return FinanceOsvRowRead.model_validate(row)
