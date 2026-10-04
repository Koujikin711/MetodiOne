"""Ручная правка строки ведомости за месяц."""

from __future__ import annotations

from datetime import date, datetime
from decimal import Decimal

from sqlalchemy import Date, DateTime, ForeignKey, Numeric, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.models._legacy import Base, _utc_now


class PayrollAdjustment(Base):
    __tablename__ = "payroll_adjustments"
    __table_args__ = (
        UniqueConstraint("company_id", "user_id", "year_month", name="uq_payroll_adjustment_month"),
    )

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    company_id: Mapped[int] = mapped_column(ForeignKey("companies.id", ondelete="CASCADE"), index=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    year_month: Mapped[str] = mapped_column(String(7), index=True)
    amount: Mapped[Decimal] = mapped_column(Numeric(14, 2), default=Decimal("0"))
    reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utc_now)


class PayrollSheetHide(Base):
    """Сотрудник снят с ведомости. Вход в систему при этом не закрывается."""

    __tablename__ = "payroll_sheet_hides"
    __table_args__ = (
        UniqueConstraint("company_id", "user_id", name="uq_payroll_sheet_hide"),
    )

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    company_id: Mapped[int] = mapped_column(ForeignKey("companies.id", ondelete="CASCADE"), index=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)


class EmployeeNameTerm(Base):
    """С какой даты на этой карточке эксперта стоит данное ФИО.

    Формула привязана к эксперту. Смена фамилии не сбрасывает правило:
    прошлые месяцы остаются на старом ФИО, следующие считаются новому.
    """

    __tablename__ = "employee_name_terms"
    __table_args__ = (
        UniqueConstraint("company_id", "user_id", "effective_on", name="uq_employee_name_term"),
    )

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    company_id: Mapped[int] = mapped_column(ForeignKey("companies.id", ondelete="CASCADE"), index=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    full_name: Mapped[str] = mapped_column(String(255))
    effective_on: Mapped[date] = mapped_column(Date, index=True)
