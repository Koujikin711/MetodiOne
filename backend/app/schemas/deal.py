from decimal import Decimal
from typing import Literal

from pydantic import BaseModel, Field


class DealRead(BaseModel):
    id: int
    title: str
    deal_type: str
    amount: Decimal
    paid_amount: Decimal
    is_protocol: bool
    protocol_requested: bool
    protocol_confirmed: bool
    protocol_file_path: str | None = None

    model_config = {"from_attributes": True}


class ExtraServiceAddBody(BaseModel):
    """Карточка «доп. услуги» (продуктовая корзина)."""

    type: str = Field(..., min_length=1, max_length=80, description="Напр. «Протокол» или «Прочее»")
    amount: Decimal = Field(..., ge=0, description="Итоговая сумма услуги")
    paid_amount: Decimal = Field(..., ge=0, description="Сколько оплачено на текущий момент")


class ProtocolConfirmBody(BaseModel):
    confirmed: bool = Field(..., description="Да/Нет: подтверждает написание протокола")


class ProtocolFinishBody(BaseModel):
    """Фиксация завершения протокола (файл уже должен быть загружен)."""

    action: Literal["finish"] = "finish"

