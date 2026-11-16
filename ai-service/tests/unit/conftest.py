from unittest.mock import AsyncMock

import pytest
import pytest_asyncio

from api.v1 import chat
from config import get_settings
from core.ai_service import AIService


@pytest_asyncio.fixture
async def ai_service(monkeypatch: pytest.MonkeyPatch):
    settings = get_settings()
    monkeypatch.setattr(settings, "LLM_BASE_URL", "https://llm.invalid/v1")
    monkeypatch.setattr(settings, "LLM_MODEL", "synthetic-model")
    monkeypatch.setattr(settings, "LLM_API_KEY", "synthetic-key")
    service = AIService()
    monkeypatch.setattr(service, "classify_question", AsyncMock(return_value="other"))
    try:
        yield service
    finally:
        await service.llm_client.close()


@pytest.fixture(autouse=True)
def mcp_client_without_go(monkeypatch: pytest.MonkeyPatch) -> None:
    class EmptyMCPClient:
        def __init__(self, **kwargs) -> None:
            pass

        async def __aenter__(self) -> "EmptyMCPClient":
            return self

        async def __aexit__(self, exc_type, exc_value, traceback) -> None:
            pass

        def get_tools_for_llm(self) -> list[dict]:
            return []

    monkeypatch.setattr(chat, "GenerationMCPClient", EmptyMCPClient)
