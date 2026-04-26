from pydantic import BaseModel, Field

from app.models import UserRole
from app.schemas.email_types import LoginIdentifierStr, RelaxedEmailStr


class UserCreate(BaseModel):
    email: RelaxedEmailStr
    password: str = Field(min_length=8, max_length=128)
    role: UserRole = UserRole.manager
    phone: str | None = Field(default=None, max_length=32)
    full_name: str | None = Field(default=None, max_length=255)


class UserLogin(BaseModel):
    email: LoginIdentifierStr
    password: str


class UserRead(BaseModel):
    id: int
    email: str
    role: UserRole
    company_id: int | None = None
    phone: str | None = None
    full_name: str | None = None
    must_change_password: bool = False

    model_config = {"from_attributes": True}


class UserMeRead(UserRead):
    impersonated_by_user_id: int | None = None


class ChangePasswordBody(BaseModel):
    old_password: str = Field(..., min_length=1, max_length=128)
    new_password: str = Field(..., min_length=8, max_length=128)


class UserBrief(BaseModel):
    id: int
    email: str

    model_config = {"from_attributes": True}
