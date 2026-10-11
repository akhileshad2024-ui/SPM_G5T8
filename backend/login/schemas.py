from pydantic import BaseModel, Field, ConfigDict
from login.models import Role

MIN_PASSWORD_LENGTH = 8


class LoginRequest(BaseModel):
    email: str = Field(..., min_length=3, max_length=254)
    # Upper bound stops someone making us hash a multi-megabyte "password".
    password: str = Field(..., min_length=1, max_length=256)


class ChangePasswordRequest(BaseModel):
    current_password: str = Field(..., min_length=1, max_length=256)
    new_password: str = Field(..., min_length=MIN_PASSWORD_LENGTH, max_length=256)


class UserResponse(BaseModel):
    id: int
    email: str
    name: str
    role: Role

    model_config = ConfigDict(from_attributes=True)
