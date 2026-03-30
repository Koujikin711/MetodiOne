from pydantic import BaseModel


class PipelineRead(BaseModel):
    id: int
    name: str
    type: str | None = None

    model_config = {"from_attributes": True}

