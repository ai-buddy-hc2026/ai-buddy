import json
from types import SimpleNamespace
from unittest.mock import AsyncMock

import httpx
import pytest
from openai import APITimeoutError, AsyncOpenAI

import core.ai_service as ai_service_module
from core.ai_service import AIService, LLMTimeoutError, LLMUnavailableError


def service_with_response(content):
    create = AsyncMock(
        return_value=SimpleNamespace(
            choices=[SimpleNamespace(message=SimpleNamespace(content=content))],
        ),
    )
    service = AIService.__new__(AIService)
    service.settings = SimpleNamespace(LLM_MODEL="synthetic-model")
    service.llm_client = SimpleNamespace(
        chat=SimpleNamespace(completions=SimpleNamespace(create=create)),
    )
    return service, create


@pytest.mark.parametrize("category", ["task", "process", "access", "technical", "other"])
async def test_classify_question_returns_allowed_category(category):
    service, create = service_with_response(json.dumps({"category": category}))

    result = await service.classify_question("Synthetic question")

    assert result == category
    assert create.await_args.kwargs["response_format"] == {"type": "json_object"}
    assert create.await_args.kwargs["model"] == "synthetic-model"


@pytest.mark.parametrize("content", ["not-json", '{"category":"unknown"}', "{}"])
async def test_classify_question_falls_back_to_other_for_invalid_response(content):
    service, _create = service_with_response(content)

    assert await service.classify_question("Synthetic question") == "other"


async def test_classify_question_maps_timeout_to_safe_error():
    service, create = service_with_response("{}")
    request = httpx.Request("POST", "https://llm.invalid")
    create.side_effect = APITimeoutError(request=request)

    with pytest.raises(LLMTimeoutError):
        await service.classify_question("Synthetic question")


async def test_classify_question_requires_configured_client():
    service = AIService.__new__(AIService)
    service.llm_client = None

    with pytest.raises(LLMUnavailableError):
        await service.classify_question("Synthetic question")


async def test_ai_client_retries_transient_http_failure_once(monkeypatch):
    settings = SimpleNamespace(
        LLM_BASE_URL="https://llm.invalid/v1",
        LLM_API_KEY="synthetic-key",
        LLM_MODEL="synthetic-model",
    )
    attempts = 0

    def respond(request):
        nonlocal attempts
        attempts += 1
        if attempts == 1:
            return httpx.Response(
                500,
                request=request,
                json={"error": {"message": "synthetic temporary failure"}},
            )
        return httpx.Response(
            200,
            request=request,
            json={
                "id": "synthetic-completion",
                "object": "chat.completion",
                "created": 0,
                "model": "synthetic-model",
                "choices": [
                    {
                        "index": 0,
                        "message": {
                            "role": "assistant",
                            "content": '{"category":"access"}',
                        },
                        "finish_reason": "stop",
                    },
                ],
            },
        )

    http_client = httpx.AsyncClient(transport=httpx.MockTransport(respond))

    def client_factory(**kwargs):
        return AsyncOpenAI(**kwargs, http_client=http_client)

    monkeypatch.setattr(ai_service_module, "get_settings", lambda: settings)
    monkeypatch.setattr(ai_service_module, "AsyncOpenAI", client_factory)

    service = AIService()
    try:
        result = await service.classify_question("Synthetic access question")
    finally:
        await service.llm_client.close()

    assert attempts == 2
    assert result == "access"
