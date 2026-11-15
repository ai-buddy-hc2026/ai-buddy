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
    confidence_high_score: float
    confidence_medium_score: float
    confidence_high_min_results: int
    chunk_max_chars: int
    chunk_overlap: int
    database_url: str

    def __post_init__(self) -> None:
        score_thresholds = {
            "min_score": self.min_score,
            "confidence_medium_score": self.confidence_medium_score,
            "confidence_high_score": self.confidence_high_score,
        }
        for name, score in score_thresholds.items():
            if not 0 <= score <= 1:
                raise ValueError(f"{name} must be between 0 and 1")
        if self.confidence_high_score < self.confidence_medium_score:
            raise ValueError(
                "confidence_high_score must be greater than or equal to "
                "confidence_medium_score",
            )
        if self.confidence_high_min_results < 1:
            raise ValueError("confidence_high_min_results must be at least 1")


def get_settings() -> RagSettings:
    return RagSettings(
        model_name=os.getenv("KB_EMBEDDING_MODEL", "intfloat/multilingual-e5-base"),
        embedding_dim=int(os.getenv("KB_EMBEDDING_DIM", "768")),
        kb_dir=Path(os.getenv("KB_DIR", "seed/kb")),
        top_k=int(os.getenv("KB_TOP_K", "4")),
        # Временное значение. Подобрать скриптом scripts/calibrate_threshold.py
        min_score=float(os.getenv("KB_MIN_SCORE", "0.80")),
        confidence_high_score=float(os.getenv("KB_CONFIDENCE_HIGH_SCORE", "0.88")),
        confidence_medium_score=float(os.getenv("KB_CONFIDENCE_MEDIUM_SCORE", "0.80")),
        confidence_high_min_results=int(os.getenv("KB_CONFIDENCE_HIGH_MIN_RESULTS", "2")),
        chunk_max_chars=int(os.getenv("KB_CHUNK_MAX_CHARS", "800")),
        chunk_overlap=int(os.getenv("KB_CHUNK_OVERLAP", "80")),
        database_url=os.getenv("POSTGRES_URL") or os.getenv("DATABASE_URL", ""),
    )
