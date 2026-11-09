from unittest.mock import MagicMock

import pytest

from core.ai_service import AIService


@pytest.mark.asyncio
async def test_ollama_streaming_logic(mocker):
    chunk1 = MagicMock()
    chunk1.choices = [MagicMock(delta=MagicMock(content="Тест"))]

    chunk2 = MagicMock()
    chunk2.choices = [MagicMock(delta=MagicMock(content=" соединения"))]

    chunk3 = MagicMock()
    chunk3.choices = [MagicMock(delta=MagicMock(content=" выполнен"))]

    mock_stream = [chunk1, chunk2, chunk3]

    async def mock_acreate(*args, **kwargs):
        for chunk in mock_stream:
            yield chunk

    mocker.patch(
        "openai.resources.chat.completions.Completions.create",
        side_effect=mock_acreate,
    )
    service = AIService()
    result = []

    async for token in service.get_ai_stream("Check"):
        result.append(token)
    assert result == ["Тест", " соединения", " выполнен"]
