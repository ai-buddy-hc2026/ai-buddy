import os

import pytest_asyncio
import redis.asyncio as aioredis
import requests
from httpx import ASGITransport, AsyncClient
from testcontainers.community.postgres import PostgresContainer
from testcontainers.community.redis import RedisContainer
from testcontainers.core.container import DockerContainer
from testcontainers.core.wait_strategies import LogMessageWaitStrategy

from config import get_settings
from core.ai_service import AIService
from main import app


@pytest_asyncio.fixture(scope="session", loop_scope="session")
def infra_containers():
    if os.getenv("TEST_INFRA_FROM_COMPOSE") == "1":
        yield {}
        return

    ollama_container = (
        DockerContainer("ollama/ollama:latest")
        .with_exposed_ports(11434)
        .waiting_for(LogMessageWaitStrategy("Listening on "))
    )

    with (
        PostgresContainer("ankane/pgvector:latest") as postgres,
        RedisContainer("redis:7-alpine") as redis,
        ollama_container as ollama,
    ):
        postgres_url = postgres.get_connection_url(driver="asyncpg")
        redis_host = redis.get_container_host_ip()
        redis_port = redis.get_exposed_port(6379)
        ollama_url = (
            f"http://{ollama.get_container_host_ip()}:"
            f"{ollama.get_exposed_port(11434)}"
        )

        test_model = "DeepSeek-R1:1.5b"
        response = requests.post(
            f"{ollama_url}/api/pull",
            json={"name": test_model, "stream": False},
            timeout=300,
        )
        response.raise_for_status()
        settings = get_settings()
        settings.POSTGRES_URL = postgres_url
        settings.REDIS_HOST = redis_host
        settings.REDIS_PORT = int(redis_port)
        settings.LLM_PROVIDER = "ollama"
        settings.LLM_BASE_URL = f"{ollama_url}/v1"
        settings.LLM_MODEL = test_model
        settings.LLM_API_KEY = "ollama"

        yield {
            "postgres": postgres,
            "redis": redis,
            "ollama": ollama,
        }


@pytest_asyncio.fixture(scope="session", loop_scope="session")
async def ai_service(infra_containers):
    return AIService()


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
