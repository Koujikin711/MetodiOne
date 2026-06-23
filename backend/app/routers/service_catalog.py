from datetime import UTC, datetime, timedelta
from decimal import Decimal
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.deps import CurrentCompanyId, CurrentUser
from app.database import get_db
from app.models import (
    BookingAppointment,
    BookingDirection,
    Lead,
    PatientServiceEnrollment,
    PaymentInstallment,
    ServicePaymentRule,
    ServiceTemplate,
    UserRole,
)
from app.schemas.service_catalog import (
    EnrollmentCreate,
    EnrollmentRead,
    InstallmentRead,
    MigrateLegacyResultRead,
    ReceivableItemRead,
    ReceivablesSummaryRead,
    ServiceTemplateCreate,
    ServiceTemplateRead,
    ServiceTemplateUpdate,
    PaymentRuleRead,
)
from app.services.service_enrollment import create_enrollment_from_template, refresh_overdue_installments

from app.services.chief_expert_access import assert_service_catalog_write, can_write_service_catalog

router = APIRouter(prefix="/services", tags=["services"])


def _catalog_write_roles() -> frozenset[UserRole]:
    return frozenset({UserRole.owner, UserRole.admin, UserRole.super_owner})


async def _template_to_read(db: AsyncSession, t: ServiceTemplate) -> ServiceTemplateRead:
    rules = (
        await db.execute(
            select(ServicePaymentRule)
            .where(ServicePaymentRule.template_id == t.id)
            .order_by(ServicePaymentRule.sort_order.asc(), ServicePaymentRule.id.asc()),
        )
    ).scalars().all()
    return ServiceTemplateRead(
        id=t.id,
        pipeline_id=t.pipeline_id,
        direction_id=t.direction_id,
        name=t.name,
        service_type=t.service_type,
        duration_days=t.duration_days,
        visit_count=t.visit_count,
        price_base=Decimal(t.price_base or 0),
        specialist_ids=[int(x) for x in (t.specialist_ids or [])],
        course_streams_enabled=bool(t.course_streams_enabled),
        course_stream_max_days=int(t.course_stream_max_days or 15),
        course_stream_min_day_for_next=int(t.course_stream_min_day_for_next or 10),
        course_stream_gap_days=int(t.course_stream_gap_days or 10),
        is_active=bool(t.is_active),
        is_legacy=bool(t.is_legacy),
        payment_rules=[PaymentRuleRead.model_validate(r) for r in rules],
        created_at=t.created_at,
    )


@router.get("/templates", response_model=list[ServiceTemplateRead])
async def list_service_templates(
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentUser,
    company_id: CurrentCompanyId,
    pipeline_id: int = Query(..., ge=1),
    active_only: bool = Query(True),
) -> list[ServiceTemplateRead]:
    if not await can_write_service_catalog(db, current_user):
        if current_user.role not in (UserRole.manager, UserRole.expert):
            raise HTTPException(status_code=403, detail="Нет доступа")
    q = select(ServiceTemplate).where(
        ServiceTemplate.company_id == company_id,
        ServiceTemplate.pipeline_id == pipeline_id,
        ServiceTemplate.is_legacy.is_(False),
    )
    if active_only:
        q = q.where(ServiceTemplate.is_active.is_(True))
    q = q.order_by(ServiceTemplate.name.asc(), ServiceTemplate.id.asc())
    rows = (await db.execute(q)).scalars().all()
    return [await _template_to_read(db, t) for t in rows]


@router.post("/templates", response_model=ServiceTemplateRead, status_code=status.HTTP_201_CREATED)
async def create_service_template(
    body: ServiceTemplateCreate,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentUser,
    company_id: CurrentCompanyId,
) -> ServiceTemplateRead:
    await assert_service_catalog_write(db, current_user)
    pct_sum = sum(
        (r.value for r in body.payment_rules if (r.kind or "percent") == "percent"),
        Decimal("0"),
    )
    if pct_sum > Decimal("100.01"):
        raise HTTPException(status_code=400, detail="Сумма процентов этапов не может превышать 100%")
    t = ServiceTemplate(
        company_id=company_id,
        pipeline_id=body.pipeline_id,
        direction_id=body.direction_id,
        name=body.name.strip(),
        service_type=body.service_type,
        duration_days=body.duration_days,
        visit_count=body.visit_count,
        price_base=body.price_base,
        specialist_ids=body.specialist_ids,
        course_streams_enabled=body.course_streams_enabled,
        course_stream_max_days=body.course_stream_max_days,
        course_stream_min_day_for_next=body.course_stream_min_day_for_next,
        course_stream_gap_days=body.course_stream_gap_days,
        is_active=True,
        is_legacy=False,
    )
    db.add(t)
    await db.flush()
    for rule in body.payment_rules:
        db.add(
            ServicePaymentRule(
                template_id=t.id,
                sort_order=rule.sort_order,
                label=rule.label,
                kind=rule.kind,
                value=rule.value,
                trigger_type=rule.trigger_type,
                trigger_day=rule.trigger_day,
                trigger_days_offset=rule.trigger_days_offset,
            ),
        )
    await db.commit()
    await db.refresh(t)
    return await _template_to_read(db, t)


@router.patch("/templates/{template_id}", response_model=ServiceTemplateRead)
async def update_service_template(
    template_id: int,
    body: ServiceTemplateUpdate,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentUser,
    company_id: CurrentCompanyId,
) -> ServiceTemplateRead:
    await assert_service_catalog_write(db, current_user)
    t = await db.get(ServiceTemplate, template_id)
    if t is None or t.company_id != company_id:
        raise HTTPException(status_code=404, detail="Шаблон не найден")
    if body.name is not None:
        t.name = body.name.strip()
    if body.is_active is not None:
        t.is_active = body.is_active
    if body.price_base is not None:
        t.price_base = body.price_base
    if body.specialist_ids is not None:
        t.specialist_ids = body.specialist_ids
    if body.payment_rules is not None:
        if not body.payment_rules:
            raise HTTPException(status_code=400, detail="Нужен хотя бы один этап оплаты")
        old = (
            await db.execute(select(ServicePaymentRule).where(ServicePaymentRule.template_id == t.id))
        ).scalars().all()
        for row in old:
            await db.delete(row)
        for rule in body.payment_rules:
            db.add(
                ServicePaymentRule(
                    template_id=t.id,
                    sort_order=rule.sort_order,
                    label=rule.label,
                    kind=rule.kind,
                    value=rule.value,
                    trigger_type=rule.trigger_type,
                    trigger_day=rule.trigger_day,
                    trigger_days_offset=rule.trigger_days_offset,
                ),
            )
    await db.commit()
    await db.refresh(t)
    return await _template_to_read(db, t)


@router.post("/leads/{lead_id}/enrollments", response_model=EnrollmentRead, status_code=status.HTTP_201_CREATED)
async def enroll_lead_service(
    lead_id: int,
    body: EnrollmentCreate,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentUser,
    company_id: CurrentCompanyId,
) -> EnrollmentRead:
    if current_user.role not in (
        UserRole.owner,
        UserRole.admin,
        UserRole.manager,
        UserRole.expert,
        UserRole.super_owner,
    ):
        raise HTTPException(status_code=403, detail="Нет доступа")
    try:
        enrollment = await create_enrollment_from_template(
            db,
            company_id=company_id,
            lead_id=lead_id,
            template_id=body.template_id,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    await db.commit()
    return await _enrollment_to_read(db, enrollment.id)


@router.get("/leads/{lead_id}/enrollments", response_model=list[EnrollmentRead])
async def list_lead_enrollments(
    lead_id: int,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentUser,
    company_id: CurrentCompanyId,
) -> list[EnrollmentRead]:
    rows = (
        await db.execute(
            select(PatientServiceEnrollment.id)
            .where(
                PatientServiceEnrollment.company_id == company_id,
                PatientServiceEnrollment.lead_id == lead_id,
            )
            .order_by(PatientServiceEnrollment.started_at.desc()),
        )
    ).all()
    return [await _enrollment_to_read(db, int(r[0])) for r in rows]


async def _enrollment_to_read(db: AsyncSession, enrollment_id: int) -> EnrollmentRead:
    enrollment = await db.get(PatientServiceEnrollment, enrollment_id)
    if enrollment is None:
        raise HTTPException(status_code=404, detail="Enrollment не найден")
    template = await db.get(ServiceTemplate, enrollment.template_id)
    inst = (
        await db.execute(
            select(PaymentInstallment)
            .where(PaymentInstallment.enrollment_id == enrollment.id)
            .order_by(PaymentInstallment.sort_order.asc()),
        )
    ).scalars().all()
    return EnrollmentRead(
        id=enrollment.id,
        lead_id=enrollment.lead_id,
        template_id=enrollment.template_id,
        pipeline_id=enrollment.pipeline_id,
        direction_id=enrollment.direction_id,
        template_name=template.name if template else None,
        status=enrollment.status,
        total_price=Decimal(enrollment.total_price or 0),
        started_at=enrollment.started_at,
        installments=[InstallmentRead.model_validate(i) for i in inst],
    )


@router.post("/installments/{installment_id}/pay", response_model=InstallmentRead)
async def mark_installment_paid(
    installment_id: int,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentUser,
    company_id: CurrentCompanyId,
) -> InstallmentRead:
    await assert_service_catalog_write(db, current_user)
    inst = await db.get(PaymentInstallment, installment_id)
    if inst is None:
        raise HTTPException(status_code=404, detail="Этап не найден")
    enrollment = await db.get(PatientServiceEnrollment, inst.enrollment_id)
    if enrollment is None or enrollment.company_id != company_id:
        raise HTTPException(status_code=404, detail="Этап не найден")
    if inst.status == "paid":
        return InstallmentRead.model_validate(inst)
    inst.status = "paid"
    inst.paid_at = datetime.now(UTC)
    await db.commit()
    await db.refresh(inst)
    return InstallmentRead.model_validate(inst)


@router.get("/receivables", response_model=ReceivablesSummaryRead)
async def list_receivables(
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentUser,
    company_id: CurrentCompanyId,
    pipeline_id: int | None = Query(None, ge=1),
) -> ReceivablesSummaryRead:
    await assert_service_catalog_write(db, current_user)
    await refresh_overdue_installments(db, company_id)
    now = datetime.now(UTC)
    month_start = datetime(now.year, now.month, 1, tzinfo=UTC)
    q = (
        select(
            PaymentInstallment,
            PatientServiceEnrollment,
            Lead.name,
            ServiceTemplate.name,
        )
        .join(PatientServiceEnrollment, PatientServiceEnrollment.id == PaymentInstallment.enrollment_id)
        .join(Lead, Lead.id == PatientServiceEnrollment.lead_id)
        .join(ServiceTemplate, ServiceTemplate.id == PatientServiceEnrollment.template_id)
        .where(PatientServiceEnrollment.company_id == company_id)
    )
    if pipeline_id is not None:
        q = q.where(PatientServiceEnrollment.pipeline_id == pipeline_id)
    rows = (await db.execute(q.order_by(PaymentInstallment.due_date.asc()))).all()

    items: list[ReceivableItemRead] = []
    pending_n = overdue_n = 0
    overdue_amt = Decimal("0")
    paid_month = (
        await db.scalar(
            select(func.coalesce(func.sum(PaymentInstallment.amount), 0))
            .join(PatientServiceEnrollment, PatientServiceEnrollment.id == PaymentInstallment.enrollment_id)
            .where(
                PatientServiceEnrollment.company_id == company_id,
                PaymentInstallment.status == "paid",
                PaymentInstallment.paid_at >= month_start,
            ),
        )
    ) or Decimal("0")

    for inst, enr, lead_name, tmpl_name in rows:
        if inst.status not in ("pending", "overdue"):
            continue
        if inst.status == "pending":
            pending_n += 1
        else:
            overdue_n += 1
            overdue_amt += Decimal(inst.amount or 0)
        due = inst.due_date
        if due.tzinfo is None:
            due = due.replace(tzinfo=UTC)
        days_od = max(0, (now.date() - due.date()).days) if inst.status == "overdue" else 0
        items.append(
            ReceivableItemRead(
                installment_id=inst.id,
                enrollment_id=enr.id,
                lead_id=enr.lead_id,
                lead_name=str(lead_name or ""),
                pipeline_id=enr.pipeline_id,
                template_name=str(tmpl_name or ""),
                label=inst.label,
                amount=Decimal(inst.amount or 0),
                due_date=inst.due_date,
                status=inst.status,
                days_overdue=days_od,
            ),
        )

    return ReceivablesSummaryRead(
        pending_count=pending_n,
        overdue_count=overdue_n,
        paid_month_amount=Decimal(paid_month),
        overdue_amount=overdue_amt.quantize(Decimal("0.01")),
        items=items,
    )


@router.post("/migrate-legacy-templates", response_model=MigrateLegacyResultRead)
async def migrate_legacy_service_templates(
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentUser,
    company_id: CurrentCompanyId,
) -> MigrateLegacyResultRead:
    await assert_service_catalog_write(db, current_user)
    rows = (
        await db.execute(
            select(
                BookingAppointment.service_title,
                BookingAppointment.direction_id,
                BookingAppointment.pipeline_id,
                BookingDirection.pipeline_id,
                func.avg(BookingAppointment.service_amount),
            )
            .join(BookingDirection, BookingDirection.id == BookingAppointment.direction_id)
            .where(
                BookingAppointment.company_id == company_id,
                BookingAppointment.service_title.isnot(None),
                func.length(func.trim(BookingAppointment.service_title)) > 0,
            )
            .group_by(
                BookingAppointment.service_title,
                BookingAppointment.direction_id,
                BookingAppointment.pipeline_id,
                BookingDirection.pipeline_id,
            ),
        )
    ).all()

    created = 0
    skipped = 0
    for title, direction_id, appt_pipeline_id, dir_pipeline_id, avg_price in rows:
        name = (str(title or "")).strip()
        if not name:
            skipped += 1
            continue
        pipeline_id = int(appt_pipeline_id or dir_pipeline_id or 0)
        if pipeline_id <= 0:
            skipped += 1
            continue
        exists = (
            await db.execute(
                select(ServiceTemplate.id).where(
                    ServiceTemplate.company_id == company_id,
                    ServiceTemplate.pipeline_id == pipeline_id,
                    ServiceTemplate.direction_id == int(direction_id),
                    ServiceTemplate.name == name,
                ).limit(1),
            )
        ).scalar_one_or_none()
        if exists is not None:
            skipped += 1
            continue
        price = Decimal(avg_price or 0).quantize(Decimal("0.01"))
        t = ServiceTemplate(
            company_id=company_id,
            pipeline_id=pipeline_id,
            direction_id=int(direction_id),
            name=name,
            service_type="single",
            price_base=price,
            specialist_ids=[],
            is_active=True,
            is_legacy=True,
        )
        db.add(t)
        await db.flush()
        db.add(
            ServicePaymentRule(
                template_id=t.id,
                sort_order=1,
                label="Полная оплата",
                kind="percent",
                value=Decimal("100"),
                trigger_type="on_enrollment",
            ),
        )
        created += 1
    await db.commit()
    return MigrateLegacyResultRead(created=created, skipped=skipped)
