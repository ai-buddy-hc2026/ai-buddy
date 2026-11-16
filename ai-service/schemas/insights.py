from typing import Annotated

from pydantic import BaseModel, Field, StringConstraints

Owner = Annotated[str, StringConstraints(strip_whitespace=True, max_length=120)]
Due = Annotated[str, StringConstraints(strip_whitespace=True, max_length=60)]
ShortText = Annotated[
    str,
    StringConstraints(strip_whitespace=True, min_length=1, max_length=300),
]


class MeetingSummaryRequest(BaseModel):
    text: Annotated[
        str,
        StringConstraints(strip_whitespace=True, min_length=1, max_length=20_000),
    ]


class ActionItem(BaseModel):
    title: ShortText
    owner: Owner | None = None
    due: Due | None = None


class MeetingSummary(BaseModel):
    """Итоги встречи (идея 8). Этой же схемой проверяется ответ модели."""

    agreements: list[ShortText] = Field(default_factory=list, max_length=20)
    action_items: list[ActionItem] = Field(default_factory=list, max_length=20)


class QuestionIn(BaseModel):
    id: Annotated[str, StringConstraints(max_length=64)] | None = None
    text: Annotated[
        str,
        StringConstraints(strip_whitespace=True, min_length=1, max_length=1000),
    ]


class ClusterRequest(BaseModel):
    questions: list[QuestionIn] = Field(min_length=1, max_length=500)
    threshold: float = Field(default=0.34, gt=0, le=1)


class QuestionCluster(BaseModel):
    label: str
    size: int
    questions: list[QuestionIn]


class ClusterResponse(BaseModel):
    clusters: list[QuestionCluster]
