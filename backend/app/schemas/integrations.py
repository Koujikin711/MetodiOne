from pydantic import BaseModel, Field


class IntegrationRead(BaseModel):
    id: int
    name: str
    provider: str
    is_active: bool
    pipeline_id: int
    stage_id: int
    # api_token в config не отдаётся клиенту; см. has_api_token
    config: dict | None = None
    has_api_token: bool = False

    model_config = {"from_attributes": True}


class IntegrationCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=120)
    provider: str = Field(..., min_length=1, max_length=40)
    pipeline_id: int = Field(..., ge=1)
    stage_id: int = Field(..., ge=1)
    secret: str = Field(..., min_length=8, max_length=128)
    config: dict | None = None


class IntegrationUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=120)
    is_active: bool | None = None
    pipeline_id: int | None = Field(default=None, ge=1)
    stage_id: int | None = Field(default=None, ge=1)
    secret: str | None = Field(default=None, min_length=8, max_length=128)
    config: dict | None = None

