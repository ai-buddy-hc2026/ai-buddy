import pytest

from api.v1 import chat


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
