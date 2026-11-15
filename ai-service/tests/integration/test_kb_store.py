"""Проверка SQL RAG на настоящих таблицах, созданных миграциями Go."""

import os
from uuid import uuid4

import pytest

from app.rag.store import ChunkRow, PgStore
from config import get_settings

pytestmark = pytest.mark.skipif(
    os.getenv("TEST_INFRA_FROM_COMPOSE") != "1",
    reason="Нужна БД из docker-compose.test.yml с миграциями Go",
)


def test_rag_store_matches_go_schema_and_preserves_team_scope():
    store = PgStore(get_settings().POSTGRES_URL)
    teams = store.active_team_ids()
    assert len(teams) >= 2
    # Даже пустая очередь должна успешно выполняться на схеме Go.
    assert isinstance(store.unindexed_answers(teams[0]), list)

    slug = "integration-store-" + uuid4().hex
    document_id, revision = store.prepare_seed_document(
        teams[0],
        slug,
        "Synthetic storage test",
        "Synthetic passage",
    )
    vector = [1.0] + [0.0] * 767
    try:
        assert all(
            hit.document_id != document_id for hit in store.query(vector, teams[0], 100)
        )
        row = ChunkRow(
            "Synthetic storage test",
            "Test",
            "Synthetic passage",
            vector,
            teams[0],
            document_id,
            revision,
        )
        store.replace_document_chunks(document_id, teams[0], revision, slug, [row])
        own_hits = store.query(vector, teams[0], 100)
        own = next(hit for hit in own_hits if hit.document_id == document_id)
        assert own.revision == revision
        assert own.slug == slug
        assert own.text == "Synthetic passage"
        assert all(
            hit.document_id != document_id for hit in store.query(vector, teams[1], 100)
        )
        assert store.query(vector, None, 100) == []
    finally:
        with store._connect() as conn, conn.cursor() as cur:
            cur.execute("DELETE FROM kb_chunks WHERE document_id = %s", (document_id,))
            cur.execute("DELETE FROM kb_documents WHERE id = %s", (document_id,))
