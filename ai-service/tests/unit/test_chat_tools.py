import asyncio
import json
import time
from contextlib import asynccontextmanager
from types import SimpleNamespace
from uuid import UUID

import pytest
import redis.asyncio as aioredis

from api.v1 import chat
from core.ai_service import AIService
from integrations import mcp_client
from schemas import chat as chat_schema
from schemas.chat import ChatRequest

REQUEST_ID = UUID("20000000-0000-0000-0000-000000000001")
TOOL_SCHEMA = {"type": "object", "properties": {}, "additionalProperties": False}
FAILURE_SCHEMA = {
    "type": "object",
    "properties": {
        "ok": {"const": False},
        "error": {
            "type": "object",
            "properties": {
                "code": {"const": "CONFIRMATION_REQUIRED"},
                "message": {"type": "string"},
                "retryable": {"const": False},
            },
            "required": ["code", "message", "retryable"],
            "additionalProperties": False,
        },
    },
    "required": ["ok", "error"],
    "additionalProperties": False,
}


class FakeMCPClient:
    instance: "FakeMCPClient | None" = None

    def __init__(self, **kwargs) -> None:
        self.publish_action_proposal = kwargs["publish_action_proposal"]
        self.call_args: list[tuple[str, dict]] = []
        self.proposal_args: list[tuple[str, dict]] = []
        self.entered = False
        self.__class__.instance = self

    async def __aenter__(self) -> "FakeMCPClient":
        self.entered = True
        return self

    async def __aexit__(self, exc_type, exc_value, traceback) -> None:
        self.entered = False

    def get_tools_for_llm(self) -> list[dict]:
        return [
            {
                "name": "checklist.get_plan",
                "description": "Получить план",
                "inputSchema": TOOL_SCHEMA,
            },
            {
                "name": "absences.create_request",
                "description": "Предложить заявку",
                "inputSchema": TOOL_SCHEMA,
            },
        ]

    async def call_tool(self, name: str, arguments: dict) -> dict:
        self.call_args.append((name, arguments))
        return {"stage": "week_1"}

    async def propose_action(self, name: str, arguments: dict) -> dict:
        self.proposal_args.append((name, arguments))
        await self.publish_action_proposal(name, arguments)
        return {
            "ok": False,
            "error": {
                "code": "CONFIRMATION_REQUIRED",
                "message": "Действие предложено и ожидает подтверждения пользователя.",
                "retryable": False,
            },
        }


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
            "message": "Покажи мой план",
            "history": [],
        },
    )


def configure_ai_service(
    monkeypatch: pytest.MonkeyPatch,
    ai_service: AIService,
    tool_name: str = "checklist.get_plan",
) -> list[tuple[list[dict], list[dict]]]:
    calls: list[tuple[list[dict], list[dict]]] = []

    async def stream_step(messages: list[dict], tools: list[dict]):
        calls.append((messages, tools))
        if len(calls) == 1:
            yield {"type": "token", "text": "Проверяю план. "}
            yield {
                "type": "tool_call_delta",
                "tool_call": SimpleNamespace(
                    index=0,
                    id="call-1",
                    function=SimpleNamespace(
                        name=tool_name,
                        arguments="{",
                    ),
                ),
            }
            yield {
                "type": "tool_call_delta",
                "tool_call": SimpleNamespace(
                    index=0,
                    function=SimpleNamespace(
                        name=None,
                        arguments="}",
                    ),
                ),
            }
            return
        yield {"type": "token", "text": "План найден."}

    monkeypatch.setattr(ai_service, "stream_step", stream_step)
    return calls


async def run_and_read_events(
    chat_request: ChatRequest,
    ai_service: AIService,
    redis: aioredis.Redis,
) -> list[dict]:
    channel = f"chat:{chat_request.request_id}"
    await redis.delete(channel)
    async with redis.pubsub() as pubsub:
        await pubsub.subscribe(channel)
        subscription = await pubsub.get_message(timeout=1)
        assert subscription is not None
        assert subscription["type"] == "subscribe"

        await chat.pubsub_publish(chat_request, ai_service, redis)

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
async def test_chat_fetches_tools_calls_go_and_continues_generation(
    chat_request: ChatRequest,
    monkeypatch: pytest.MonkeyPatch,
    redis_client: aioredis.Redis,
    ai_service: AIService,
) -> None:
    monkeypatch.setattr(chat, "GenerationMCPClient", FakeMCPClient)
    calls = configure_ai_service(monkeypatch, ai_service)

    events = await run_and_read_events(chat_request, ai_service, redis_client)

    assert FakeMCPClient.instance is not None
    assert FakeMCPClient.instance.call_args == [("checklist.get_plan", {})]
    assert calls[0][1][0]["inputSchema"] == TOOL_SCHEMA
    assert calls[1][0][-2]["role"] == "assistant"
    assert calls[1][0][-1]["role"] == "tool"
    assert calls[1][0][-1]["content"] == '{"stage": "week_1"}'
    assert [event["seq"] for event in events] == [1, 2, 3, 4]
    assert [event["event"] for event in events] == [
        "token",
        "tool_call",
        "token",
        "done",
    ]
    assert events[-1]["data"]["full_text"] == "Проверяю план. План найден."
    state = await redis_client.get(f"chat:{chat_request.request_id}")
    assert state is not None
    assert json.loads(state)["state"] == "completed"


@pytest.mark.asyncio
async def test_chat_emits_tool_failed_when_go_call_fails(
    chat_request: ChatRequest,
    monkeypatch: pytest.MonkeyPatch,
    redis_client: aioredis.Redis,
    ai_service: AIService,
) -> None:
    class FailedMCPClient(FakeMCPClient):
        async def call_tool(self, name: str, arguments: dict) -> dict:
            from integrations.mcp_client import MCPContractError

            raise MCPContractError("DEPENDENCY_UNAVAILABLE", "backend unavailable")

    monkeypatch.setattr(chat, "GenerationMCPClient", FailedMCPClient)
    configure_ai_service(monkeypatch, ai_service)

    events = await run_and_read_events(chat_request, ai_service, redis_client)

    assert events[-1]["event"] == "error"
    assert events[-1]["data"]["code"] == "TOOL_FAILED"
    assert events[-1]["seq"] == len(events)
    assert [event["seq"] for event in events] == list(range(1, len(events) + 1))
    state = await redis_client.get(f"chat:{chat_request.request_id}")
    assert state is not None
    assert json.loads(state)["state"] == "failed"


@pytest.mark.asyncio
async def test_chat_proposes_write_and_returns_confirmation_error_to_llm(
    chat_request: ChatRequest,
    monkeypatch: pytest.MonkeyPatch,
    redis_client: aioredis.Redis,
    ai_service: AIService,
) -> None:
    monkeypatch.setattr(chat, "GenerationMCPClient", FakeMCPClient)
    calls = configure_ai_service(monkeypatch, ai_service, "absences.create_request")

    events = await run_and_read_events(chat_request, ai_service, redis_client)

    client = FakeMCPClient.instance
    assert client is not None
    assert client.call_args == []
    assert client.proposal_args == [("absences.create_request", {})]
    assert calls[1][0][-1]["content"] == (
        '{"error": {"code": "CONFIRMATION_REQUIRED", '
        '"message": "Действие предложено и ожидает подтверждения пользователя.", '
        '"retryable": false}}'
    )
    assert [event["event"] for event in events] == [
        "token",
        "tool_call",
        "action_proposal",
        "token",
        "done",
    ]
    assert [event["seq"] for event in events] == [1, 2, 3, 4, 5]


@pytest.mark.asyncio
async def test_chat_returns_unknown_answer_without_calling_tools(
    chat_request: ChatRequest,
    monkeypatch: pytest.MonkeyPatch,
    redis_client: aioredis.Redis,
    ai_service: AIService,
) -> None:
    answer = "Не знаю точного ответа. Уточните вопрос у наставника."
    model_calls: list[tuple[list[dict], list[dict]]] = []

    async def stream_step(messages: list[dict], tools: list[dict]):
        model_calls.append((messages, tools))
        yield {"type": "token", "text": answer}

    monkeypatch.setattr(chat, "GenerationMCPClient", FakeMCPClient)
    monkeypatch.setattr(ai_service, "stream_step", stream_step)

    events = await run_and_read_events(chat_request, ai_service, redis_client)

    client = FakeMCPClient.instance
    assert client is not None
    assert len(model_calls) == 1
    assert model_calls[0][1] == client.get_tools_for_llm()
    assert client.call_args == []
    assert client.proposal_args == []
    assert [event["event"] for event in events] == ["token", "done"]
    assert [event["seq"] for event in events] == [1, 2]
    assert events[0]["data"]["text"] == answer
    assert events[-1]["data"]["full_text"] == answer


@pytest.mark.asyncio
async def test_mcp_client_initializes_and_fetches_tools(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    sessions = []

    class FakeSession:
        def __init__(self, read_stream, write_stream) -> None:
            self.initialized = False
            self.listed_tools = False
            sessions.append(self)

        async def __aenter__(self) -> "FakeSession":
            return self

        async def __aexit__(self, exc_type, exc_value, traceback) -> None:
            pass

        async def send_request(self, request, result_type):
            self.initialize_request = request
            self.initialized = True
            return SimpleNamespace(
                protocol_version=mcp_client.PROTOCOL_VERSION,
                capabilities=SimpleNamespace(tools=SimpleNamespace(listChanged=False)),
            )

        def adopt(self, result) -> None:
            self.adopted = True

        async def send_notification(self, notification) -> None:
            self.initialized_notification = notification

        async def list_tools(self):
            self.listed_tools = True
            return SimpleNamespace(
                tools=[
                    SimpleNamespace(
                        name="checklist.get_plan",
                        description="Получить план",
                        input_schema=TOOL_SCHEMA,
                        output_schema=TOOL_SCHEMA,
                    ),
                ],
            )

    captured_headers = {}

    @asynccontextmanager
    async def fake_streamable_http_client(url: str, http_client):
        captured_headers.update(http_client.headers)
        yield object(), object()

    monkeypatch.setattr(mcp_client, "ClientSession", FakeSession)
    monkeypatch.setattr(
        mcp_client,
        "streamable_http_client",
        fake_streamable_http_client,
    )

    async def publish_proposal(action_type: str, details: dict) -> None:
        return None

    client = mcp_client.GenerationMCPClient(
        request_id=str(REQUEST_ID),
        deadline_monotonic=time.monotonic() + 10,
        publish_action_proposal=publish_proposal,
        server_url="http://backend:8080/mcp",
        service_token="test-mcp-token",
    )
    async with client:
        assert sessions[0].initialized
        assert sessions[0].initialize_request.params.protocol_version == "2025-06-18"
        assert sessions[0].initialize_request.params.client_info.name == "ai-buddy-python"
        assert sessions[0].adopted
        assert sessions[0].initialized_notification.method == "notifications/initialized"
        assert sessions[0].listed_tools
        assert client.get_tools_for_llm()[0]["inputSchema"] == TOOL_SCHEMA

    assert captured_headers["authorization"] == "Bearer test-mcp-token"
    assert captured_headers["x-request-id"] == str(REQUEST_ID)


@pytest.mark.asyncio
async def test_mcp_write_call_requires_confirmation_without_publishing_proposal() -> None:
    proposals = []

    async def publish_proposal(action_type: str, details: dict) -> None:
        proposals.append((action_type, details))

    client = object.__new__(mcp_client.GenerationMCPClient)
    client.request_id = str(REQUEST_ID)
    client._session = object()
    client._tools_schemas = {
        "absences.create_request": {
            "inputSchema": TOOL_SCHEMA,
            "outputSchema": FAILURE_SCHEMA,
        },
    }
    client._format_checker = mcp_client.FormatChecker()
    client.publish_action_proposal = publish_proposal

    with pytest.raises(mcp_client.MCPContractError) as error:
        await client.call_tool("absences.create_request", {})

    assert error.value.code == "CONFIRMATION_REQUIRED"
    assert proposals == []

    failure = await client.propose_action("absences.create_request", {})
    assert failure["ok"] is False
    assert failure["error"]["code"] == "CONFIRMATION_REQUIRED"
    assert proposals == [("absences.create_request", {})]


@pytest.mark.asyncio
async def test_mcp_client_rejects_missing_structured_content() -> None:
    class FakeSession:
        async def call_tool(self, name: str, arguments: dict):
            return SimpleNamespace(
                structured_content=None,
                content=[SimpleNamespace(type="text", text='{"ok": true}')],
                is_error=False,
            )

    client = object.__new__(mcp_client.GenerationMCPClient)
    client._session = FakeSession()
    client.deadline_monotonic = time.monotonic() + 10
    client._format_checker = mcp_client.FormatChecker()

    with pytest.raises(mcp_client.MCPContractError) as error:
        await client._execute_read_call("checklist.get_plan", {}, TOOL_SCHEMA)

    assert error.value.code == "INTERNAL_ERROR"
    assert "structuredContent" in error.value.message


@pytest.mark.parametrize(
    ("status", "body", "expected_code", "retryable"),
    [
        (
            400,
            {"error": {"code": "UNSUPPORTED_PROTOCOL_VERSION"}},
            "UNSUPPORTED_PROTOCOL_VERSION",
            False,
        ),
        (404, None, "REQUEST_NOT_FOUND", False),
        (410, None, "REQUEST_CLOSED", False),
        (503, None, "CONTEXT_UNAVAILABLE", True),
    ],
)
def test_mcp_http_errors_follow_contract(
    status: int,
    body: dict | None,
    expected_code: str,
    retryable: bool,
) -> None:
    request = mcp_client.httpx2.Request("POST", "http://backend:8080/mcp")
    response = mcp_client.httpx2.Response(status, json=body, request=request)
    error = mcp_client.GenerationMCPClient._http_error(
        mcp_client.httpx2.HTTPStatusError(
            "HTTP failure",
            request=request,
            response=response,
        ),
    )

    assert error.code == expected_code
    assert error.retryable is retryable
