"""Создание enrollment и этапов оплаты из шаблона услуги."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from decimal import Decimal

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Lead, PatientServiceEnrollment, PaymentInstallment, ServicePaymentRule, ServiceTemplate


def _quantize_money(v: Decimal) -> Decimal:
    return Decimal(v or 0).quantize(Decimal("0.01"))


def _installment_due_at(
    started_at: datetime,
    rule: ServicePaymentRule,
) -> datetime:
    base = started_at.astimezone(UTC) if started_at.tzinfo else started_at.replace(tzinfo=UTC)
    trigger = (rule.trigger_type or "on_enrollment").strip().lower()
    if trigger == "course_day" and rule.trigger_day is not None:
        return base + timedelta(days=max(0, int(rule.trigger_day) - 1))
    if trigger == "days_after_start" and rule.trigger_days_offset is not None:
        return base + timedelta(days=max(0, int(rule.trigger_days_offset)))
    return base


def _installment_amount(total: Decimal, rule: ServicePaymentRule, rules: list[ServicePaymentRule]) -> Decimal:
    kind = (rule.kind or "percent").strip().lower()
    if kind == "fixed":
        return _quantize_money(rule.value)
    pct = Decimal(rule.value or 0)
    return _quantize_money(total * pct / Decimal("100"))


async def create_enrollment_from_template(
    db: AsyncSession,
    *,
    company_id: int,
    lead_id: int,
    template_id: int,
) -> PatientServiceEnrollment:
    template = await db.get(ServiceTemplate, int(template_id))
    if template is None or template.company_id != company_id or not template.is_active:
        raise ValueError("Шаблон услуги не найден")
    lead = await db.get(Lead, int(lead_id))
    if lead is None or lead.company_id != company_id:
        raise ValueError("Лид не найден")
    await db.refresh(lead, ["stage"])
    pipeline_id = lead.stage.pipeline_id if lead.stage else template.pipeline_id
    if int(template.pipeline_id) != int(pipeline_id):
        raise ValueError("Услуга относится к другой воронке")

    rules = (
        await db.execute(
            select(ServicePaymentRule)
            .where(ServicePaymentRule.template_id == template.id)
            .order_by(ServicePaymentRule.sort_order.asc(), ServicePaymentRule.id.asc()),
        )
    ).scalars().all()
    if not rules:
        raise ValueError("В шаблоне нет этапов оплаты")

    started_at = datetime.now(UTC)
    total = _quantize_money(template.price_base)
    enrollment = PatientServiceEnrollment(
        company_id=company_id,
        lead_id=lead_id,
        template_id=template.id,
        pipeline_id=int(pipeline_id),
        direction_id=template.direction_id,
        started_at=started_at,
        status="active",
        total_price=total,
    )
    db.add(enrollment)
    await db.flush()

    amounts: list[Decimal] = []
    for rule in rules:
        amounts.append(_installment_amount(total, rule, rules))
    drift = total - sum(amounts)
    if amounts and drift != 0:
        amounts[-1] = _quantize_money(amounts[-1] + drift)

    for idx, rule in enumerate(rules):
        inst = PaymentInstallment(
            enrollment_id=enrollment.id,
            sort_order=int(rule.sort_order or idx + 1),
            label=(rule.label or f"Этап {idx + 1}").strip(),
            amount=amounts[idx],
            due_date=_installment_due_at(started_at, rule),
            status="pending",
        )
        db.add(inst)
    await db.flush()
    return enrollment


async def refresh_overdue_installments(db: AsyncSession, company_id: int) -> int:
    now = datetime.now(UTC)
    rows = (
        await db.execute(
            select(PaymentInstallment)
            .join(PatientServiceEnrollment, PatientServiceEnrollment.id == PaymentInstallment.enrollment_id)
            .where(
                PatientServiceEnrollment.company_id == company_id,
                PaymentInstallment.status == "pending",
                PaymentInstallment.due_date < now,
            ),
        )
    ).scalars().all()
    n = 0
    for row in rows:
        row.status = "overdue"
        n += 1
    if n:
        await db.flush()
    return n
