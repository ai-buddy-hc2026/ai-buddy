import pytest

from tests.rag.conftest import KB_DIR, HashEmbedder

FAKE_MIN = 0.35  # порог для фейкового эмбеддера


@pytest.fixture(scope="session")
def kb_dir():
    return KB_DIR


@pytest.fixture(scope="session")
def embedder():
    return HashEmbedder()
