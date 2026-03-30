from pydantic import BaseModel, Field


class PipelineStageCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=120)
    order: int | None = Field(default=None, ge=0)
    color: str = Field(default="#6366f1", max_length=32)


class PipelineRead(BaseModel):
    id: int
    name: str
    type: str | None = None

    model_config = {"from_attributes": True}


class PipelineCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=255)
    type: str | None = Field(default=None, max_length=64)
    stages: list[PipelineStageCreate] = Field(..., min_length=1)

