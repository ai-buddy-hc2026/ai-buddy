from datetime import datetime
from typing import Annotated, Literal
from uuid import UUID
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from pydantic import (
    BaseModel,
    Field,
    StringConstraints,
    field_validator,
    model_validator,
)

NonEmptyString = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1)]


class ChatHistoryMessage(BaseModel):
    role: Literal["user", "assistant"]
    content: str


class ChatRequest(BaseModel):
    request_id: UUID
    conversation_id: UUID
    user_id: UUID
    team_id: UUID
    role: Literal["intern", "buddy", "lead"]
    stage: NonEmptyString
    timestamp: datetime
    timezone: NonEmptyString
    message: Annotated[
        str,
        StringConstraints(strip_whitespace=True, min_length=1, max_length=4000),
    ]
    history: list[ChatHistoryMessage] = Field(max_length=10)

    @field_validator("timestamp", mode="before")
    @classmethod
    def require_utc_timestamp(cls, value: object) -> object:
        if not isinstance(value, str) or not value.endswith("Z"):
            raise ValueError("timestamp must be an RFC 3339 UTC string ending in Z")
        return value

    @field_validator("timezone")
    @classmethod
    def require_iana_timezone(cls, value: str) -> str:
        try:
            ZoneInfo(value)
        except ZoneInfoNotFoundError as exc:
            raise ValueError("timezone must be a valid IANA timezone") from exc
        return value

    @model_validator(mode="after")
    def validate_history_content_length(self) -> "ChatRequest":
        if sum(len(message.content) for message in self.history) > 20_000:
            raise ValueError("combined history content must not exceed 20000 characters")
        return self


class ChatResponse(BaseModel):
    request_id: UUID
    accepted: bool = True
    duplicate: bool = False
