import json
from collections.abc import AsyncIterator
from uuid import UUID

import pytest

from api.v1.chat import pubsub_publish
from schemas import chat as chat_schema
from schemas.chat import ChatRequest


REQUEST_ID = UUID("20000000-0000-0000-0000-000000000001")


@pytest.fixture
def chat_request(monkeypatch: pytest.MonkeyPatch) -> ChatRequest:
    monkeypatch.setattr(chat_schema, "ZoneInfo", lambda _: object())
    return ChatRequest.model_validate(
        {
            "request_id": str(REQUEST_ID),
            "conversation_id": "30000000-0000-0000-0000-000000000001",
            "user_id": "10000000-0000-0000-0000-000000000001",
            "team_id": "00000000-0000-0000-0000-000000000001",
            "role": "intern",
            "stage": "week_1",
            "timestamp": "2026-11-09T19:35:00Z",
            "timezone": "Europe/Moscow",
            "message": "Как оформить отгул?",
            "history": [
                {"role": "user", "content": "Привет"},
                {"role": "assistant", "content": "Здравствуйте"},
            ],
        }
    )


class FakeRedis:
    def __init__(self) -> None:
        self.published: list[tuple[str, str]] = []
        self.values: dict[str, tuple[str, int]] = {}

    async def publish(self, channel: str, message: str) -> int:
        self.published.append((channel, message))
        return 1

    async def set(self, key: str, value: str, ex: int) -> None:
        self.values[key] = (value, ex)


class FakeAIService:
    def __init__(self, chunks: list[str], failure: Exception | None = None) -> None:
        self.chunks = chunks
        self.failure = failure
        self.prompt: str | None = None
        self.history: list[dict[str, str]] | None = None

    async def get_ai_stream(
        self, prompt: str, history: list[dict[str, str]],
    ) -> AsyncIterator[str]:
        self.prompt = prompt
        self.history = history
        for chunk in self.chunks:
            yield chunk
        if self.failure:
            raise self.failure


@pytest.mark.asyncio
async def test_pubsub_publish_streams_tokens_and_done(chat_request: ChatRequest) -> None:
    ai_service = FakeAIService(["Добрый ", "день!"])
    redis = FakeRedis()

    await pubsub_publish(chat_request, ai_service, redis)

    assert [channel for channel, _ in redis.published] == [
        f"chat:{REQUEST_ID}",
        f"chat:{REQUEST_ID}",
        f"chat:{REQUEST_ID}",
    ]
    events = [json.loads(payload) for _, payload in redis.published]
    assert [(event["event"], event["seq"]) for event in events] == [
        ("token", 1),
        ("token", 2),
        ("done", 3),
    ]
    assert [event["data"]["text"] for event in events[:2]] == ["Добрый ", "день!"]
    assert events[2]["data"] == {
        "full_text": "Добрый день!",
        "sources": [],
    }
    assert all(event["request_id"] == str(REQUEST_ID) for event in events)
    assert ai_service.prompt == chat_request.message
    assert ai_service.history == [
        {"role": "user", "content": "Привет"},
        {"role": "assistant", "content": "Здравствуйте"},
    ]
    state, ttl = redis.values[f"chat:{REQUEST_ID}"]
    assert json.loads(state)["state"] == "completed"
    assert ttl == 600


@pytest.mark.asyncio
async def test_pubsub_publish_emits_error_when_generation_fails(
    chat_request: ChatRequest,
) -> None:
    ai_service = FakeAIService(["частичный ответ"], RuntimeError("private detail"))
    redis = FakeRedis()

    await pubsub_publish(chat_request, ai_service, redis)

    events = [json.loads(payload) for _, payload in redis.published]
    assert [(event["event"], event["seq"]) for event in events] == [
        ("token", 1),
        ("error", 2),
    ]
    assert events[-1]["data"] == {
        "code": "INTERNAL_ERROR",
        "message": "Не удалось завершить генерацию ответа.",
    }
    assert "private detail" not in json.dumps(events[-1])

    state, ttl = redis.values[f"chat:{REQUEST_ID}"]
    assert json.loads(state)["state"] == "failed"
    assert ttl == 600
