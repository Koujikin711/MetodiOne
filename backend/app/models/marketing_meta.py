"""Настройки Meta Ads для раздела «Маркетинг»."""

from __future__ import annotations

from datetime import date, datetime

from sqlalchemy import Date, DateTime, ForeignKey, JSON, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.models._legacy import Base, _utc_now


class MarketingMetaSettings(Base):
    __tablename__ = "marketing_meta_settings"
    __table_args__ = (UniqueConstraint("company_id", name="uq_marketing_meta_company"),)

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    company_id: Mapped[int] = mapped_column(ForeignKey("companies.id", ondelete="CASCADE"), index=True)
    # act_123… или просто цифры — нормализуем в сервисе
    ad_account_id: Mapped[str] = mapped_column(String(64), default="")
    access_token: Mapped[str | None] = mapped_column(Text, nullable=True)
    # Verify Token для общего Meta webhook (/api/integrations/webhook/meta)
    ig_verify_token: Mapped[str | None] = mapped_column(String(128), nullable=True)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utc_now)


class MarketingMetaSnapshot(Base):
    """Кэш ответа Meta Ads (day/week/month) — обновляется фоном 4–6 раз в сутки."""

    __tablename__ = "marketing_meta_snapshots"
    __table_args__ = (
        UniqueConstraint("company_id", "period_key", name="uq_marketing_meta_snapshot_period"),
    )

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    company_id: Mapped[int] = mapped_column(ForeignKey("companies.id", ondelete="CASCADE"), index=True)
    period_key: Mapped[str] = mapped_column(String(80), nullable=False)
    period: Mapped[str] = mapped_column(String(16), nullable=False, default="month")
    period_start: Mapped[date] = mapped_column(Date, nullable=False)
    period_end: Mapped[date] = mapped_column(Date, nullable=False)
    payload: Mapped[dict] = mapped_column(JSON, nullable=False, default=dict)
    fetched_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utc_now)
