"""Журнал куратора / табель потока: успеваемость (дневник, фото, жалобы)."""

from __future__ import annotations

from datetime import UTC, date, datetime
from decimal import Decimal

from sqlalchemy import (
    Date,
    DateTime,
    ForeignKey,
    Integer,
    Numeric,
    String,
    Text,
    UniqueConstraint,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.models._legacy import Base


def _utc_now() -> datetime:
    return datetime.now(UTC)


class CuratorCourseFlow(Base):
    """Независимый поток журнала куратора (не KPI group_no и не visit 1:10)."""

    __tablename__ = "curator_course_flows"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    company_id: Mapped[int] = mapped_column(ForeignKey("companies.id", ondelete="CASCADE"), index=True)
    pipeline_id: Mapped[int | None] = mapped_column(
        ForeignKey("pipelines.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    course_name: Mapped[str] = mapped_column(String(255), default="Основной курс")
    flow_number: Mapped[int] = mapped_column(Integer, default=1)
    title: Mapped[str | None] = mapped_column(String(255), nullable=True)
    starts_on: Mapped[date] = mapped_column(Date)
    ends_on: Mapped[date] = mapped_column(Date)
    curator_user_id: Mapped[int | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    # optional link for KPI import convenience (not identity)
    kpi_group_no: Mapped[int | None] = mapped_column(Integer, nullable=True)
    status: Mapped[str] = mapped_column(String(24), default="active")  # active|archived
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
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=_utc_now,
        insert_default=_utc_now,
        server_default=func.now(),
    )


class CuratorFlowMembership(Base):
    """Участник потока. При переводе: left_on + новая запись в другом потоке."""

    __tablename__ = "curator_flow_memberships"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    company_id: Mapped[int] = mapped_column(ForeignKey("companies.id", ondelete="CASCADE"), index=True)
    flow_id: Mapped[int] = mapped_column(
        ForeignKey("curator_course_flows.id", ondelete="CASCADE"),
        index=True,
    )
    lead_id: Mapped[int | None] = mapped_column(
        ForeignKey("leads.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    display_name: Mapped[str] = mapped_column(String(255))
    phone: Mapped[str | None] = mapped_column(String(64), nullable=True)
    joined_on: Mapped[date] = mapped_column(Date)
    left_on: Mapped[date | None] = mapped_column(Date, nullable=True)
    source: Mapped[str] = mapped_column(String(32), default="manual")  # manual|kpi|lead
    kpi_sale_id: Mapped[int | None] = mapped_column(
        ForeignKey("sales_kpi_manual_sales.id", ondelete="SET NULL"),
        nullable=True,
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=_utc_now,
        insert_default=_utc_now,
        server_default=func.now(),
    )


class CuratorJournalEntry(Base):
    """Одна запись: участник + дата. Пустые дни не создаём заранее."""

    __tablename__ = "curator_journal_entries"
    __table_args__ = (
        UniqueConstraint("flow_id", "membership_id", "entry_date", name="uq_curator_journal_entry"),
    )

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    company_id: Mapped[int] = mapped_column(ForeignKey("companies.id", ondelete="CASCADE"), index=True)
    flow_id: Mapped[int] = mapped_column(
        ForeignKey("curator_course_flows.id", ondelete="CASCADE"),
        index=True,
    )
    membership_id: Mapped[int] = mapped_column(
        ForeignKey("curator_flow_memberships.id", ondelete="CASCADE"),
        index=True,
    )
    entry_date: Mapped[date] = mapped_column(Date, index=True)
    # pending | done | missed
    diary_status: Mapped[str] = mapped_column(String(16), default="pending")
    # pending | done | missed
    photo_status: Mapped[str] = mapped_column(String(16), default="pending")
    # pending | no_complaint | complaint
    complaint_status: Mapped[str] = mapped_column(String(16), default="pending")
    complaint_general_comment: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_by_user_id: Mapped[int | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
    )
    updated_by_user_id: Mapped[int | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
    )
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


class CuratorJournalComplaint(Base):
    """Структурированная жалоба по категории (не одной строкой)."""

    __tablename__ = "curator_journal_complaints"
    __table_args__ = (
        UniqueConstraint("journal_entry_id", "category", name="uq_curator_journal_complaint_cat"),
    )

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    journal_entry_id: Mapped[int] = mapped_column(
        ForeignKey("curator_journal_entries.id", ondelete="CASCADE"),
        index=True,
    )
    category: Mapped[str] = mapped_column(String(32))
    comment: Mapped[str | None] = mapped_column(Text, nullable=True)
    numeric_value: Mapped[Decimal | None] = mapped_column(Numeric(8, 2), nullable=True)
    unit: Mapped[str | None] = mapped_column(String(16), nullable=True)
    count_value: Mapped[int | None] = mapped_column(Integer, nullable=True)
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
