"""Тест с реальной моделью. Запуск: RUN_MODEL_TESTS=1 pytest -m slow"""

import os

import pytest

from app.rag.embeddings import E5Embedder
from app.rag.search import search
from tests.rag.test_search import make_store

pytestmark = [
    pytest.mark.slow,
    pytest.mark.skipif(
        os.getenv("RUN_MODEL_TESTS") != "1",
        reason="нужна модель (RUN_MODEL_TESTS=1)",
    ),
]


@pytest.fixture(scope="module")
def real():
    return E5Embedder()


def test_dimension(real):
    assert len(real.embed_query("привет")) == 768


def test_otgul_found_budget_not(kb_dir, real):
    store = make_store(kb_dir, real)
    found = search("Как оформить отгул?", "team-a", embedder=real, store=store)
    assert found and "отгул" in found[0].doc_title.lower()
    assert (
        search("Какой бюджет на конференции?", "team-a", embedder=real, store=store) == []
    )
