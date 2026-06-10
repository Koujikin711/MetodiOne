"""ОСВ — операционная таблица движений (источник для ДДС и ОПиУ)."""

from __future__ import annotations

from datetime import date, datetime
from decimal import Decimal

from sqlalchemy import Date, DateTime, ForeignKey, Numeric, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.models._legacy import Base, _utc_now


class FinanceOsvRow(Base):
    __tablename__ = "finance_osv_rows"
    __table_args__ = (
        UniqueConstraint("company_id", "external_key", name="uq_finance_osv_company_external"),
    )

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    company_id: Mapped[int] = mapped_column(ForeignKey("companies.id", ondelete="CASCADE"), index=True)
    txn_date: Mapped[date] = mapped_column(Date, index=True)
    partner_amount: Mapped[Decimal | None] = mapped_column(Numeric(14, 2), nullable=True)
    service_period: Mapped[str | None] = mapped_column(String(64), nullable=True)
    revenue: Mapped[Decimal] = mapped_column(Numeric(14, 2), default=Decimal("0"))
    expense: Mapped[Decimal] = mapped_column(Numeric(14, 2), default=Decimal("0"))
    bank: Mapped[str | None] = mapped_column(String(64), nullable=True)
    basis: Mapped[str | None] = mapped_column(String(255), nullable=True)
    counterparty: Mapped[str | None] = mapped_column(String(255), nullable=True)
    phone: Mapped[str | None] = mapped_column(String(64), nullable=True)
    via_person: Mapped[str | None] = mapped_column(String(128), nullable=True)
    product_service: Mapped[str | None] = mapped_column(String(255), nullable=True)
    article: Mapped[str | None] = mapped_column(String(128), nullable=True)
    detail_category: Mapped[str | None] = mapped_column(String(128), nullable=True)
    brief_category: Mapped[str | None] = mapped_column(String(64), nullable=True)
    source: Mapped[str] = mapped_column(String(24), default="manual")
    external_key: Mapped[str | None] = mapped_column(String(255), nullable=True, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utc_now, insert_default=_utc_now)
