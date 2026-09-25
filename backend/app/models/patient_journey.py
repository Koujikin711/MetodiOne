"""Universal Patient Journey: Lead → valid purchases → Lifetime LTV (Phase 2–4).

Course15 / Masterclass — program context (events), НЕ обязательный gate
для Main Course / Protocol. Telegram daily workflow Курс 15 не переносится.
"""

from __future__ import annotations

from datetime import UTC, datetime

from sqlalchemy import DateTime, ForeignKey, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.models._legacy import Base


def _utc_now() -> datetime:
    return datetime.now(UTC)


class PatientJourney(Base):
    """Текущий путь пациента (один Lead → одна запись)."""

    __tablename__ = "patient_journeys"
    __table_args__ = (UniqueConstraint("company_id", "lead_id", name="uq_patient_journey_lead"),)

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    company_id: Mapped[int] = mapped_column(ForeignKey("companies.id", ondelete="CASCADE"), index=True)
    lead_id: Mapped[int] = mapped_column(ForeignKey("leads.id", ondelete="CASCADE"), index=True)

    # none | active | completed
    course_15_status: Mapped[str] = mapped_column(String(24), default="none")
    course_15_started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    course_15_completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    # Program event (recorded attendance). Отсутствие ≠ «не посетил» и ≠ блок покупки.
    master_class_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    # none | main_course | protocols — маркер первой program-ветки (аналитика).
    # НЕ gate: оба продукта могут быть в LTV; МК не требуется.
    branch: Mapped[str] = mapped_column(String(24), default="none", index=True)
    branch_started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utc_now)


class PatientJourneyEpisode(Base):
    """Эпизод Основного курса или Протокола (#1…N, data-driven)."""

    __tablename__ = "patient_journey_episodes"
    __table_args__ = (
        UniqueConstraint(
            "company_id",
            "lead_id",
            "kind",
            "sequence_no",
            name="uq_patient_journey_episode_seq",
        ),
    )

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    company_id: Mapped[int] = mapped_column(ForeignKey("companies.id", ondelete="CASCADE"), index=True)
    lead_id: Mapped[int] = mapped_column(ForeignKey("leads.id", ondelete="CASCADE"), index=True)

    # main_course | protocol
    kind: Mapped[str] = mapped_column(String(24), index=True)
    sequence_no: Mapped[int] = mapped_column(Integer, default=1)

    status: Mapped[str] = mapped_column(String(24), default="active")  # active|completed|cancelled
    started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utc_now)
    ended_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    purchase_id: Mapped[int | None] = mapped_column(
        ForeignKey("patient_purchases.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    curator_flow_id: Mapped[int | None] = mapped_column(
        ForeignKey("curator_course_flows.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    # Протоколы не пишутся в обычный журнал Main Course — только main_course может иметь flow.

    note: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utc_now)


class PatientJourneyEvent(Base):
    """Событие таймлайна (мастер-класс и ручные milestones)."""

    __tablename__ = "patient_journey_events"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    company_id: Mapped[int] = mapped_column(ForeignKey("companies.id", ondelete="CASCADE"), index=True)
    lead_id: Mapped[int] = mapped_column(ForeignKey("leads.id", ondelete="CASCADE"), index=True)
    # master_class | note | branch_set | course_15_completed | …
    event_type: Mapped[str] = mapped_column(String(40), index=True)
    occurred_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utc_now, index=True)
    payload: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utc_now)
