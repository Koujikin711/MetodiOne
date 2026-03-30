from decimal import Decimal

from pydantic import BaseModel, Field


class AnalyticsSummary(BaseModel):
    total_leads: int = 0
    deals_total_amount: Decimal = Field(default=Decimal("0"))
    conversion_percent: float = Field(
        0,
        description="Доля лидов в успешных этапах (Успешно реализован / Оплачено и т.п.)",
    )


class CustomerValueRead(BaseModel):
    customer_id: int
    value: Decimal = Field(default=Decimal("0"), description="Lifetime Value = сумма покупок по клиенту")
