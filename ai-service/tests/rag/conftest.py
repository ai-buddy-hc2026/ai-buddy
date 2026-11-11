import pytest
from pathlib import Path
import hashlib
import numpy as np

# Путь к базе знаний (поднимаемся на уровень выше tests/rag/)
# Структура: ai-service -> tests -> rag -> conftest.py
# seed/kb лежит в корне проекта (на 3 уровня вверх от conftest.py)
KB_DIR = Path(__file__).parent.parent.parent / "seed" / "kb"

class HashEmbedder:
    """Фейковый эмбеддер для unit-тестов без сети."""
    def encode(self, texts, normalize_embeddings=True, **kwargs):
        if isinstance(texts, str):
            texts = [texts]
        
        vectors = []
        for text in texts:
            # Детерминированный вектор на основе SHA256 хеша текста
            h = hashlib.sha256(text.encode('utf-8')).digest()
            # Разворачиваем байты в числа и повторяем до длины 768
            vec_bytes = list(h) * (768 // len(h) + 1)
            vec = np.array(vec_bytes[:768], dtype=np.float32)
            
            # Нормализуем (для cosine similarity)
            norm = np.linalg.norm(vec)
            if norm > 0 and normalize_embeddings:
                vec /= norm
                
            vectors.append(vec)
            
        return np.array(vectors)

FAKE_MIN = 0.35  # порог для фейкового эмбеддера


@pytest.fixture(scope="session")
def kb_dir():
    return KB_DIR


@pytest.fixture(scope="session")
def embedder():
    return HashEmbedder()