"""Lazy, process-wide resources for serving and indexing the team knowledge base."""

from __future__ import annotations

import asyncio
from functools import lru_cache

from app.rag.embeddings import E5Embedder, get_embedder
from app.rag.ingest import ingest_kb
from app.rag.settings import get_settings
from app.rag.store import PgStore
from config import get_settings as get_app_settings

_index_task: asyncio.Task[int] | None = None


@lru_cache(maxsize=1)
def get_rag_resources() -> tuple[E5Embedder, PgStore]:
    settings = get_settings()
    database_url = settings.database_url or get_app_settings().POSTGRES_URL
    if not database_url:
        raise RuntimeError("POSTGRES_URL is required for knowledge search")
    return get_embedder(), PgStore(database_url)


def start_kb_indexing() -> asyncio.Task[int]:
    global _index_task
    if _index_task is None or _index_task.cancelled():
        _index_task = asyncio.create_task(
            asyncio.to_thread(ingest_kb),
            name="ai-buddy-kb-indexing",
        )
    return _index_task


async def ensure_kb_indexed() -> int:
    task = start_kb_indexing()
    return await task
