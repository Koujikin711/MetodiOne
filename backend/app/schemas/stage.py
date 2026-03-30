from pydantic import BaseModel, Field


class PipelineStageRead(BaseModel):
    id: int
    name: str
    order: int
    color: str = Field(..., max_length=32)
    pipeline_id: int | None = None

    model_config = {"from_attributes": True}
