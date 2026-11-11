import asyncio
import json
from uuid import uuid4

import pytest
import redis.asyncio as aioredis
from httpx import AsyncClient

from core import security
from core.dependencies import get_redis
from main import app


@pytest.mark.asyncio
async def test_post_chat_accepts_request_and_publishes_stream_events(
    client: AsyncClient,
    redis_client: aioredis.Redis,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setitem(
        app.dependency_overrides,
        get_redis,
        lambda: redis_client,
    )
    request_id = str(uuid4())
    channel = f"chat:{request_id}"
    monkeypatch.setattr(security.settings, "AI_SERVICE_TOKEN", "test-token")
    payload = {
        "request_id": request_id,
        "conversation_id": "30000000-0000-0000-0000-000000000001",
        "user_id": "10000000-0000-0000-0000-000000000001",
        "team_id": "00000000-0000-0000-0000-000000000001",
        "role": "intern",
        "stage": "week_1",
        "timestamp": "2026-11-09T19:35:00Z",
        "timezone": "Europe/Moscow",
        "message": "Привет",
        "history": [],
    }

    async with redis_client.pubsub() as pubsub:
        await pubsub.subscribe(channel)
        subscription = await pubsub.get_message(timeout=1)
        assert subscription is not None
        assert subscription["type"] == "subscribe"

        response = await client.post(
            "/chat",
            json=payload,
            headers={"Authorization": "Bearer test-token"},
        )
        assert response.status_code == 202, response.text

        events = []
        while not events or events[-1]["event"] not in {"done", "error"}:
            message = await asyncio.wait_for(
                pubsub.get_message(ignore_subscribe_messages=True, timeout=1),
                timeout=5,
            )
            assert message is not None
            assert message["channel"] == channel
            events.append(json.loads(message["data"]))

    assert response.status_code == 202
    assert response.json() == {
        "request_id": request_id,
        "accepted": True,
        "duplicate": False,
    }
    assert events[-1]["event"] == "done"
    assert [event["seq"] for event in events] == list(range(1, len(events) + 1))
    assert all(event["request_id"] == request_id for event in events)
    token_events = events[:-1]
    assert token_events
    assert all(event["event"] == "token" for event in token_events)
    token_text = "".join(event["data"]["text"] for event in token_events)
    assert events[-1]["data"]["full_text"] == token_text

    state = await redis_client.get(channel)
    assert state is not None
    assert json.loads(state)["state"] == "completed"
