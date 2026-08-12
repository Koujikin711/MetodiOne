"""Режимы CRM-пространств: clinic (онлайн-запись) и sales (окно продаж)."""

from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Company

CRM_MODE_CLINIC = "clinic"
CRM_MODE_SALES = "sales"

SALES_COMPANY_NAME = "MetodiOne Продажи"
SALES_OWNER_EMAIL = "admin@sales.local"
SALES_OWNER_PASSWORD = "D711711"
CLINIC_OWNER_EMAIL = "admin@crm.local"


async def get_company_crm_mode(db: AsyncSession, company_id: int) -> str:
    row = (
        await db.execute(select(Company.crm_mode).where(Company.id == company_id).limit(1))
    ).scalar_one_or_none()
    mode = (row or CRM_MODE_CLINIC) or CRM_MODE_CLINIC
    return CRM_MODE_SALES if str(mode).strip().lower() == CRM_MODE_SALES else CRM_MODE_CLINIC


async def company_is_sales_mode(db: AsyncSession, company_id: int) -> bool:
    return await get_company_crm_mode(db, company_id) == CRM_MODE_SALES


async def get_company_by_id(db: AsyncSession, company_id: int) -> Company | None:
    return await db.get(Company, company_id)
