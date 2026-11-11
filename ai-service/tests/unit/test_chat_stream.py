import asyncio
import json
from uuid import UUID

import pytest
import redis.asyncio as aioredis

from api.v1.chat import pubsub_publish
from config import get_settings
from core.ai_service import AIService
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
        },
    )


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


async def test_pubsub_publish_emits_error_when_generation_fails(
    chat_request: ChatRequest,
    redis_client: aioredis.Redis,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    settings = get_settings()
    monkeypatch.setattr(settings, "LLM_MODEL", "missing-ai-buddy-test-model")
    ai_service = AIService()

    events = await _run_and_read_events(chat_request, ai_service, redis_client)

    assert [(event["event"], event["seq"]) for event in events] == [("error", 1)]
    assert events[-1]["data"] == {
        "code": "LLM_UNAVAILABLE",
        "message": "Ассистент временно недоступен.",
    }

    state = await redis_client.get(f"chat:{REQUEST_ID}")
    assert state is not None
    assert json.loads(state)["state"] == "failed"
    assert json.loads(state)["error"] == "LLM_UNAVAILABLE"
    ttl = await redis_client.ttl(f"chat:{REQUEST_ID}")
    assert 0 < ttl <= 600


async def test_pubsub_publish_reports_missing_api_key(
    chat_request: ChatRequest,
    redis_client: aioredis.Redis,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    settings = get_settings()
    monkeypatch.setattr(settings, "LLM_API_KEY", "")
    ai_service = AIService()

    events = await _run_and_read_events(chat_request, ai_service, redis_client)

    assert [(event["event"], event["seq"]) for event in events] == [("error", 1)]
    assert events[0]["data"] == {
        "code": "LLM_UNAVAILABLE",
        "message": "Ассистент временно недоступен.",
    }
