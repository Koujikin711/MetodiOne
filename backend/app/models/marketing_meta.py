"""Настройки Meta Ads для раздела «Маркетинг»."""

from __future__ import annotations

from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, String, Text, UniqueConstraint
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
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utc_now, insert_default=_utc_now)
