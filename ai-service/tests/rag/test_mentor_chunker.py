from app.rag.mentor_chunker import chunk_mentor_response


class Vector(list):
    def tolist(self):
        return list(self)


class MockEmbedder:
    def encode(self, texts, normalize_embeddings=True, **kwargs):
        if isinstance(texts, str):
            texts = [texts]
        return [Vector([0.0] * 768) for _ in texts]


def test_chunking_basic():
    text = (
        "Первое предложение здесь достаточно длинное. "
        "Второе предложение тоже очень длинное."
    )
    embedder = MockEmbedder()

    result = chunk_mentor_response(text, embedder)

    assert len(result) == 2
    assert "Первое" in result[0]["text"]
    assert "Второе" in result[1]["text"]
    assert len(result[0]["embedding"]) == 768
    assert result[0]["source_type"] == "mentor_answer"


def test_chunking_empty():
    embedder = MockEmbedder()
    result = chunk_mentor_response("", embedder)
    assert result == []


def test_chunking_short_sentences_filtered():
    text = "Hi. Bye. Hello world this is long enough sentence."
    embedder = MockEmbedder()
    result = chunk_mentor_response(text, embedder)

    assert len(result) == 1
    assert "Hello world" in result[0]["text"]
