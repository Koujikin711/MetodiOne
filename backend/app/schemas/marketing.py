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
    brand: str | None = None
    spend: Decimal
    impressions: int
    clicks: int
    leads: int
    followers: int = 0
    cpc: Decimal | None = None
    ctr: Decimal | None = None
    cost_per_lead: Decimal | None = None


class MarketingBrandRow(BaseModel):
    account: str
    followers: int = 0
    leads: int = 0
    spend: Decimal = Decimal("0")
    impressions: int = 0
    clicks: int = 0


class MarketingDailyPoint(BaseModel):
    date: date
    spend: Decimal = Decimal("0")
    leads: int = 0
    followers: int = 0
    clicks: int = 0
    impressions: int = 0


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
    period: str
    period_start: date
    period_end: date
    currency: str = "USD"
    account_name: str | None = None
    ad_account_id: str
    spend: Decimal
    impressions: int
    clicks: int
    leads: int
    followers: int = 0
    cost_per_lead: Decimal | None = None
    campaigns: list[MarketingCampaignRow] = Field(default_factory=list)
    brands: list[MarketingBrandRow] = Field(default_factory=list)
    daily: list[MarketingDailyPoint] = Field(default_factory=list)
    managers: list[MarketingManagerConversionRow] = Field(default_factory=list)
    managers_total: MarketingManagerConversionRow | None = None
