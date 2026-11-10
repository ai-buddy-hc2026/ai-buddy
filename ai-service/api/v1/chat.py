import hashlib
import json

import redis.asyncio as aioredis
from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, status

from config import RouteTags
from core.ai_service import AIService, get_ai_service
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


async def pubsub_publish(
    chat_data: ChatRequest,
    ai_service: AIService,
    redis: aioredis.Redis,
):
    channel_key = f"chat:{chat_data.request_id}"
    seq = 0
    try:
        full_text = ""
        async for chunk in ai_service.get_ai_stream(
            chat_data.message, [i.model_dump() for i in chat_data.history]
        ):
            full_text += chunk
            seq += 1
            event_token = TokenEvent(
                event="token",
                request_id=chat_data.request_id,
                seq=seq,
                data=TokenData(text=chunk),
            )
            await redis.publish(channel_key, event_token.model_dump_json())
        event_done = DoneEvent(
            event="done",
            request_id=chat_data.request_id,
            seq=seq + 1,
            data=DoneData(full_text=full_text, sources=[]),
        )
        await redis.publish(channel_key, event_done.model_dump_json())
        await redis.set(
            channel_key,
            json.dumps(
                {
                    "fingerprint": generate_fingerprint(chat_data),
                    "state": "completed",
                }
            ),
            ex=600,
        )

    except Exception:
        event_error = ErrorEvent(
            event="error",
            request_id=chat_data.request_id,
            seq=seq + 1,
            data=ErrorData(
                code="INTERNAL_ERROR",
                message="Не удалось завершить генерацию ответа.",
            ),
        )
        await redis.publish(channel_key, event_error.model_dump_json())
        await redis.set(
            channel_key,
            json.dumps(
                {
                    "fingerprint": generate_fingerprint(chat_data),
                    "state": "failed",
                    "error": "INTERNAL_ERROR",
                },
            ),
            ex=600,
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
