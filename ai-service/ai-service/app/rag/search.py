"""Поиск по базе знаний: top-k, порог похожести, фильтр по команде, источник."""
from __future__ import annotations

from dataclasses import dataclass

from .embeddings import Embedder
from .settings import get_settings
from .store import Store


@dataclass(frozen=True)
class SearchResult:
    text: str
    doc_title: str
    section: str
    score: float
    source: str  # seed | mentor_answer
    team_id: str | None

    @property
    def source_label(self) -> str:
        return f"{self.doc_title} / {self.section}"


def search(
    query: str,
    team_id: str | None,
    *,
    embedder: Embedder,
    store: Store,
    top_k: int | None = None,
    min_score: float | None = None,
) -> list[SearchResult]:
    """Пустой список означает «в базе нет ответа» (агент отвечает «не знаю»)."""
    s = get_settings()
    top_k = s.top_k if top_k is None else top_k
    min_score = s.min_score if min_score is None else min_score
    query = (query or "").strip()
    if not query:
        return []
    hits = store.query(embedder.embed_query(query), team_id, top_k)
    return [
        SearchResult(h.text, h.doc_title, h.section, h.score, h.source, h.team_id)
        for h in hits
        if h.score >= min_score
    ][:top_k]
