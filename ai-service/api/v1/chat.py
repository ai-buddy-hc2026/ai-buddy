import asyncio
import hashlib
import json
import logging
from typing import Literal

import redis.asyncio as aioredis
from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, status
from openai import APITimeoutError, OpenAIError
from redis.exceptions import RedisError

from config import RouteTags
from core.ai_service import AIService, LLMUnavailableError, get_ai_service
from core.dependencies import get_redis
from core.security import verify_token
from schemas.chat import ChatRequest, ChatResponse
from schemas.event import (
    DoneData,
    DoneEvent,
    ErrorData,
    ErrorEvent,
    TokenData,
    TokenEvent,
)

chat_router = APIRouter(tags=[RouteTags.CHAT_ROUTER])


def generate_fingerprint(data: ChatRequest) -> str:
    payload = json.dumps(
        data.model_dump(mode="json"),
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    )
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


GENERATION_TIMEOUT_SECONDS = 60
MAX_RESPONSE_CHARACTERS = 20_000
logger = logging.getLogger(__name__)


async def pubsub_publish(
    chat_data: ChatRequest,
    ai_service: AIService,
    redis: aioredis.Redis,
) -> None:
    channel_key = f"chat:{chat_data.request_id}"
    seq = 0
    parts: list[str] = []
    characters = 0
    state = "failed"
    error_code = "INTERNAL_ERROR"
    stream = ai_service.get_ai_stream(
        chat_data.message,
        [item.model_dump() for item in chat_data.history],
    )
    try:
        async with asyncio.timeout(GENERATION_TIMEOUT_SECONDS):
            async for chunk in stream:
                if not chunk:
                    continue
                characters += len(chunk)
                if characters > MAX_RESPONSE_CHARACTERS:
                    raise ValueError("response limit exceeded")
                parts.append(chunk)
                event = TokenEvent(
                    event="token",
                    request_id=chat_data.request_id,
                    seq=seq + 1,
                    data=TokenData(text=chunk),
                )
                await redis.publish(channel_key, event.model_dump_json())
                seq += 1
            full_text = "".join(parts)
            if not full_text:
                raise ValueError("empty response without action proposal")
            event_done = DoneEvent(
                event="done",
                request_id=chat_data.request_id,
                seq=seq + 1,
                data=DoneData(full_text=full_text, sources=[]),
            )
            await redis.publish(channel_key, event_done.model_dump_json())
            state = "completed"
    except RedisError:
        # Потерянную публикацию нельзя восстанавливать новым событием с тем же seq.
        logger.warning("Redis publication failed; Go deadline completes the request")
    except Exception as error:
        error_code: Literal["LLM_TIMEOUT", "LLM_UNAVAILABLE", "INTERNAL_ERROR"]
        if isinstance(error, (APITimeoutError, TimeoutError)):
            error_code = "LLM_TIMEOUT"
            message = "Превышено время ожидания ответа от языковой модели."
        elif isinstance(error, (OpenAIError, LLMUnavailableError)):
            error_code = "LLM_UNAVAILABLE"
            message = "Ассистент временно недоступен."
        else:
            error_code = "INTERNAL_ERROR"
            message = "Не удалось завершить генерацию ответа."
        event_error = ErrorEvent(
            event="error",
            request_id=chat_data.request_id,
            seq=seq + 1,
            data=ErrorData(code=error_code, message=message),
        )
        try:
            await redis.publish(channel_key, event_error.model_dump_json())
        except RedisError:
            logger.warning("Redis error publication failed")
    finally:
        close = getattr(stream, "aclose", None)
        if close is not None:
            try:
                await close()
            except Exception:
                logger.warning("LLM stream cleanup failed")
        final_state = {
            "fingerprint": generate_fingerprint(chat_data),
            "state": state,
        }
        if state == "failed":
            final_state["error"] = error_code
        try:
            await redis.set(channel_key, json.dumps(final_state), ex=600)
        except RedisError:
            logger.warning("Redis generation state could not be saved")


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
