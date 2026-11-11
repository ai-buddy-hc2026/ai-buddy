import os
from dataclasses import dataclass
from pathlib import Path


@dataclass(frozen=True)
class RagSettings:
    model_name: str
    embedding_dim: int
    kb_dir: Path
    top_k: int
    min_score: float
    chunk_max_chars: int
    chunk_overlap: int
    database_url: str


def get_settings() -> RagSettings:
    return RagSettings(
        model_name=os.getenv("KB_EMBEDDING_MODEL", "intfloat/multilingual-e5-base"),
        embedding_dim=int(os.getenv("KB_EMBEDDING_DIM", "768")),
        kb_dir=Path(os.getenv("KB_DIR", "seed/kb")),
        top_k=int(os.getenv("KB_TOP_K", "4")),
        # Временное значение. Подобрать скриптом scripts/calibrate_threshold.py
        min_score=float(os.getenv("KB_MIN_SCORE", "0.80")),
        chunk_max_chars=int(os.getenv("KB_CHUNK_MAX_CHARS", "800")),
        chunk_overlap=int(os.getenv("KB_CHUNK_OVERLAP", "80")),
        database_url=os.getenv("DATABASE_URL", ""),
    )
