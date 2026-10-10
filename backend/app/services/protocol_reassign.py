"""Протоколы уволенного менеджера переходят действующим менеджерам той же компании."""

from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import (
    BookingAppointment,
    BookingDirection,
    Lead,
    PatientPurchase,
    SalesKpiManualSale,
    SalesKpiPlanItem,
    User,
    UserRole,
)
from app.services.patient_ltv import classify_product_kind


def assign_round_robin(item_ids: list[int], target_ids: list[int]) -> dict[int, int]:
    """Равномерно: первый id — первому менеджеру, дальше по кругу."""
    if not item_ids or not target_ids:
        return {}
    ordered_items = sorted(set(item_ids))
    ordered_targets = list(target_ids)
    n = len(ordered_targets)
    return {item_id: ordered_targets[i % n] for i, item_id in enumerate(ordered_items)}


async def reassign_protocols_from_inactive_managers(db: AsyncSession) -> int:
    """Lead.manager_id и продажа протокола без карточки. Курсы и записи не трогает."""
    users = (
        await db.execute(
            select(User.id, User.company_id, User.role, User.is_active).where(User.role == UserRole.manager)
        )
    ).all()
    inactive_by_company: dict[int, set[int]] = {}
    active_by_company: dict[int, list[int]] = {}
    for uid, company_id, _role, is_active in users:
        if company_id is None:
            continue
        cid = int(company_id)
        if is_active:
            active_by_company.setdefault(cid, []).append(int(uid))
        else:
            inactive_by_company.setdefault(cid, set()).add(int(uid))
    for cid in active_by_company:
        active_by_company[cid].sort()
    if not inactive_by_company:
        return 0

    inactive_ids = {uid for ids in inactive_by_company.values() for uid in ids}
    protocol_lead_ids: set[int] = set()

    purchase_leads = (
        await db.execute(
            select(PatientPurchase.lead_id).where(
                PatientPurchase.lead_id.is_not(None),
                PatientPurchase.product_kind == "protocol",
                PatientPurchase.status.notin_(("cancelled",)),
            )
        )
    ).scalars().all()
    protocol_lead_ids.update(int(lid) for lid in purchase_leads if lid is not None)

    sale_rows = (
        await db.execute(
            select(SalesKpiManualSale, SalesKpiPlanItem.name)
            .join(SalesKpiPlanItem, SalesKpiPlanItem.id == SalesKpiManualSale.plan_item_id)
            .where(SalesKpiManualSale.status.notin_(("returned", "refused", "cancelled")))
        )
    ).all()
    unlinked_protocol_sales: list[SalesKpiManualSale] = []
    for sale, item_name in sale_rows:
        if classify_product_kind(item_name) != "protocol":
            continue
        if sale.lead_id is not None:
            protocol_lead_ids.add(int(sale.lead_id))
            continue
        if sale.manager_user_id is not None and int(sale.manager_user_id) in inactive_ids:
            unlinked_protocol_sales.append(sale)

    booking_rows = (
        await db.execute(
            select(BookingAppointment.lead_id, BookingAppointment.service_title, BookingDirection.name)
            .join(BookingDirection, BookingDirection.id == BookingAppointment.direction_id)
            .where(
                BookingAppointment.lead_id.is_not(None),
                BookingAppointment.status.notin_(("cancelled",)),
            )
        )
    ).all()
    for lead_id, service_title, direction_name in booking_rows:
        title = str(service_title or direction_name or "")
        if classify_product_kind(title) != "protocol" and classify_product_kind(direction_name) != "protocol":
            continue
        if lead_id is not None:
            protocol_lead_ids.add(int(lead_id))

    moved = 0
    if protocol_lead_ids:
        leads = (
            await db.execute(select(Lead).where(Lead.id.in_(protocol_lead_ids), Lead.manager_id.in_(inactive_ids)))
        ).scalars().all()
        by_company: dict[int, list[Lead]] = {}
        for lead in leads:
            if lead.company_id is None or lead.manager_id is None:
                continue
            by_company.setdefault(int(lead.company_id), []).append(lead)
        for cid, company_leads in by_company.items():
            targets = active_by_company.get(cid) or []
            plan = assign_round_robin([int(lead.id) for lead in company_leads], targets)
            by_id = {int(lead.id): lead for lead in company_leads}
            for lead_id, new_mid in plan.items():
                lead = by_id[lead_id]
                if int(lead.manager_id or 0) == new_mid:
                    continue
                lead.manager_id = new_mid
                moved += 1

    sales_by_company: dict[int, list[SalesKpiManualSale]] = {}
    for sale in unlinked_protocol_sales:
        if sale.company_id is None:
            continue
        sales_by_company.setdefault(int(sale.company_id), []).append(sale)
    for cid, sales in sales_by_company.items():
        targets = active_by_company.get(cid) or []
        plan = assign_round_robin([int(sale.id) for sale in sales], targets)
        by_id = {int(sale.id): sale for sale in sales}
        for sale_id, new_mid in plan.items():
            sale = by_id[sale_id]
            if int(sale.manager_user_id or 0) == new_mid:
                continue
            sale.manager_user_id = new_mid
            moved += 1

    if moved:
        await db.flush()
    return moved
