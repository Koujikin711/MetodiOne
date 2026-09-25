"""Purchase / Payment ledger для Paid LTV (Phase 1).

Не заменяет booking/KPI таблицы — проекция с идемпотентным sync.
"""

from __future__ import annotations

from datetime import UTC, datetime
from decimal import Decimal

from sqlalchemy import DateTime, ForeignKey, Numeric, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.models._legacy import Base


def _utc_now() -> datetime:
    return datetime.now(UTC)


class PatientPurchase(Base):
    """Коммерческая покупка (Sales Value). Не равна платежу и не равна доставке визита."""

    __tablename__ = "patient_purchases"
    __table_args__ = (
        UniqueConstraint("company_id", "source_type", "source_id", name="uq_patient_purchase_source"),
    )

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    company_id: Mapped[int] = mapped_column(ForeignKey("companies.id", ondelete="CASCADE"), index=True)
    # NULL = unresolved identity (без опасного phone-merge)
    lead_id: Mapped[int | None] = mapped_column(ForeignKey("leads.id", ondelete="SET NULL"), nullable=True, index=True)
    pipeline_id: Mapped[int | None] = mapped_column(ForeignKey("pipelines.id", ondelete="SET NULL"), nullable=True, index=True)

    # booking_appointment | kpi_manual_sale | desk_sale | extra_service_sale
    source_type: Mapped[str] = mapped_column(String(40), index=True)
    source_id: Mapped[int] = mapped_column(index=True)

    # visit | course_15 | main_course | protocol | other_service | desk | extra
    product_kind: Mapped[str] = mapped_column(String(40), default="other_service", index=True)
    product_name: Mapped[str] = mapped_column(String(255), default="")

    # Sales Value (стоимость обязательства)
    service_amount: Mapped[Decimal] = mapped_column(Numeric(14, 2), default=Decimal("0"))
    # Кэш суммы платежей (пересчитывается sync)
    paid_amount: Mapped[Decimal] = mapped_column(Numeric(14, 2), default=Decimal("0"))
    # active | returned | cancelled | completed
    status: Mapped[str] = mapped_column(String(24), default="active", index=True)

    purchased_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utc_now, index=True)
    client_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    client_phone: Mapped[str | None] = mapped_column(String(64), nullable=True)
    note: Mapped[str | None] = mapped_column(Text, nullable=True)

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utc_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utc_now)


class PatientPurchasePayment(Base):
    """Платёж или возврат по покупке (Paid LTV = sum(amount) с учётом знака)."""

    __tablename__ = "patient_purchase_payments"
    __table_args__ = (
        UniqueConstraint(
            "company_id",
            "source_type",
            "source_id",
            name="uq_patient_purchase_payment_source",
        ),
    )

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    company_id: Mapped[int] = mapped_column(ForeignKey("companies.id", ondelete="CASCADE"), index=True)
    purchase_id: Mapped[int] = mapped_column(ForeignKey("patient_purchases.id", ondelete="CASCADE"), index=True)

    # booking_payment | booking_refund | kpi_payment | kpi_return | desk_payment | extra_payment
    source_type: Mapped[str] = mapped_column(String(40), index=True)
    source_id: Mapped[int] = mapped_column(index=True)

    # >0 оплата, <0 возврат
    amount: Mapped[Decimal] = mapped_column(Numeric(14, 2), default=Decimal("0"))
    is_refund: Mapped[bool] = mapped_column(default=False)
    paid_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utc_now, index=True)
    note: Mapped[str | None] = mapped_column(Text, nullable=True)

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utc_now)
