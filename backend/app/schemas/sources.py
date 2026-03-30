from pydantic import BaseModel, Field


class LeadSourceRead(BaseModel):
    id: int
    name: str
    is_active: bool = True

    model_config = {"from_attributes": True}


class LeadSourceCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=120)
    is_active: bool = True


class LeadSourceUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=120)
    is_active: bool | None = None

