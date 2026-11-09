import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from testcontainers.postgres import PostgresContainer
from testcontainers.redis import RedisContainer

from config import get_settings
from main import app


@pytest_asyncio.fixture(scope="session", loop_scope="session")
def test_environment():
    with PostgresContainer("ankane/pgvector:latest") as postgres, RedisContainer(
        "redis:7-alpine",
    ) as redis:
        # на будущее postgres_url = postgres.get_connection_url(driver="asyncpg")
        redis_host = redis.get_container_host_ip()
        redis_port = redis.get_exposed_port(6379)
        get_settings(
            REDIS_HOST=redis_host,
            REDIS_PORT=int(redis_port),
        )

        yield {"postgres": postgres, "redis": redis}


@pytest_asyncio.fixture(scope="session", loop_scope="session")
async def client(test_environment):

    transport = ASGITransport(app=app)

    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        yield ac
