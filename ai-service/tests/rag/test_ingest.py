import pytest

from app.rag.ingest import ingest
from app.rag.search import search
from app.rag.store import MemoryStore
from tests.rag.conftest import HashEmbedder


def test_ingest_replaces_seed_chunks_and_makes_them_searchable(kb_dir):
    embedder = HashEmbedder()
    store = MemoryStore()

    inserted = ingest(kb_dir, embedder, store, max_chars=800, overlap=80)
    results = search(
        "Как оформить отгул?",
        "team-a",
        embedder=embedder,
        store=store,
        min_score=0.35,
    )

    assert inserted > 0
    assert results
    assert "отгул" in results[0].doc_title.lower()


def test_ingest_rejects_empty_knowledge_directory(tmp_path):
    with pytest.raises(RuntimeError, match=r"\.md"):
        ingest(tmp_path, HashEmbedder(), MemoryStore(), max_chars=800, overlap=80)
