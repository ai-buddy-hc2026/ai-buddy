import json
import logging
import re
from types import SimpleNamespace

import httpx
import pytest
from openai import AsyncOpenAI

import core.ai_service as ai_module
from core.ai_service import AIService, LLMTimeoutError, LLMUnavailableError
from core.tool_names import ToolNameError, ToolNames

TOOLS = [
    {"name": name, "inputSchema": {"type": "object", "properties": {}}}
    for name in ("checklist.get_plan", "absences.create_request", "knowledge_search")
]


def service_with_transport(monkeypatch, respond):
    settings = SimpleNamespace(
        LLM_BASE_URL="https://llm.invalid/v1",
        LLM_API_KEY="sk-synthetic-private-key",
        LLM_MODEL="synthetic-model",
    )
    transport = httpx.AsyncClient(transport=httpx.MockTransport(respond))
    monkeypatch.setattr(ai_module, "get_settings", lambda: settings)
    monkeypatch.setattr(
        ai_module,
        "AsyncOpenAI",
        lambda **kw: AsyncOpenAI(**kw, http_client=transport),
    )
    return AIService()


def sse_response(*deltas):
    frames = [
        {
            "id": "synthetic-completion",
            "object": "chat.completion.chunk",
            "created": 0,
            "model": "synthetic-model",
            "choices": [{"index": 0, "delta": delta}],
        }
        for delta in deltas
    ]
    # Последний фрагмент с usage не содержит choices.
    frames.append({"id": "synthetic-completion", "choices": [], "usage": {}})
    content = "".join(f"data: {json.dumps(frame)}\n\n" for frame in frames)
    return httpx.Response(
        200,
        headers={"content-type": "text/event-stream"},
        content=content + "data: [DONE]\n\n",
    )


async def test_wire_tool_names_and_history_match_openai_contract(monkeypatch):
    requests = []

    def respond(request):
        body = json.loads(request.content)
        requests.append(body)
        names = [t["function"]["name"] for t in body["tools"]]
        assert names == [
            "checklist_get_plan",
            "absences_create_request",
            "knowledge_search",
        ]
        assert all(re.fullmatch(r"[a-zA-Z0-9_-]{1,64}", name) for name in names)
        for message in body["messages"]:
            for call in message.get("tool_calls", []):
                assert call["function"]["name"] in names
        if len(requests) == 1:
            return sse_response(
                {
                    "tool_calls": [
                        {
                            "index": 0,
                            "id": "call-1",
                            "type": "function",
                            "function": {"name": "checklist_", "arguments": "{"},
                        },
                    ],
                },
                {
                    "tool_calls": [
                        {
                            "index": 0,
                            "function": {"name": "get_plan", "arguments": "}"},
                        },
                    ],
                },
            )
        return sse_response({"content": "Synthetic answer"})

    service = service_with_transport(monkeypatch, respond)
    messages = [{"role": "user", "content": "Synthetic question"}]
    try:
        chunks = [chunk async for chunk in service.stream_step(messages, TOOLS)]
        name = "".join(chunk["tool_call"].function.name for chunk in chunks)
        arguments = "".join(chunk["tool_call"].function.arguments for chunk in chunks)
        assert ToolNames(TOOLS).for_mcp(name) == "checklist.get_plan"
        messages += [
            {
                "role": "assistant",
                "tool_calls": [
                    {
                        "id": "call-1",
                        "type": "function",
                        "function": {"name": name, "arguments": arguments},
                    },
                ],
            },
            {"role": "tool", "tool_call_id": "call-1", "content": "{}"},
        ]
        result = [chunk async for chunk in service.stream_step(messages, TOOLS)]
    finally:
        await service.llm_client.close()
    assert result == [{"type": "token", "text": "Synthetic answer"}]
    assert len(requests) == 2


@pytest.mark.parametrize(
    "names",
    [
        ["checklist.get_plan", "checklist_get_plan"],
        ["knowledge_search", "knowledge_search"],
        ["a" * 65],
        ["bad name"],
        [""],
        [None],
    ],
)
async def test_invalid_catalog_never_sends_http_request(monkeypatch, names):
    def respond(_request):
        pytest.fail("Некорректный каталог не должен передаваться модели")

    service = service_with_transport(monkeypatch, respond)
    try:
        with pytest.raises(ToolNameError):
            async for _ in service.stream_step([], [{"name": name} for name in names]):
                pass
    finally:
        await service.llm_client.close()


@pytest.mark.parametrize("status", [400, 401, 429, 503])
async def test_provider_error_is_safe_and_diagnosable(monkeypatch, caplog, status):
    def respond(request):
        return httpx.Response(
            status,
            request=request,
            headers={"x-request-id": "req-synthetic"},
            json={
                "error": {
                    "message": "private user text sk-synthetic-private-key",
                    "code": "invalid_tool_name",
                    "param": "tools[0].function.name",
                    "type": "invalid_request_error",
                },
            },
        )

    service = service_with_transport(monkeypatch, respond)
    with caplog.at_level(logging.WARNING, logger="core.ai_service"):
        try:
            with pytest.raises(LLMUnavailableError, match="LLM unavailable"):
                async for _ in service.stream_step([], TOOLS):
                    pass
        finally:
            await service.llm_client.close()
    assert f"status={status}" in caplog.text
    assert "invalid_tool_name" in caplog.text
    assert "tools[0].function.name" in caplog.text
    assert "req-synthetic" in caplog.text
    assert "private user text" not in caplog.text
    assert "sk-synthetic-private-key" not in caplog.text


async def test_stream_timeout_is_safe(monkeypatch, caplog):
    def respond(request):
        raise httpx.ReadTimeout("private timeout details", request=request)

    service = service_with_transport(monkeypatch, respond)
    with caplog.at_level(logging.WARNING, logger="core.ai_service"):
        try:
            with pytest.raises(LLMTimeoutError):
                async for _ in service.stream_step([], TOOLS):
                    pass
        finally:
            await service.llm_client.close()
    assert "status=None" in caplog.text
    assert "private timeout details" not in caplog.text
