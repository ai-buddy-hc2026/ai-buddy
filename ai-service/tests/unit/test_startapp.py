from fastapi import status
from httpx import AsyncClient


async def test_echo(client: AsyncClient):
    res = await client.get("/health")
    assert res.status_code == status.HTTP_200_OK
