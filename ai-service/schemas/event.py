from typing import Annotated, Any, Literal, Union
from uuid import UUID

from pydantic import BaseModel, Field, StringConstraints

NonEmptyString = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1)]


class TokenData(BaseModel):
    text: str = Field(min_length=1)


class TokenEvent(BaseModel):
    event: Literal["token"]
    request_id: UUID
    seq: int = Field(ge=1)
    data: TokenData


class ToolCallData(BaseModel):
    tool_name: NonEmptyString
    arguments: dict[str, Any]


class ToolCallEvent(BaseModel):
    event: Literal["tool_call"]
    request_id: UUID
    seq: int = Field(ge=1)
    data: ToolCallData


class ActionProposalData(BaseModel):
    action_type: NonEmptyString
    details: dict[str, Any]


class ActionProposalEventFromPython(BaseModel):
    event: Literal["action_proposal"]
    request_id: UUID
    seq: int = Field(ge=1)
    data: ActionProposalData


class Source(BaseModel):
    document_id: UUID
    revision: int = Field(ge=1)
    title: str
    section: str
    url: str


class DoneData(BaseModel):
    full_text: str = Field(max_length=20_000)
    sources: list[Source]


class DoneEvent(BaseModel):
    event: Literal["done"]
    request_id: UUID
    seq: int = Field(ge=1)
    data: DoneData


class ErrorData(BaseModel):
    code: Literal[
        "LLM_TIMEOUT",
        "LLM_UNAVAILABLE",
        "TOOL_FAILED",
        "INTERNAL_ERROR",
    ]
    message: NonEmptyString


class ErrorEvent(BaseModel):
    event: Literal["error"]
    request_id: UUID
    seq: int = Field(ge=1)
    data: ErrorData


EventFromPython = Annotated[
    Union[
        TokenEvent,
        ToolCallEvent,
        ActionProposalEventFromPython,
        DoneEvent,
        ErrorEvent,
    ],
    Field(discriminator="event"),
]
