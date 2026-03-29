from pydantic import BaseModel, Field

from app.models import UserRole
from app.schemas.email_types import LoginIdentifierStr, RelaxedEmailStr


class UserCreate(BaseModel):
    email: RelaxedEmailStr
    password: str = Field(min_length=8, max_length=128)
    role: UserRole = UserRole.manager


class UserLogin(BaseModel):
    email: LoginIdentifierStr
    password: str


class UserRead(BaseModel):
    id: int
    email: str
    role: UserRole

    model_config = {"from_attributes": True}


class UserBrief(BaseModel):
    id: int
    email: str

    model_config = {"from_attributes": True}
