"""Эмбеддинги. Модель по умолчанию: intfloat/multilingual-e5-base (768)."""

from __future__ import annotations

from functools import lru_cache
from typing import Protocol

from app.rag.settings import get_settings


class Embedder(Protocol):
    dim: int

    def embed_passages(self, texts: list[str]) -> list[list[float]]:
        """Эмбеддинги документов."""

    def embed_query(self, text: str) -> list[float]:
        """Эмбеддинг запроса."""


class E5Embedder:
    """Модели семейства e5 требуют префиксы 'passage: ' и 'query: '."""

    def __init__(self, model_name: str | None = None, dim: int | None = None):
        s = get_settings()
        self.model_name = model_name or s.model_name
        self.dim = dim or s.embedding_dim
        self._model = None

    def _load(self):
        if self._model is None:
            from sentence_transformers import SentenceTransformer

            self._model = SentenceTransformer(self.model_name)
        return self._model

    def _prefix(self, kind: str) -> str:
        return f"{kind}: " if "e5" in self.model_name.lower() else ""

    def _encode(self, texts: list[str]) -> list[list[float]]:
        vectors = self._load().encode(texts, normalize_embeddings=True, batch_size=16)
        result = [v.tolist() for v in vectors]
        if result and len(result[0]) != self.dim:
            raise ValueError(f"Размерность {len(result[0])}, ожидалась {self.dim}")
        return result

    def embed_passages(self, texts: list[str]) -> list[list[float]]:
        return self._encode([self._prefix("passage") + t for t in texts])

    def embed_query(self, text: str) -> list[float]:
        return self._encode([self._prefix("query") + text])[0]


@lru_cache(maxsize=1)
def get_embedder() -> E5Embedder:
    settings = get_settings()
    return E5Embedder(settings.model_name, settings.embedding_dim)
