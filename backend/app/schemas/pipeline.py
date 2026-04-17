from pydantic import BaseModel, Field


class PipelineStageCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=120)
    order: int | None = Field(default=None, ge=0)
    color: str = Field(default="#6366f1", max_length=32)


class PipelineRead(BaseModel):
    id: int
    name: str
    type: str | None = None
    lead_assignment_mode: str = "none"
    expert_user_id: int | None = None
    intake_manager_user_id: int | None = None

    model_config = {"from_attributes": True}


class PipelinePatch(BaseModel):
    lead_assignment_mode: str | None = Field(
        default=None,
        description="none | round_robin | least_loaded",
    )
    expert_user_id: int | None = Field(default=None, ge=1)
    intake_manager_user_id: int | None = Field(default=None, ge=1)


class PipelineCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=255)
    type: str | None = Field(default=None, max_length=64)
    stages: list[PipelineStageCreate] = Field(
        default_factory=list,
        description="Пустой список — сервер создаст стандартный набор стадий",
    )
    expert_user_id: int | None = Field(default=None, ge=1)
    intake_manager_user_id: int | None = Field(default=None, ge=1)

