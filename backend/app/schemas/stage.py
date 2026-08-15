from pydantic import BaseModel, Field


class PipelineStageRead(BaseModel):
    id: int
    name: str
    order: int
    color: str = Field(..., max_length=32)
    pipeline_id: int | None = None
    on_enter_create_task: bool | None = None
    on_enter_task_title: str | None = None
    on_enter_task_description: str | None = None
    on_enter_task_deadline_hours: int | None = None

    model_config = {"from_attributes": True}


class PipelineStageCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=120)
    order: int | None = Field(default=None, ge=0)
    color: str = Field(default="#6366f1", max_length=32)
    pipeline_id: int = Field(..., ge=1)
    on_enter_create_task: bool | None = False
    on_enter_task_title: str | None = Field(default=None, max_length=255)
    on_enter_task_description: str | None = None
    on_enter_task_deadline_hours: int | None = Field(default=None, ge=1, le=720)


class PipelineStageUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=120)
    order: int | None = Field(default=None, ge=0)
    color: str | None = Field(default=None, max_length=32)
    on_enter_create_task: bool | None = None
    on_enter_task_title: str | None = Field(default=None, max_length=255)
    on_enter_task_description: str | None = None
    on_enter_task_deadline_hours: int | None = Field(default=None, ge=1, le=720)


class PipelineStagesReorder(BaseModel):
    """Полный упорядоченный список id стадий одной воронки."""

    pipeline_id: int = Field(..., ge=1)
    stage_ids: list[int] = Field(..., min_length=1)
