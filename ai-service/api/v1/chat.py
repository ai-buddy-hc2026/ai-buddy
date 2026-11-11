import asyncio
import hashlib
import json
import logging
import time
from collections.abc import Mapping
from typing import Any

import redis.asyncio as aioredis
from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, status

from config import RouteTags
from core.ai_service import (
    AIService,
    LLMTimeoutError,
    LLMUnavailableError,
    get_ai_service,
)
from core.dependencies import get_redis
from core.security import verify_token
from integrations.mcp_client import GenerationMCPClient, MCPContractError, WRITE_TOOLS
from schemas.chat import ChatRequest, ChatResponse
from schemas.event import (
    ActionProposalData,
    ActionProposalEventFromPython,
    DoneData,
    DoneEvent,
    ErrorData,
    ErrorEvent,
    TokenData,
    TokenEvent,
    ToolCallData,
    ToolCallEvent,
)

chat_router = APIRouter(tags=[RouteTags.CHAT_ROUTER])
logger = logging.getLogger(__name__)

GENERATION_TIMEOUT_SECONDS = 60.0
MAX_TOOL_ROUNDS = 8
MAX_RESPONSE_LENGTH = 20_000
EXPECTED_TOOL_ERRORS = {
    "CONFLICT",
    "CONFIRMATION_REQUIRED",
    "IDEMPOTENCY_CONFLICT",
    "INVALID_ARGUMENT",
    "NOT_FOUND",
    "POLICY_DENIED",
    "VERSION_CONFLICT",
}


def _get_field(value: Any, name: str, default: Any = None) -> Any:
    if isinstance(value, Mapping):
        return value.get(name, default)
    return getattr(value, name, default)


def _append_tool_call_delta(
    calls: dict[int, dict[str, str]],
    delta: Any,
) -> None:
    single_call = _get_field(delta, "tool_call")
    if single_call is not None:
        items = (single_call,)
    else:
        tool_calls = _get_field(delta, "tool_calls")
        items = (delta,) if tool_calls is None else tool_calls

    for item in items:
        index = _get_field(item, "index", 0)
        if not isinstance(index, int) or index < 0:
            raise ValueError("Некорректный индекс вызова инструмента")

        call = calls.setdefault(index, {"id": "", "name": "", "arguments": ""})
        call_id = _get_field(item, "id")
        function = _get_field(item, "function")
        name = _get_field(function, "name")
        arguments = _get_field(function, "arguments")

        if call_id:
            call["id"] = str(call_id)
        if name:
            call["name"] += str(name)
        if arguments:
            call["arguments"] += str(arguments)


def generate_fingerprint(data: ChatRequest) -> str:
    payload = json.dumps(
        data.model_dump(mode="json"),
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    )
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


async def pubsub_publish(
    chat_data: ChatRequest,
    ai_service: AIService,
    redis: aioredis.Redis,
) -> None:
    channel_key = f"chat:{chat_data.request_id}"
    seq = 0
    full_text = ""
    deadline = time.monotonic() + GENERATION_TIMEOUT_SECONDS
    messages = [item.model_dump() for item in chat_data.history]
    messages.append({"role": "user", "content": chat_data.message})

    async def publish_event(event: Any) -> None:
        await redis.publish(channel_key, event.model_dump_json())

    async def publish_proposal(
        action_type: str,
        details: dict[str, Any],
    ) -> None:
        nonlocal seq
        seq += 1
        await publish_event(
            ActionProposalEventFromPython(
                event="action_proposal",
                request_id=chat_data.request_id,
                seq=seq,
                data=ActionProposalData(action_type=action_type, details=details),
            )
        )

    async def publish_error(code: str, message: str) -> None:
        nonlocal seq
        seq += 1
        event_error = ErrorEvent(
            event="error",
            request_id=chat_data.request_id,
            seq=seq,
            data=ErrorData(code=code, message=message),
        )
        await publish_event(event_error)
        await redis.set(
            channel_key,
            json.dumps(
                {
                    "fingerprint": generate_fingerprint(chat_data),
                    "state": "failed",
                    "error": code,
                },
            ),
            ex=600,
        )

    try:
        if ai_service.llm_client is None:
            raise LLMUnavailableError("LLM_API_KEY is not configured")

        async with GenerationMCPClient(
            request_id=str(chat_data.request_id),
            deadline_monotonic=deadline,
            publish_action_proposal=publish_proposal,
        ) as mcp:
            tools = mcp.get_tools_for_llm()
            tool_rounds = 0

            while True:
                tool_calls: dict[int, dict[str, str]] = {}
                step_text = ""

                async with asyncio.timeout(max(0, deadline - time.monotonic())):
                    async for chunk in ai_service.stream_step(messages, tools):
                        if chunk["type"] == "token":
                            text = chunk["text"]
                            if len(full_text) + len(text) > MAX_RESPONSE_LENGTH:
                                raise ValueError("Превышен максимальный размер ответа")
                            full_text += text
                            step_text += text
                            seq += 1
                            await publish_event(
                                TokenEvent(
                                    event="token",
                                    request_id=chat_data.request_id,
                                    seq=seq,
                                    data=TokenData(text=text),
                                )
                            )
                        elif chunk["type"] == "tool_call_delta":
                            _append_tool_call_delta(tool_calls, chunk["tool_call"])
                        else:
                            raise ValueError("Неизвестный тип фрагмента ответа модели")

                if not tool_calls:
                    break
                if tool_rounds >= MAX_TOOL_ROUNDS:
                    raise MCPContractError(
                        "INTERNAL_ERROR",
                        "Превышено максимальное число вызовов инструментов",
                    )

                tool_rounds += 1
                assistant_tool_calls = []
                tool_results = []
                for _, call in sorted(tool_calls.items()):
                    if not call["id"] or not call["name"]:
                        raise MCPContractError(
                            "INVALID_ARGUMENT",
                            "Модель вернула неполный вызов инструмента",
                        )
                    raw_arguments = call["arguments"] or "{}"
                    try:
                        arguments = json.loads(raw_arguments)
                    except json.JSONDecodeError as exc:
                        raise MCPContractError(
                            "INVALID_ARGUMENT",
                            "Модель вернула некорректные аргументы инструмента",
                        ) from exc
                    if not isinstance(arguments, dict):
                        raise MCPContractError(
                            "INVALID_ARGUMENT",
                            "Аргументы инструмента должны быть объектом",
                        )

                    assistant_tool_calls.append(
                        {
                            "id": call["id"],
                            "type": "function",
                            "function": {
                                "name": call["name"],
                                "arguments": raw_arguments,
                            },
                        }
                    )
                    seq += 1
                    await publish_event(
                        ToolCallEvent(
                            event="tool_call",
                            request_id=chat_data.request_id,
                            seq=seq,
                            data=ToolCallData(
                                tool_name=call["name"],
                                arguments=arguments,
                            ),
                        )
                    )

                    if call["name"] in WRITE_TOOLS:
                        result = await mcp.propose_action(call["name"], arguments)
                    else:
                        try:
                            result = await mcp.call_tool(call["name"], arguments)
                        except MCPContractError as error:
                            if error.code not in EXPECTED_TOOL_ERRORS:
                                raise
                            result = {
                                "error": {
                                    "code": error.code,
                                    "message": error.message,
                                    "retryable": error.retryable,
                                }
                            }
                    if result.get("ok") is False:
                        result = {
                            "error": result["error"],
                        }

                    tool_results.append(
                        {
                            "role": "tool",
                            "tool_call_id": call["id"],
                            "content": json.dumps(result, ensure_ascii=False),
                        }
                    )

                messages.append(
                    {
                        "role": "assistant",
                        "content": step_text or None,
                        "tool_calls": assistant_tool_calls,
                    }
                )
                messages.extend(tool_results)

        seq += 1
        await publish_event(
            DoneEvent(
                event="done",
                request_id=chat_data.request_id,
                seq=seq,
                data=DoneData(full_text=full_text, sources=[]),
            )
        )
        await redis.set(
            channel_key,
            json.dumps(
                {
                    "fingerprint": generate_fingerprint(chat_data),
                    "state": "completed",
                },
            ),
            ex=600,
        )
    except LLMTimeoutError:
        await publish_error(
            "LLM_TIMEOUT",
            "Превышено время ожидания ответа от языковой модели.",
        )
    except LLMUnavailableError:
        await publish_error("LLM_UNAVAILABLE", "Ассистент временно недоступен.")
    except TimeoutError:
        await publish_error(
            "LLM_TIMEOUT",
            "Превышено время ожидания ответа от языковой модели.",
        )
    except MCPContractError:
        await publish_error(
            "TOOL_FAILED",
            "Не удалось получить или выполнить инструмент.",
        )
    except Exception as error:
        logger.error(
            "Ошибка генерации request_id=%s error_type=%s",
            chat_data.request_id,
            type(error).__name__,
        )
        await publish_error(
            "INTERNAL_ERROR",
            "Не удалось завершить генерацию ответа.",
        )


@chat_router.post("/chat", status_code=status.HTTP_202_ACCEPTED)
async def get_chat_state(
    background_tasks: BackgroundTasks,
    chat_data: ChatRequest,
    ai_service_token: str = Depends(verify_token),
    redis: aioredis.Redis = Depends(get_redis),
    ai_service: AIService = Depends(get_ai_service),
) -> ChatResponse:
    channel_key = f"chat:{chat_data.request_id}"
    fingerprint = generate_fingerprint(chat_data)

    initial_state = json.dumps({"fingerprint": fingerprint, "state": "pending"})
    is_new = await redis.set(channel_key, initial_state, nx=True, ex=600)

    if not is_new:
        raw_data = await redis.get(channel_key)
        if raw_data:
            cached_data = json.loads(raw_data)
            if cached_data.get("fingerprint") == fingerprint:
                return ChatResponse(
                    request_id=chat_data.request_id,
                    accepted=True,
                    duplicate=True,
                )
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="request_id in use with different data",
        )
    await redis.set(
        channel_key,
        json.dumps({"fingerprint": fingerprint, "state": "generating"}),
        ex=600,
    )

    background_tasks.add_task(pubsub_publish, chat_data, ai_service, redis)

    return ChatResponse(
        request_id=chat_data.request_id,
        accepted=True,
        duplicate=False,
    )
