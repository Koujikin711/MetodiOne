from calendar import monthrange
from collections import defaultdict
from datetime import UTC, date, datetime
from decimal import Decimal
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings as app_settings
from app.core.deps import CurrentCompanyId, CurrentUser
from app.database import get_db
from app.models import (
    BookingSpecialist,
    FinanceCompanySettings,
    FinanceOsvRow,
    PayrollAdjustment,
    PayrollSheetHide,
    EmployeeNameTerm,
    Pipeline,
    User,
    UserRole,
)
from app.schemas.finance_v2 import (
    FinanceDdsReportRead,
    FinanceExpenseCatalogRead,
    FinanceExpenseCreate,
    FinancePayrollAdjustmentWrite,
    FinancePayrollReport,
    FinancePayrollRow,
    FinanceStaffCard,
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


_PAY_ROLES = frozenset(
    {
        UserRole.manager,
        UserRole.curator,
        UserRole.administrator,
        UserRole.expert,
        UserRole.accountant,
        UserRole.rop,
        UserRole.admin,
    }
)


def _norm_person(value: str | None) -> str:
    return " ".join((value or "").replace("ё", "е").replace("Ё", "Е").casefold().split())


def _fot_advances(rows, by_id: dict[int, User], name_to_id: dict[str, int]) -> dict[int, Decimal]:
    advances: dict[int, Decimal] = defaultdict(lambda: Decimal("0"))
    for row in rows:
        article = (row.article or "").casefold()
        brief = (row.brief_category or "").casefold()
        if "фот" not in article and "зарплат" not in brief and "зарплат" not in article:
            continue
        amount = Decimal(str(row.expense or 0))
        if row.employee_user_id and int(row.employee_user_id) in by_id:
            advances[int(row.employee_user_id)] += amount
            continue
        matched = name_to_id.get(_norm_person(row.counterparty))
        if matched is not None:
            advances[matched] += amount
    return advances


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
    # Диапазон дат (не extract) — чтобы работал индекс txn_date / company_id.
    if month is not None:
        day_from = date(year, month, 1)
        day_to = date(year, month, monthrange(year, month)[1])
    else:
        day_from = date(year, 1, 1)
        day_to = date(year, 12, 31)
    rows = (
        await db.execute(
            select(FinanceOsvRow)
            .where(
                FinanceOsvRow.company_id == company_id,
                FinanceOsvRow.expense != 0,
                FinanceOsvRow.txn_date >= day_from,
                FinanceOsvRow.txn_date <= day_to,
            )
            .order_by(FinanceOsvRow.txn_date.desc(), FinanceOsvRow.id.desc())
            .limit(limit)
        )
    ).scalars().all()
    return [FinanceOsvRowRead.model_validate(r) for r in rows]


@router.get("/staff", response_model=list[FinanceStaffCard])
async def list_pay_staff(
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentUser,
    company_id: CurrentCompanyId,
) -> list[FinanceStaffCard]:
    """Сотрудники и менеджеры для статьи ФОТ."""
    _assert_expenses_access(current_user)
    await assert_finance_access(db, current_user)
    users = (
        await db.execute(
            select(User)
            .where(
                User.company_id == company_id,
                User.is_active.is_(True),
                User.role.in_(list(_PAY_ROLES)),
            )
            .order_by(User.full_name.asc(), User.id.asc())
        )
    ).scalars().all()
    return [
        FinanceStaffCard(
            id=int(u.id),
            full_name=u.full_name,
            phone=u.phone,
            role=u.role.value if hasattr(u.role, "value") else str(u.role),
            base_salary=u.base_salary,
            payout_bank=u.payout_bank,
        )
        for u in users
        if (u.full_name or "").strip()
    ]


@router.get("/payroll", response_model=FinancePayrollReport)
async def payroll_sheet(
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentUser,
    company_id: CurrentCompanyId,
    year: int = Query(..., ge=2020, le=2100),
    month: int = Query(..., ge=1, le=12),
) -> FinancePayrollReport:
    """Ведомость за месяц: оклад, бонус KPI, авансы из расходов. Ничего не выплачивает."""
    _assert_expenses_access(current_user)
    await assert_finance_access(db, current_user)
    day_from = date(year, month, 1)
    day_to = date(year, month, monthrange(year, month)[1])
    users = (
        await db.execute(
            select(User).where(
                User.company_id == company_id,
                User.is_active.is_(True),
                User.role.in_(list(_PAY_ROLES)),
            )
        )
    ).scalars().all()
    by_id = {int(u.id): u for u in users if (u.full_name or "").strip()}
    name_hits: dict[str, list[int]] = defaultdict(list)
    for uid, user in by_id.items():
        name_hits[_norm_person(user.full_name)].append(uid)
    name_to_id = {name: ids[0] for name, ids in name_hits.items() if name and len(ids) == 1}

    fot_rows = (
        await db.execute(
            select(FinanceOsvRow).where(
                FinanceOsvRow.company_id == company_id,
                FinanceOsvRow.txn_date >= day_from,
                FinanceOsvRow.txn_date <= day_to,
                FinanceOsvRow.expense > 0,
            )
        )
    ).scalars().all()
    advances = _fot_advances(fot_rows, by_id, name_to_id)

    bonus_by_id: dict[int, Decimal] = {}
    pipeline_name: str | None = None
    pipes = (
        await db.execute(
            select(Pipeline).where(Pipeline.company_id == company_id).order_by(Pipeline.id.asc())
        )
    ).scalars().all()
    pipe = next((p for p in pipes if "медицин" in (p.name or "").casefold()), pipes[0] if pipes else None)
    if pipe is not None:
        from app.routers.sales_kpi_board import _build_sales_report
        from app.services.sales_kpi_weighted import parse_year_month

        report = await _build_sales_report(
            db,
            company_id=company_id,
            pipe=pipe,
            ym=parse_year_month(f"{year:04d}-{month:02d}"),
        )
        pipeline_name = report.pipeline_name
        for manager in report.managers:
            bonus_by_id[int(manager.manager_id)] = Decimal(str(manager.bonus or 0))

    from dataclasses import replace

    from app.services.payroll_facts import load_payroll_facts
    from app.services.payroll_rules import accrue, carried_company_debt, payroll_name_on, payroll_profile

    year_month = f"{year:04d}-{month:02d}"
    specs = (
        await db.execute(
            select(
                BookingSpecialist.crm_user_id,
                BookingSpecialist.specialization,
                BookingSpecialist.full_name,
            ).where(
                BookingSpecialist.company_id == company_id,
                BookingSpecialist.crm_user_id.is_not(None),
            )
        )
    ).all()
    spec_by_user = {
        int(uid): (spec or "")
        for uid, spec, _name in specs
        if uid is not None
    }
    adjustments = {
        int(row.user_id): row
        for row in (
            await db.execute(
                select(PayrollAdjustment).where(
                    PayrollAdjustment.company_id == company_id,
                    PayrollAdjustment.year_month == year_month,
                )
            )
        ).scalars().all()
    }
    facts_by_user = await load_payroll_facts(
        db,
        company_id=company_id,
        day_from=day_from,
        day_to=day_to,
        user_ids=set(by_id),
    )
    month_end = date(year, month, monthrange(year, month)[1])
    name_history: dict[int, list[tuple[date, str]]] = defaultdict(list)
    for term in (
        await db.execute(
            select(EmployeeNameTerm).where(EmployeeNameTerm.company_id == company_id)
        )
    ).scalars().all():
        name_history[int(term.user_id)].append((term.effective_on, term.full_name))

    debt_history: dict[int, list[tuple[str, Decimal | None]]] = defaultdict(list)
    for debt_row in (
        await db.execute(
            select(PayrollAdjustment).where(
                PayrollAdjustment.company_id == company_id,
                PayrollAdjustment.company_debt.is_not(None),
                PayrollAdjustment.year_month <= year_month,
            )
        )
    ).scalars().all():
        debt_history[int(debt_row.user_id)].append((debt_row.year_month, debt_row.company_debt))

    out: list[FinancePayrollRow] = []
    seen = set(by_id) | set(advances) | set(bonus_by_id)
    hidden = {
        int(uid)
        for uid in (
            await db.execute(
                select(PayrollSheetHide.user_id).where(PayrollSheetHide.company_id == company_id)
            )
        ).scalars().all()
    }
    for uid in seen:
        if uid in hidden:
            continue
        user = by_id.get(uid)
        if user is None:
            continue
        role = user.role.value if hasattr(user.role, "value") else str(user.role)
        spec = spec_by_user.get(uid, "")
        profile = payroll_profile(role, spec)
        card_salary = Decimal(str(user.base_salary)) if user.base_salary is not None else None
        facts = replace(facts_by_user.get(uid), kpi_bonus=bonus_by_id.get(uid, Decimal("0")))
        accrued = accrue(profile, facts, card_salary=card_salary)
        adj = adjustments.get(uid)
        salary = accrued.base_salary
        bonus = accrued.bonus
        paid = advances.get(uid, Decimal("0"))
        if adj is not None and adj.base_salary_manual is not None:
            salary = Decimal(str(adj.base_salary_manual))
        if adj is not None and adj.bonus_manual is not None:
            bonus = Decimal(str(adj.bonus_manual))
        if adj is not None and adj.advances_manual is not None:
            paid = Decimal(str(adj.advances_manual))
        adjustment = Decimal(str(adj.amount or 0)) if adj is not None else Decimal("0")
        reason = (adj.reason or "") if adj is not None else ""
        payroll_only = (user.email or "").endswith("@staff.internal")
        debt = carried_company_debt(debt_history.get(uid, []), year_month)
        if (
            not payroll_only
            and profile == "card"
            and salary is None
            and bonus == 0
            and paid == 0
            and adjustment == 0
            and debt == 0
        ):
            continue
        remainder = (salary or Decimal("0")) + bonus + adjustment + debt - paid
        out.append(
            FinancePayrollRow(
                user_id=uid,
                full_name=payroll_name_on(
                    name_history.get(uid, []),
                    month_end,
                    (user.full_name or "").strip(),
                ),
                expert_title=(spec or "").strip(),
                phone=user.phone,
                payout_bank=user.payout_bank,
                base_salary=salary,
                bonus=bonus,
                debt=debt,
                debt_label="Вписывается вручную. Минус — сотрудник должен компании. Авансы берутся из расходов ФОТ.",
                formula=accrued.formula,
                adjustment=adjustment,
                adjustment_reason=reason,
                advances=paid,
                remainder=remainder,
            )
        )
    out.sort(key=lambda row: row.full_name.casefold())
    return FinancePayrollReport(
        year_month=year_month,
        pipeline_name=pipeline_name,
        rows=out,
    )


@router.delete("/payroll/members/{user_id}", status_code=status.HTTP_204_NO_CONTENT)
async def remove_payroll_member(
    user_id: int,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentUser,
    company_id: CurrentCompanyId,
) -> None:
    """Убрать человека с ведомости. Логин сотрудника не закрывается."""
    _assert_expenses_access(current_user)
    await assert_finance_access(db, current_user)
    user = await db.get(User, user_id)
    if user is None or user.company_id != company_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Сотрудник не найден")
    exists = (
        await db.execute(
            select(PayrollSheetHide.id).where(
                PayrollSheetHide.company_id == company_id,
                PayrollSheetHide.user_id == user_id,
            )
        )
    ).scalar_one_or_none()
    if exists is None:
        db.add(PayrollSheetHide(company_id=company_id, user_id=user_id))
    if (user.email or "").endswith("@staff.internal"):
        user.is_active = False
    await db.flush()


@router.get("/payroll/hidden")
async def hidden_payroll_members(
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentUser,
    company_id: CurrentCompanyId,
) -> list[dict]:
    """Кого сняли с ведомости и ещё можно вернуть."""
    _assert_expenses_access(current_user)
    await assert_finance_access(db, current_user)
    rows = (
        await db.execute(
            select(User.id, User.full_name)
            .join(PayrollSheetHide, PayrollSheetHide.user_id == User.id)
            .where(
                PayrollSheetHide.company_id == company_id,
                User.company_id == company_id,
                User.is_active.is_(True),
            )
            .order_by(User.full_name.asc())
        )
    ).all()
    return [{"user_id": int(uid), "full_name": (name or "").strip()} for uid, name in rows]


@router.post("/payroll/members/{user_id}/restore", status_code=status.HTTP_204_NO_CONTENT)
async def restore_payroll_member(
    user_id: int,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentUser,
    company_id: CurrentCompanyId,
) -> None:
    """Вернуть человека на ведомость."""
    _assert_expenses_access(current_user)
    await assert_finance_access(db, current_user)
    row = (
        await db.execute(
            select(PayrollSheetHide).where(
                PayrollSheetHide.company_id == company_id,
                PayrollSheetHide.user_id == user_id,
            )
        )
    ).scalar_one_or_none()
    if row is not None:
        await db.delete(row)
    await db.flush()


@router.put("/payroll/adjustment", response_model=FinancePayrollRow)
async def save_payroll_adjustment(
    body: FinancePayrollAdjustmentWrite,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentUser,
    company_id: CurrentCompanyId,
    year: int = Query(..., ge=2020, le=2100),
    month: int = Query(..., ge=1, le=12),
) -> FinancePayrollRow:
    """Ручная правка начисления. Остальные колонки ведомости не пересчитывает в ответе целиком."""
    _assert_expenses_access(current_user)
    await assert_finance_access(db, current_user)
    user = await db.get(User, body.user_id)
    if user is None or user.company_id != company_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Сотрудник не найден")
    year_month = f"{year:04d}-{month:02d}"
    row = (
        await db.execute(
            select(PayrollAdjustment).where(
                PayrollAdjustment.company_id == company_id,
                PayrollAdjustment.user_id == body.user_id,
                PayrollAdjustment.year_month == year_month,
            )
        )
    ).scalar_one_or_none()
    sent = body.model_fields_set
    reason = (body.reason or "").strip() or None if body.reason is not None else None
    if row is None:
        row = PayrollAdjustment(
            company_id=company_id,
            user_id=body.user_id,
            year_month=year_month,
            amount=body.amount if body.amount is not None else Decimal("0"),
            reason=reason if "reason" in sent else None,
            company_debt=body.company_debt if "company_debt" in sent else None,
            base_salary_manual=body.base_salary if "base_salary" in sent else None,
            bonus_manual=body.bonus if "bonus" in sent else None,
            advances_manual=body.advances if "advances" in sent else None,
        )
        db.add(row)
    else:
        if "amount" in sent and body.amount is not None:
            row.amount = body.amount
        if "reason" in sent:
            row.reason = reason
        if "company_debt" in sent:
            row.company_debt = body.company_debt
        if "base_salary" in sent:
            row.base_salary_manual = body.base_salary
        if "bonus" in sent:
            row.bonus_manual = body.bonus
        if "advances" in sent:
            row.advances_manual = body.advances
        row.updated_at = datetime.now(UTC)
    await db.flush()
    salary = Decimal(str(user.base_salary)) if user.base_salary is not None else None
    saved_amount = Decimal(str(row.amount or 0))
    saved_debt = Decimal(str(row.company_debt or 0))
    return FinancePayrollRow(
        user_id=int(user.id),
        full_name=(user.full_name or "").strip(),
        phone=user.phone,
        payout_bank=user.payout_bank,
        base_salary=salary,
        debt=saved_debt,
        adjustment=saved_amount,
        adjustment_reason=row.reason or "",
        remainder=(salary or Decimal("0")) + saved_amount + saved_debt,
    )


@router.post("/expenses", response_model=FinanceOsvRowRead, status_code=status.HTTP_201_CREATED)
async def create_expense(
    body: FinanceExpenseCreate,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentUser,
    company_id: CurrentCompanyId,
) -> FinanceOsvRowRead:
    _assert_expenses_access(current_user)
    await assert_finance_access(db, current_user)
    if body.employee_user_id is not None:
        person = await db.get(User, body.employee_user_id)
        if person is None or person.company_id != company_id or not person.is_active:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Сотрудник не найден")
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
        employee_user_id=body.employee_user_id,
    )
    db.add(row)
    await db.flush()
    await db.refresh(row)
    return FinanceOsvRowRead.model_validate(row)
