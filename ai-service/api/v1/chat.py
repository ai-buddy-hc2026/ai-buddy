import asyncio
import hashlib
import json
import logging
import time
from collections.abc import Mapping
from typing import Any

import redis.asyncio as aioredis
from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, status
from openai import APITimeoutError, OpenAIError
from redis.exceptions import RedisError

from app.agent.context import UserContext
from app.agent.knowledge_tool import MCP_NAME as KNOWLEDGE_MCP_NAME
from app.agent.knowledge_tool import OPENAI_NAME as KNOWLEDGE_TOOL_NAME
from app.agent.knowledge_tool import (
    TOOL_DEFINITION as KNOWLEDGE_TOOL_DEFINITION,
)
from app.agent.knowledge_tool import extract_citations, run_knowledge_search
from app.agent.prompts import build_system_prompt
from app.agent.unknown import is_explicit_unknown_answer, unknown_answer_text
from app.rag.runtime import ensure_kb_indexed, get_rag_resources
from config import RouteTags
from core.ai_service import (
    AIService,
    LLMTimeoutError,
    LLMUnavailableError,
    get_ai_service,
)
from core.dependencies import get_redis
from core.security import verify_token
from integrations.mcp_client import (
    WRITE_TOOLS,
    GenerationMCPClient,
    MCPContractError,
)
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


async def _search_knowledge(arguments: dict[str, Any], context: UserContext) -> dict:
    try:
        await ensure_kb_indexed()
        embedder, store = get_rag_resources()
        return await asyncio.to_thread(
            run_knowledge_search,
            arguments,
            context,
            embedder=embedder,
            store=store,
        )
    except Exception as exc:
        logger.error(
            "KB-поиск недоступен; details hidden error_type=%s",
            type(exc).__name__,
        )
        raise MCPContractError(
            "DEPENDENCY_UNAVAILABLE",
            "Не удалось выполнить поиск по базе знаний",
            retryable=False,
        ) from exc


def _knowledge_tool() -> dict[str, Any]:
    function = KNOWLEDGE_TOOL_DEFINITION["function"]
    return {
        "name": function["name"],
        "description": function["description"],
        "inputSchema": function["parameters"],
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
    proposal_count = 0
    state, error_code = "failed", "INTERNAL_ERROR"
    full_text = ""
    answer_status = "answered"
    question_category = "other"
    sources: dict[str, dict[str, Any]] = {}
    knowledge_result: dict[str, Any] | None = None
    deadline = time.monotonic() + GENERATION_TIMEOUT_SECONDS
    context = UserContext.from_payload(chat_data.model_dump(mode="json"))
    messages = [{"role": "system", "content": build_system_prompt(context)}]
    messages.extend(item.model_dump() for item in chat_data.history)
    messages.append({"role": "user", "content": chat_data.message})

    async def publish_event(event: Any) -> None:
        await redis.publish(channel_key, event.model_dump_json())

    async def publish_proposal(
        action_type: str,
        details: dict[str, Any],
    ) -> None:
        nonlocal seq, proposal_count
        seq += 1
        await publish_event(
            ActionProposalEventFromPython(
                event="action_proposal",
                request_id=chat_data.request_id,
                seq=seq,
                data=ActionProposalData(action_type=action_type, details=details),
            ),
        )

        proposal_count += 1

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

    async def generate() -> None:
        nonlocal seq, full_text, answer_status, knowledge_result
        if ai_service.llm_client is None:
            raise LLMUnavailableError("LLM_API_KEY is not configured")

        async with GenerationMCPClient(
            request_id=str(chat_data.request_id),
            deadline_monotonic=deadline,
            publish_action_proposal=publish_proposal,
        ) as mcp:
            tools = [
                tool
                for tool in mcp.get_tools_for_llm()
                if tool["name"] != KNOWLEDGE_MCP_NAME
            ]
            tools.append(_knowledge_tool())
            tool_rounds = 0
            no_answer_from_kb = False

            while True:
                tool_calls: dict[int, dict[str, str]] = {}
                step_text = ""

                stream = ai_service.stream_step(messages, tools)
                try:
                    async for chunk in stream:
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
                                ),
                            )
                        elif chunk["type"] == "tool_call_delta":
                            _append_tool_call_delta(tool_calls, chunk["tool_call"])
                        else:
                            raise ValueError("Неизвестный тип фрагмента ответа модели")

                finally:
                    close = getattr(stream, "aclose", None)
                    if close is not None:
                        try:
                            await close()
                        except Exception:
                            logger.warning("Не удалось закрыть поток LLM")

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
                        },
                    )
                    event_tool_name = (
                        KNOWLEDGE_MCP_NAME
                        if call["name"] == KNOWLEDGE_TOOL_NAME
                        else call["name"]
                    )
                    seq += 1
                    await publish_event(
                        ToolCallEvent(
                            event="tool_call",
                            request_id=chat_data.request_id,
                            seq=seq,
                            data=ToolCallData(
                                tool_name=event_tool_name,
                                arguments=arguments,
                            ),
                        ),
                    )

                    if call["name"] == KNOWLEDGE_TOOL_NAME:
                        knowledge_result = await _search_knowledge(arguments, context)
                        no_answer_from_kb = knowledge_result.get("status") == "no_answer"
                        result = knowledge_result
                    elif call["name"] in WRITE_TOOLS:
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
                                },
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
                        },
                    )

                messages.append(
                    {
                        "role": "assistant",
                        "content": step_text or None,
                        "tool_calls": assistant_tool_calls,
                    },
                )
                messages.extend(tool_results)

                if no_answer_from_kb and proposal_count == 0:
                    full_text = unknown_answer_text(context.role)
                    answer_status = "unknown"
                    seq += 1
                    await publish_event(
                        TokenEvent(
                            event="token",
                            request_id=chat_data.request_id,
                            seq=seq,
                            data=TokenData(text=full_text),
                        ),
                    )
                    break

    try:
        async with asyncio.timeout(max(0, deadline - time.monotonic())):
            await generate()
            if not full_text and not proposal_count:
                raise ValueError("Пустой ответ без предложения действия")
            if knowledge_result and knowledge_result.get("status") == "found":
                full_text, found_sources = extract_citations(full_text, knowledge_result)
                sources.update(
                    (source["document_id"], source)
                    for source in found_sources
                    if source.get("document_id")
                )
        if is_explicit_unknown_answer(full_text):
            answer_status = "unknown"
        elif answer_status != "unknown":
            answer_status = "answered"
        classify_question = getattr(ai_service, "classify_question", None)
        if classify_question is not None:
            try:
                async with asyncio.timeout(3.0):
                    question_category = await classify_question(chat_data.message)
                if question_category not in {
                    "task",
                    "process",
                    "access",
                    "technical",
                    "other",
                }:
                    question_category = "other"
            except Exception as error:
                logger.warning(
                    "Не удалось определить категорию вопроса request_id=%s error_type=%s",
                    chat_data.request_id,
                    type(error).__name__,
                )
                question_category = "other"
        seq += 1
        await publish_event(
            DoneEvent(
                event="done",
                request_id=chat_data.request_id,
                seq=seq,
                data=DoneData(
                    full_text=full_text,
                    sources=list(sources.values()),
                    answer_status=answer_status,
                    question_category=question_category,
                ),
            ),
        )
        state = "completed"
    except RedisError:
        # После потери публикации Go завершит запрос по своему дедлайну.
        logger.warning("Не удалось опубликовать событие в Redis")
    except Exception as error:
        if isinstance(error, (LLMTimeoutError, APITimeoutError, TimeoutError)):
            error_code = "LLM_TIMEOUT"
            message = "Превышено время ожидания ответа от языковой модели."
        elif isinstance(error, (LLMUnavailableError, OpenAIError)):
            error_code = "LLM_UNAVAILABLE"
            message = "Ассистент временно недоступен."
        elif isinstance(error, MCPContractError):
            error_code = "TOOL_FAILED"
            message = "Не удалось получить или выполнить инструмент."
        else:
            error_code = "INTERNAL_ERROR"
            message = "Не удалось завершить генерацию ответа."
            logger.error(
                "Ошибка генерации request_id=%s error_type=%s",
                chat_data.request_id,
                type(error).__name__,
            )
        try:
            await publish_error(error_code, message)
        except RedisError:
            logger.warning("Не удалось опубликовать ошибку в Redis")
    finally:
        final_state = {
            "fingerprint": generate_fingerprint(chat_data),
            "state": state,
        }
        if state == "failed":
            final_state["error"] = error_code
        try:
            await redis.set(channel_key, json.dumps(final_state), ex=600)
        except RedisError:
            logger.warning("Не удалось сохранить состояние генерации в Redis")


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

    initial_state = json.dumps({"fingerprint": fingerprint, "state": "generating"})
    try:
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
    except (RedisError, ValueError, TypeError) as error:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="generation registry unavailable",
        ) from error

    background_tasks.add_task(pubsub_publish, chat_data, ai_service, redis)

    return ChatResponse(
        request_id=chat_data.request_id,
        accepted=True,
        duplicate=False,
    )
