import os

import pytest
import pytest_asyncio
import redis.asyncio as aioredis
from httpx import ASGITransport, AsyncClient
from testcontainers.community.redis import RedisContainer

from config import get_settings
from core.ai_service import AIService
from main import app


@pytest_asyncio.fixture(scope="session", loop_scope="session")
def infra_containers():
    if os.getenv("TEST_INFRA_FROM_COMPOSE") == "1":
        yield {}
        return

    # Эти сценарии проверяют настоящий Redis, но подменяют ответы модели.
    with RedisContainer("redis:7-alpine") as redis:
        yield {"redis": redis}


@pytest_asyncio.fixture
async def ai_service():
    if os.getenv("TEST_INFRA_FROM_COMPOSE") != "1":
        pytest.fail("Запустите интеграционные тесты через docker-compose.test.yml")
    service = AIService()
    try:
        yield service
    finally:
        await service.llm_client.close()


@pytest_asyncio.fixture
async def redis_client(infra_containers):
    if os.getenv("TEST_INFRA_FROM_COMPOSE") == "1":
        settings = get_settings()
        client = aioredis.Redis.from_url(
            settings.redis_url,
            decode_responses=True,
        )
    else:
        redis_container = infra_containers["redis"]
        client = aioredis.Redis(
            host=redis_container.get_container_host_ip(),
            port=int(redis_container.get_exposed_port(6379)),
            decode_responses=True,
        )
    await client.ping()
    yield client
    await client.aclose()


@pytest_asyncio.fixture(scope="session", loop_scope="session")
async def client(infra_containers):
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        yield ac
