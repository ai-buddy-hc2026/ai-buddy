from fastapi import APIRouter

from config import RouteTags

core_router = APIRouter(tags=[RouteTags.HEALTH_TEST])


@core_router.get("/health")
async def health_check():
    return {"status": "healthy"}
