async def test_ollama_streaming_success(ai_service):
    prompt = "Сколько будет 2 + 2? Ответь только одной цифрой, без лишних слов."

    result_chunks = [
        chunk["text"]
        async for chunk in ai_service.stream_step([{"role": "user", "content": prompt}])
        if chunk["type"] == "token"
    ]

    assert len(result_chunks) > 0
