import pytest

from app.rag.ingest import (
    ingest,
    ingest_published_answers,
    ingest_seed_documents,
)
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


def test_seed_ingest_indexes_team_scoped_document_revisions(kb_dir, embedder):
    class RecordingPgStore:
        teams = ["team-a", "team-b"]

        def __init__(self):
            self.documents = []
            self.indexes = []

        def active_team_ids(self):
            return self.teams

        def prepare_seed_document(self, team_id, slug, title, content):
            self.documents.append((team_id, slug, title, content))
            return f"{team_id}-{slug}", 2

        def replace_document_chunks(self, document_id, team_id, revision, slug, rows):
            self.indexes.append((document_id, team_id, revision, slug, rows))

    store = RecordingPgStore()
    count = ingest_seed_documents(kb_dir, embedder, store, max_chars=800, overlap=80)

    assert count > 0
    assert len(store.documents) == len(list(kb_dir.glob("*.md"))) * 2
    assert len(store.indexes) == len(store.documents)
    assert all(index[1] in store.teams and index[2] == 2 for index in store.indexes)
    assert all(
        row.document_id == index[0] and row.revision == 2
        for index in store.indexes
        for row in index[4]
    )


def test_published_answer_is_indexed_once_per_revision(embedder):
    class AnswerStore:
        revision = 1
        indexed_revision = None

        def unindexed_answers(self, team_id):
            assert team_id == "team-a"
            if self.indexed_revision == self.revision:
                return []
            return [
                (
                    "doc-1",
                    team_id,
                    self.revision,
                    "buddy-answer",
                    "# Ответ\n\nНаставник объяснил процесс.",
                ),
            ]

        def replace_document_chunks(self, document_id, team_id, revision, slug, rows):
            assert document_id == "doc-1" and team_id == "team-a"
            assert rows and all(row.revision == revision for row in rows)
            self.indexed_revision = revision

    store = AnswerStore()
    assert ingest_published_answers("team-a", embedder, store) > 0
    assert ingest_published_answers("team-a", embedder, store) == 0
    store.revision = 2
    assert ingest_published_answers("team-a", embedder, store) > 0
