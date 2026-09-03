"""Доп. услуги: типы с % нашему/отдаём + журнал продаж."""

from __future__ import annotations

from datetime import UTC, datetime
from decimal import Decimal

from sqlalchemy import Boolean, DateTime, ForeignKey, Numeric, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column

from app.models._legacy import Base


def _utc_now() -> datetime:
    return datetime.now(UTC)


class ExtraServiceType(Base):
    """Настройка доп. услуги: название и доли % (нам / отдаём)."""

    __tablename__ = "extra_service_types"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    company_id: Mapped[int] = mapped_column(ForeignKey("companies.id", ondelete="CASCADE"), index=True)
    name: Mapped[str] = mapped_column(String(255))
    keep_percent: Mapped[Decimal] = mapped_column(Numeric(7, 2), default=Decimal("0"))
    payout_percent: Mapped[Decimal] = mapped_column(Numeric(7, 2), default=Decimal("0"))
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    sort_order: Mapped[int] = mapped_column(default=0)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=_utc_now,
        insert_default=_utc_now,
        server_default=func.now(),
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=_utc_now,
        insert_default=_utc_now,
        server_default=func.now(),
    )


class ExtraServiceSale(Base):
    """Журнал: кто когда какую доп. услугу оплатил; сколько нам / сколько отдали."""

    __tablename__ = "extra_service_sales"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    company_id: Mapped[int] = mapped_column(ForeignKey("companies.id", ondelete="CASCADE"), index=True)
    service_type_id: Mapped[int] = mapped_column(
        ForeignKey("extra_service_types.id", ondelete="RESTRICT"),
        index=True,
    )
    client_name: Mapped[str] = mapped_column(String(255))
    client_phone: Mapped[str] = mapped_column(String(64), default="")
    amount: Mapped[Decimal] = mapped_column(Numeric(14, 2), default=Decimal("0"))
    keep_percent: Mapped[Decimal] = mapped_column(Numeric(7, 2), default=Decimal("0"))
    payout_percent: Mapped[Decimal] = mapped_column(Numeric(7, 2), default=Decimal("0"))
    keep_amount: Mapped[Decimal] = mapped_column(Numeric(14, 2), default=Decimal("0"))
    payout_amount: Mapped[Decimal] = mapped_column(Numeric(14, 2), default=Decimal("0"))
    sold_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=_utc_now,
        insert_default=_utc_now,
        index=True,
    )
    note: Mapped[str | None] = mapped_column(Text, nullable=True)
    # active | cancelled
    status: Mapped[str] = mapped_column(String(24), default="active", index=True)
    created_by_user_id: Mapped[int | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=_utc_now,
        insert_default=_utc_now,
        server_default=func.now(),
    )
