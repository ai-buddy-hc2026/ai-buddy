import asyncio
import json
from collections.abc import AsyncIterator, Iterator
from uuid import UUID

import pytest
import pytest_asyncio
import redis.asyncio as aioredis
from testcontainers.community.redis import RedisContainer

from api.v1.chat import pubsub_publish
from core.ai_service import AIService
from schemas import chat as chat_schema
from schemas.chat import ChatRequest

REQUEST_ID = UUID("20000000-0000-0000-0000-000000000001")


@pytest.fixture
def redis_container() -> Iterator[RedisContainer]:
    with RedisContainer("redis:7-alpine") as container:
        yield container


@pytest_asyncio.fixture
async def redis_client(redis_container: RedisContainer) -> AsyncIterator[aioredis.Redis]:
    client = aioredis.Redis(
        host=redis_container.get_container_host_ip(),
        port=int(redis_container.get_exposed_port(6379)),
        decode_responses=True,
    )
    await client.ping()
    yield client
    await client.aclose()


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
        },
    )


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


async def _run_and_read_events(
    chat_request: ChatRequest,
    ai_service: AIService,
    redis: aioredis.Redis,
) -> list[dict[str, object]]:
    channel = f"chat:{REQUEST_ID}"
    async with redis.pubsub() as pubsub:
        await pubsub.subscribe(channel)
        subscription = await pubsub.get_message(timeout=1)
        assert subscription is not None
        assert subscription["type"] == "subscribe"

        await pubsub_publish(chat_request, ai_service, redis)

        events = []
        while not events or events[-1]["event"] not in {"done", "error"}:
            message = await asyncio.wait_for(
                pubsub.get_message(ignore_subscribe_messages=True, timeout=1),
                timeout=2,
            )
            assert message is not None
            assert message["channel"] == channel
            events.append(json.loads(message["data"]))
        return events


@pytest.mark.asyncio
async def test_pubsub_publish_streams_tokens_and_done(
    chat_request: ChatRequest,
    redis_client: aioredis.Redis,
    ai_service: AIService,
) -> None:
    events = await _run_and_read_events(chat_request, ai_service, redis_client)

    token_events = events[:-1]
    assert token_events
    assert all(event["event"] == "token" for event in token_events)
    assert [event["seq"] for event in events] == list(range(1, len(events) + 1))
    assert events[-1]["event"] == "done"
    token_text = "".join(event["data"]["text"] for event in token_events)
    assert events[-1]["data"] == {"full_text": token_text, "sources": []}
    assert all(event["request_id"] == str(REQUEST_ID) for event in events)
    state = await redis_client.get(f"chat:{REQUEST_ID}")
    assert state is not None
    assert json.loads(state)["state"] == "completed"
    ttl = await redis_client.ttl(f"chat:{REQUEST_ID}")
    assert 0 < ttl <= 600


@pytest.mark.asyncio
async def test_pubsub_publish_emits_error_when_generation_fails(
    chat_request: ChatRequest,
    redis_client: aioredis.Redis,
) -> None:
    ai_service = FakeAIService(["частичный ответ"], RuntimeError("private detail"))

    events = await _run_and_read_events(chat_request, ai_service, redis_client)

    assert [(event["event"], event["seq"]) for event in events] == [
        ("token", 1),
        ("error", 2),
    ]
    assert events[-1]["data"] == {
        "code": "INTERNAL_ERROR",
        "message": "Не удалось завершить генерацию ответа.",
    }
    assert "private detail" not in json.dumps(events[-1])

    state = await redis_client.get(f"chat:{REQUEST_ID}")
    assert state is not None
    assert json.loads(state)["state"] == "failed"
    ttl = await redis_client.ttl(f"chat:{REQUEST_ID}")
    assert 0 < ttl <= 600
