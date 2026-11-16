from datetime import date
from typing import Annotated, Any, Literal, Union
from uuid import UUID

from pydantic import (
    BaseModel,
    Field,
    SerializerFunctionWrapHandler,
    StringConstraints,
    model_serializer,
    model_validator,
)

NonEmptyString = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1)]
Confidence = Literal["high", "medium", "low"]
CONFIDENCE_ORDER = ("low", "medium", "high")


class OptionalFieldsModel(BaseModel):
    """Необязательные поля без значения не попадают в JSON: формат старых
    событий не меняется, новые поля появляются только когда они есть."""

    _optional: tuple[str, ...] = ()

    @model_serializer(mode="wrap")
    def _drop_empty_optional(self, handler: SerializerFunctionWrapHandler) -> dict:
        data = handler(self)
        return {k: v for k, v in data.items() if v is not None or k not in self._optional}


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


class Source(OptionalFieldsModel):
    _optional = ("quote", "confidence", "reviewed_at", "owner")

    document_id: UUID
    revision: int = Field(ge=1)
    title: str
    section: str
    url: str
    # Необязательные поля качества ответа: старые клиенты их игнорируют.
    quote: str | None = Field(default=None, max_length=500)
    confidence: Confidence | None = None
    reviewed_at: date | None = None
    owner: str | None = Field(default=None, max_length=200)


class DoneData(OptionalFieldsModel):
    _optional = ("confidence",)

    full_text: str = Field(max_length=20_000)
    sources: list[Source]
    answer_status: Literal["answered", "unknown"]
    question_category: Literal["task", "process", "access", "technical", "other"]
    confidence: Confidence | None = None

    @model_validator(mode="after")
    def derive_confidence(self) -> "DoneData":
        """Уверенность ответа (идея 35): лучшая из уверенностей процитированных
        источников. Без источников с оценкой поле не передаётся."""
        if self.confidence is None:
            levels = [s.confidence for s in self.sources if s.confidence]
            if levels:
                self.confidence = max(levels, key=CONFIDENCE_ORDER.index)
        return self


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
