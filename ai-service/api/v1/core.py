from fastapi import APIRouter

from api.v1.chat import chat_router
from config import RouteTags

core_router = APIRouter(tags=[RouteTags.HEALTH_TEST])
core_router.include_router(chat_router)


@core_router.get("/health")
async def health_check():
    return {"status": "healthy"}
