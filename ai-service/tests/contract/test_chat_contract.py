import asyncio
import json
from uuid import uuid4

import pytest
from httpx import ASGITransport, AsyncClient
from redis.exceptions import ConnectionError as RedisConnectionError

from api.v1 import chat
from core import security
from core.ai_service import LLMUnavailableError, get_ai_service
from core.dependencies import get_redis
from main import app
from schemas.chat import ChatRequest


class FakeRedis:
    def __init__(self):
        self.values = {}
        self.events = []
        self.expirations = {}
        self.fail_publish = False
        self.fail_registry = False

    async def set(self, key, value, *, nx=False, ex=None):
        if self.fail_registry:
            raise RedisConnectionError("private-registry-details")
        if nx and key in self.values:
            return False
        self.values[key] = value
        self.expirations[key] = ex
        return True

    async def get(self, key):
        return self.values.get(key)

    async def publish(self, _key, value):
        if self.fail_publish:
            raise RedisConnectionError("private-publication-details")
        self.events.append(json.loads(value))
        return 1


class FakeAI:
    llm_client = object()

    def __init__(
        self,
        parts=("\u041f\u0440\u0438\u0432\u0435\u0442 ", "\u043c\u0438\u0440"),
        error=None,
        delay=0,
        category="other",
    ):
        self.parts = parts
        self.error = error
        self.delay = delay
        self.calls = 0
        self.closed = False
        self.category = category
        self.messages = []
        self.tools = []

    async def classify_question(self, _question):
        return self.category

    async def stream_step(self, messages, tools):
        self.calls += 1
        self.messages = messages
        self.tools = tools
        try:
            for part in self.parts:
                if self.delay:
                    await asyncio.sleep(self.delay)
                yield {"type": "token", "text": part}
            if self.error:
                raise self.error
        finally:
            self.closed = True


def payload():
    return {
        "request_id": str(uuid4()),
        "conversation_id": "30000000-0000-0000-0000-000000000001",
        "user_id": "10000000-0000-0000-0000-000000000001",
        "team_id": "00000000-0000-0000-0000-000000000001",
        "role": "intern",
        "stage": "week_1",
        "timestamp": "2026-11-11T12:30:00Z",
        "timezone": "Europe/Moscow",
        "message": "Вопрос",
        "history": [],
    }


@pytest.fixture
def configured_dependencies(monkeypatch):
    redis = FakeRedis()
    ai = FakeAI()
    monkeypatch.setattr(security.settings, "AI_SERVICE_TOKEN", "synthetic-service-token")
    app.dependency_overrides[get_redis] = lambda: redis
    app.dependency_overrides[get_ai_service] = lambda: ai
    yield redis, ai
    app.dependency_overrides.clear()


async def test_http_acceptance_idempotency_and_errors(configured_dependencies):
    redis, ai = configured_dependencies
    transport = ASGITransport(app=app)
    headers = {"Authorization": "Bearer synthetic-service-token"}
    data = payload()
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        denied = await client.post("/chat", json=data)
        assert denied.status_code == 401
        assert denied.json()["error"]["code"] == "UNAUTHORIZED"
        invalid = await client.post(
            "/chat",
            json={"message": "private-input"},
            headers=headers,
        )
        assert invalid.status_code == 400
        assert invalid.json()["error"]["code"] == "INVALID_REQUEST"
        assert "private-input" not in invalid.text
        accepted = await client.post("/chat", json=data, headers=headers)
        assert accepted.status_code == 202
        assert accepted.json() == {
            "request_id": data["request_id"],
            "accepted": True,
            "duplicate": False,
        }
        duplicate = await client.post("/chat", json=data, headers=headers)
        assert duplicate.status_code == 202
        assert duplicate.json()["duplicate"] is True
        conflict = await client.post(
            "/chat",
            json={**data, "message": "Другой вопрос"},
            headers=headers,
        )
        assert conflict.status_code == 409
        assert conflict.json()["error"]["code"] == "REQUEST_ID_CONFLICT"
        assert ai.calls == 1 and ai.closed
        assert [event["event"] for event in redis.events] == ["token", "token", "done"]
        assert [event["seq"] for event in redis.events] == [1, 2, 3]
        assert redis.events[-1]["data"] == {
            "full_text": "Привет мир",
            "sources": [],
            "answer_status": "answered",
            "question_category": "other",
        }
        assert redis.expirations[f"chat:{data['request_id']}"] == 600
        redis.fail_registry = True
        unavailable = await client.post("/chat", json=payload(), headers=headers)
        assert unavailable.status_code == 503
        assert unavailable.json()["error"]["code"] == "SERVICE_UNAVAILABLE"
        assert "private-registry-details" not in unavailable.text


@pytest.mark.parametrize(
    ("ai", "code"),
    [
        (
            FakeAI(parts=(), error=LLMUnavailableError("private-provider-details")),
            "LLM_UNAVAILABLE",
        ),
        (FakeAI(parts=(), error=TimeoutError("private-timeout")), "LLM_TIMEOUT"),
        (FakeAI(parts=(), error=ValueError("private-error")), "INTERNAL_ERROR"),
        (FakeAI(parts=()), "INTERNAL_ERROR"),
        (FakeAI(parts=("я" * 20_001,)), "INTERNAL_ERROR"),
    ],
)
async def test_generation_failures_are_terminal_and_safe(ai, code):
    redis = FakeRedis()
    data = ChatRequest.model_validate(payload())
    await chat.pubsub_publish(data, ai, redis)
    assert ai.closed
    assert len(redis.events) == 1
    event = redis.events[0]
    assert event["event"] == "error"
    assert event["seq"] == 1
    assert event["data"]["code"] == code
    assert "private" not in event["data"]["message"]
    assert json.loads(redis.values[f"chat:{data.request_id}"])["state"] == "failed"


async def test_whole_generation_deadline(monkeypatch):
    monkeypatch.setattr(chat, "GENERATION_TIMEOUT_SECONDS", 0.02)
    redis = FakeRedis()
    ai = FakeAI(delay=0.1)
    await chat.pubsub_publish(ChatRequest.model_validate(payload()), ai, redis)
    assert ai.closed
    assert [event["event"] for event in redis.events] == ["error"]
    assert redis.events[0]["data"]["code"] == "LLM_TIMEOUT"


async def test_redis_loss_does_not_publish_conflicting_sequence(caplog):
    redis = FakeRedis()
    redis.fail_publish = True
    ai = FakeAI()
    data = ChatRequest.model_validate(payload())
    await chat.pubsub_publish(data, ai, redis)
    assert redis.events == []
    assert ai.closed
    assert "private-publication-details" not in caplog.text
    assert json.loads(redis.values[f"chat:{data.request_id}"])["state"] == "failed"


async def test_classification_failure_keeps_answer_and_uses_other(monkeypatch):
    redis = FakeRedis()
    ai = FakeAI(parts=("Synthetic answer",))
    monkeypatch.setattr(chat, "GenerationMCPClient", lambda **kwargs: SearchMCP([]))

    async def fail_classification(_question):
        raise TimeoutError("private classification timeout")

    ai.classify_question = fail_classification
    await chat.pubsub_publish(ChatRequest.model_validate(payload()), ai, redis)

    assert [event["event"] for event in redis.events] == ["token", "done"]
    assert redis.events[-1]["data"]["full_text"] == "Synthetic answer"
    assert redis.events[-1]["data"]["question_category"] == "other"
    assert (
        json.loads(redis.values[f"chat:{redis.events[-1]['request_id']}"])["state"]
        == "completed"
    )


class SearchAI(FakeAI):
    def __init__(self, category="process"):
        super().__init__(parts=(), category=category)

    async def stream_step(self, messages, tools):
        self.calls += 1
        self.messages = messages
        self.tools = tools
        try:
            if self.calls == 1:
                yield {
                    "type": "tool_call_delta",
                    "tool_call": {
                        "index": 0,
                        "id": "search-1",
                        "function": {
                            "name": "knowledge_search",
                            "arguments": '{"query":"Synthetic question"}',
                        },
                    },
                }
            else:
                yield {"type": "token", "text": "Grounded answer"}
        finally:
            self.closed = True


class SearchMCP:
    def __init__(self, items):
        self.items = items

    async def __aenter__(self):
        return self

    async def __aexit__(self, *_args):
        return None

    def get_tools_for_llm(self):
        return [{"name": "knowledge.search", "inputSchema": {"type": "object"}}]

    async def call_tool(self, _name, _arguments):
        return {"items": self.items}


@pytest.mark.parametrize(
    ("items", "expected_status", "expected_sources"),
    [
        ([], "unknown", []),
        (
            [
                {
                    "source": {
                        "document_id": "40000000-0000-0000-0000-000000000001",
                        "revision": 3,
                        "title": "Synthetic guide",
                        "section": "Setup",
                        "url": "kb/synthetic-guide",
                    },
                    "content": "Synthetic content",
                },
            ],
            "answered",
            [
                {
                    "document_id": "40000000-0000-0000-0000-000000000001",
                    "revision": 3,
                    "title": "Synthetic guide",
                    "section": "Setup",
                    "url": "kb/synthetic-guide",
                },
            ],
        ),
    ],
)
async def test_search_result_sets_answer_status_sources_and_category(
    items,
    expected_status,
    expected_sources,
    monkeypatch,
):
    redis = FakeRedis()
    ai = SearchAI()
    monkeypatch.setattr(chat, "GenerationMCPClient", lambda **kwargs: SearchMCP(items))

    async def search_knowledge(_arguments, _context):
        if not items:
            return {
                "status": "no_answer",
                "who_to_ask": ["наставник"],
                "suggest_escalation": True,
            }
        source = items[0]["source"]
        return {
            "status": "found",
            "results": [
                {
                    "id": 1,
                    "doc_title": source["title"],
                    "section": source["section"],
                    "text": items[0]["content"],
                    "source": source,
                },
            ],
        }

    monkeypatch.setattr(chat, "_search_knowledge", search_knowledge)

    await chat.pubsub_publish(ChatRequest.model_validate(payload()), ai, redis)

    done = redis.events[-1]
    assert done["event"] == "done"
    assert done["data"]["answer_status"] == expected_status
    assert done["data"]["question_category"] == "process"
    assert done["data"]["sources"] == expected_sources
    assert ai.messages[0]["role"] == "system"
    assert "Роль: стажёр" in ai.messages[0]["content"]
    assert any(tool["name"] == "knowledge_search" for tool in ai.tools)
