from fastapi import APIRouter, Depends
from config import RouteTags
import redis.asyncio as aioredis
from core.dependencies import get_redis
from core.security import verify_token
chat_router = APIRouter(tags=[RouteTags.CHAT_ROUTER])


@chat_router.post("/chat")
async def create_chat(
    ai_service_token: str = Depends(verify_token),
    redis: aioredis.Redis = Depends(get_redis),
):