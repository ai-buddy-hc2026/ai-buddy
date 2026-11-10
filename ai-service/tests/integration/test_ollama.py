async def test_ollama_streaming_success(ai_service):
    prompt = "Сколько будет 2 + 2? Ответь только одной цифрой, без лишних слов."

    result_chunks = [token async for token in ai_service.get_ai_stream(prompt)]

    assert len(result_chunks) > 0
