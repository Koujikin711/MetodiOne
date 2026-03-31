from pydantic import BaseModel, Field


class PipelineStageRead(BaseModel):
    id: int
    name: str
    order: int
    color: str = Field(..., max_length=32)
    pipeline_id: int | None = None

    model_config = {"from_attributes": True}


class PipelineStageCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=120)
    order: int | None = Field(default=None, ge=0)
    color: str = Field(default="#6366f1", max_length=32)
    pipeline_id: int = Field(..., ge=1)
