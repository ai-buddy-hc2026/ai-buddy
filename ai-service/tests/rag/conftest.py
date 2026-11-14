import math
import zlib
from pathlib import Path

import pytest

KB_DIR = Path(__file__).resolve().parents[3] / "seed" / "kb"


class HashEmbedder:
    """Лёгкий фейк: хеш символьных триграмм. Модель не нужна, сети нет."""

    dim = 512

    def _vec(self, text: str) -> list[float]:
        t = " " + text.lower() + " "
        v = [0.0] * self.dim
        for i in range(len(t) - 2):
            end = i + 3
            v[zlib.crc32(t[i:end].encode()) % self.dim] += 1.0
        norm = math.sqrt(sum(x * x for x in v)) or 1.0
        return [x / norm for x in v]

    def embed_passages(self, texts):
        return [self._vec(t) for t in texts]

    def embed_query(self, text):
        return self._vec(text)


@pytest.fixture(scope="session")
def kb_dir():
    return KB_DIR


@pytest.fixture(scope="session")
def embedder():
    return HashEmbedder()
