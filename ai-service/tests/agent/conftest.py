import hashlib
from pathlib import Path

import numpy as np
import pytest

KB_DIR = Path(__file__).parent.parent.parent / "seed" / "kb"


class HashEmbedder:
    def encode(self, texts, normalize_embeddings=True, **kwargs):
        if isinstance(texts, str):
            texts = [texts]

        vectors = []
        for text in texts:
            h = hashlib.sha256(text.encode("utf-8")).digest()
            vec_bytes = list(h) * (768 // len(h) + 1)
            vec = np.array(vec_bytes[:768], dtype=np.float32)

            norm = np.linalg.norm(vec)
            if norm > 0 and normalize_embeddings:
                vec /= norm

            vectors.append(vec)

        return np.array(vectors)


FAKE_MIN = 0.35


@pytest.fixture(scope="session")
def kb_dir():
    return KB_DIR


@pytest.fixture(scope="session")
def embedder():
    return HashEmbedder()
