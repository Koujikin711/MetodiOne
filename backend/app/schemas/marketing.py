from datetime import date
from decimal import Decimal

from pydantic import BaseModel, Field


class MarketingMetaSettingsRead(BaseModel):
    configured: bool
    ad_account_id: str = ""
    has_token: bool = False
    account_name: str | None = None
    currency: str | None = None
    timezone_name: str | None = None


class MarketingMetaSettingsPatch(BaseModel):
    ad_account_id: str = Field(..., min_length=3, max_length=64)
    access_token: str | None = Field(
        default=None,
        description="Новый токен; пусто — оставить текущий",
    )


class MarketingCampaignRow(BaseModel):
    campaign_id: str
    campaign_name: str
    spend: Decimal
    impressions: int
    clicks: int
    leads: int
    cpc: Decimal | None = None
    ctr: Decimal | None = None
    cost_per_lead: Decimal | None = None


class MarketingManagerConversionRow(BaseModel):
    manager_id: int | None = None
    manager_name: str
    received: int = 0
    answered: int = 0
    rejected: int = 0
    sold: int = 0
    answered_pct: float = 0.0
    rejected_pct: float = 0.0
    sold_pct: float = 0.0


class MarketingOverviewRead(BaseModel):
    period_start: date
    period_end: date
    currency: str = "USD"
    account_name: str | None = None
    ad_account_id: str
    spend: Decimal
    impressions: int
    clicks: int
    leads: int
    cost_per_lead: Decimal | None = None
    campaigns: list[MarketingCampaignRow] = Field(default_factory=list)
    managers: list[MarketingManagerConversionRow] = Field(default_factory=list)
    managers_total: MarketingManagerConversionRow | None = None
