"""Загрузка базы знаний: seed/kb/*.md -> чанки -> эмбеддинги -> kb_chunks.

Запуск при старте: python -m app.rag.ingest
или вызов ingest_kb() из lifespan FastAPI (в threadpool).
Повторный запуск безопасен: чанки источника seed пересоздаются.
"""

from __future__ import annotations

import sys
import time
from pathlib import Path

from .chunker import build_chunks
from .embeddings import E5Embedder, Embedder
from .settings import get_settings
from .store import ChunkRow, PgStore, Store

SEED_SOURCE = "seed"


def ingest(
    kb_dir: Path, embedder: Embedder, store: Store, max_chars: int, overlap: int
) -> int:
    chunks = build_chunks(kb_dir, max_chars, overlap)
    if not chunks:
        raise RuntimeError(f"В {kb_dir} нет .md файлов с содержимым")
    vectors = embedder.embed_passages([c.embed_text for c in chunks])
    rows = [
        ChunkRow(c.doc_title, c.section, c.text, v, None)
        for c, v in zip(chunks, vectors)
    ]
    store.replace_source(SEED_SOURCE, rows)
    return len(rows)


def ingest_kb(retries: int = 30, delay: float = 2.0) -> int:
    s = get_settings()
    store = PgStore(s.database_url)
    embedder = E5Embedder()
    last: Exception | None = None
    for _ in range(retries):  # БД может ещё стартовать
        try:
            return ingest(s.kb_dir, embedder, store, s.chunk_max_chars, s.chunk_overlap)
        except Exception as e:  # noqa: BLE001
            last = e
            time.sleep(delay)
    raise RuntimeError(f"Не удалось загрузить базу знаний: {last}")


if __name__ == "__main__":
    n = ingest_kb()
    print(f"kb ingest: {n} chunks", file=sys.stderr)
