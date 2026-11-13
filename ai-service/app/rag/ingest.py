"""Загрузка базы знаний: seed/kb/*.md -> чанки -> эмбеддинги -> kb_chunks.

Запуск при старте: python -m app.rag.ingest
или вызов ingest_kb() из lifespan FastAPI (в threadpool).
Повторный запуск безопасен: чанки источника seed пересоздаются.
"""

from __future__ import annotations

import sys
import time
from pathlib import Path

from app.rag.chunker import build_chunks, chunk_document
from app.rag.embeddings import Embedder, get_embedder
from app.rag.settings import get_settings
from app.rag.store import ChunkRow, PgStore, Store
from config import get_settings as get_app_settings

SEED_SOURCE = "seed"


def ingest(
    kb_dir: Path,
    embedder: Embedder,
    store: Store,
    max_chars: int,
    overlap: int,
) -> int:
    chunks = build_chunks(kb_dir, max_chars, overlap)
    if not chunks:
        raise RuntimeError(f"В {kb_dir} нет .md файлов с содержимым")
    vectors = embedder.embed_passages([c.embed_text for c in chunks])
    rows = [
        ChunkRow(c.doc_title, c.section, c.text, v, None) for c, v in zip(chunks, vectors)
    ]
    store.replace_source(SEED_SOURCE, rows)
    return len(rows)


def ingest_seed_documents(
    kb_dir: Path,
    embedder: Embedder,
    store: PgStore,
    max_chars: int,
    overlap: int,
) -> int:
    """Индексирует опубликованные копии seed-документов для активных команд."""
    teams = store.active_team_ids()
    if not teams:
        raise RuntimeError("В базе нет активных команд для индексации KB")

    indexed = 0
    for path in sorted(Path(kb_dir).glob("*.md")):
        content = path.read_text(encoding="utf-8")
        chunks = chunk_document(content, path.stem, max_chars, overlap)
        if not chunks:
            continue
        title = chunks[0].doc_title
        vectors = embedder.embed_passages([chunk.embed_text for chunk in chunks])
        for team_id in teams:
            document_id, revision = store.prepare_seed_document(
                team_id,
                path.stem,
                title,
                content,
            )
            rows = [
                ChunkRow(
                    chunk.doc_title,
                    chunk.section,
                    chunk.text,
                    vector,
                    team_id,
                    document_id,
                    revision,
                )
                for chunk, vector in zip(chunks, vectors, strict=True)
            ]
            store.replace_document_chunks(
                document_id,
                team_id,
                revision,
                path.stem,
                rows,
            )
            indexed += len(rows)
    if indexed == 0:
        raise RuntimeError(f"В {kb_dir} нет .md файлов с содержимым")
    return indexed


def ingest_kb(retries: int = 30, delay: float = 2.0) -> int:
    s = get_settings()
    database_url = s.database_url or get_app_settings().POSTGRES_URL
    if not database_url:
        raise RuntimeError("POSTGRES_URL is required for KB indexing")
    store = PgStore(database_url)
    embedder = get_embedder()
    last: Exception | None = None
    for _ in range(retries):  # БД может ещё стартовать
        try:
            return ingest_seed_documents(
                s.kb_dir,
                embedder,
                store,
                s.chunk_max_chars,
                s.chunk_overlap,
            )
        except Exception as e:  # noqa: BLE001
            last = e
            time.sleep(delay)
    raise RuntimeError(f"Не удалось загрузить базу знаний: {last}")


if __name__ == "__main__":
    n = ingest_kb()
    print(f"kb ingest: {n} chunks", file=sys.stderr)
