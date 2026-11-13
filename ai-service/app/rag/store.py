"""Хранилища чанков: в памяти (тесты) и PostgreSQL + pgvector."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Protocol


@dataclass(frozen=True)
class ChunkRow:
    doc_title: str
    section: str
    text: str
    embedding: list[float]
    team_id: str | None = None  # None: общий документ, виден всем командам
    document_id: str | None = None
    revision: int | None = None


@dataclass(frozen=True)
class Hit:
    doc_title: str
    section: str
    text: str
    score: float
    team_id: str | None
    source: str
    document_id: str | None = None
    revision: int | None = None
    slug: str | None = None


class Store(Protocol):
    def replace_source(self, source: str, rows: list[ChunkRow]) -> None:
        """Заменить все чанки источника."""

    def add(self, source: str, rows: list[ChunkRow]) -> None:
        """Добавить чанки."""

    def query(self, embedding: list[float], team_id: str | None, limit: int) -> list[Hit]:
        """Ближайшие чанки, видимые команде."""


def _visible(row_team: str | None, team_id: str | None) -> bool:
    return row_team is None or (team_id is not None and str(row_team) == str(team_id))


class MemoryStore:
    def __init__(self):
        self._rows: list[tuple[str, ChunkRow]] = []

    def replace_source(self, source, rows):
        self._rows = [(s, r) for s, r in self._rows if s != source]
        self.add(source, rows)

    def add(self, source, rows):
        self._rows.extend((source, r) for r in rows)

    def query(self, embedding, team_id, limit):
        hits = []
        for source, r in self._rows:
            if not _visible(r.team_id, team_id):
                continue
            score = sum(a * b for a, b in zip(embedding, r.embedding))
            hits.append(
                Hit(
                    r.doc_title,
                    r.section,
                    r.text,
                    score,
                    r.team_id,
                    source,
                    r.document_id,
                    r.revision,
                ),
            )
        hits.sort(key=lambda h: h.score, reverse=True)
        return hits[:limit]


def _vec(values: list[float]) -> str:
    return "[" + ",".join(f"{v:.6f}" for v in values) + "]"


class PgStore:
    """Векторные чанки связаны с опубликованной редакцией kb_documents."""

    def __init__(self, dsn: str):
        self.dsn = dsn

    def _connect(self):
        import psycopg

        return psycopg.connect(self.dsn)

    def active_team_ids(self) -> list[str]:
        with self._connect() as conn, conn.cursor() as cur:
            cur.execute("SELECT id::text FROM teams WHERE active ORDER BY id")
            return [row[0] for row in cur.fetchall()]

    def prepare_seed_document(
        self,
        team_id: str,
        slug: str,
        title: str,
        content: str,
    ) -> tuple[str, int]:
        with self._connect() as conn, conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO kb_documents
                    (team_id, slug, title, content, source_type, status, index_status)
                VALUES (%s, %s, %s, %s, 'seed', 'published', 'pending')
                ON CONFLICT (team_id, slug) DO UPDATE SET
                    title = EXCLUDED.title,
                    content = EXCLUDED.content,
                    revision = kb_documents.revision +
                        CASE WHEN kb_documents.title IS DISTINCT FROM EXCLUDED.title
                                  OR kb_documents.content IS DISTINCT
                                     FROM EXCLUDED.content
                             THEN 1 ELSE 0 END,
                    status = 'published',
                    index_status = 'pending',
                    indexed_revision = NULL,
                    index_error = NULL,
                    updated_at = now()
                RETURNING id::text, revision
                """,
                (team_id, slug, title, content),
            )
            document_id, revision = cur.fetchone()
            return str(document_id), int(revision)

    def _insert_document_chunks(
        self,
        cur,
        document_id: str,
        team_id: str,
        revision: int,
        source: str,
        rows: list[ChunkRow],
    ) -> None:
        cur.executemany(
            "INSERT INTO kb_chunks "
            "(document_id, revision, team_id, doc_title, section, content, source, "
            "embedding) "
            "VALUES (%s, %s, %s, %s, %s, %s, %s, %s::vector)",
            [
                (
                    document_id,
                    revision,
                    team_id,
                    r.doc_title,
                    r.section,
                    r.text,
                    source,
                    _vec(r.embedding),
                )
                for r in rows
            ],
        )

    def replace_document_chunks(
        self,
        document_id: str,
        team_id: str,
        revision: int,
        slug: str,
        rows: list[ChunkRow],
    ) -> None:
        with self._connect() as conn, conn.cursor() as cur:
            cur.execute(
                "DELETE FROM kb_chunks WHERE document_id = %s AND team_id = %s",
                (document_id, team_id),
            )
            self._insert_document_chunks(cur, document_id, team_id, revision, slug, rows)
            cur.execute(
                """
                UPDATE kb_documents
                SET index_status = 'ready', indexed_revision = %s,
                    index_error = NULL, updated_at = now()
                WHERE id = %s AND team_id = %s AND revision = %s
                """,
                (revision, document_id, team_id, revision),
            )
            if cur.rowcount != 1:
                raise RuntimeError("KB document changed while indexing")

    def query(self, embedding, team_id, limit):
        vec = _vec(embedding)
        if team_id is None:
            return []
        sql = (
            "SELECT c.doc_title, c.section, c.content, c.team_id::text, c.source, "
            "1 - (c.embedding <=> %s::vector) AS score, c.document_id::text, "
            "c.revision, d.slug "
            "FROM kb_chunks c JOIN kb_documents d "
            "ON d.id = c.document_id AND d.team_id = c.team_id "
            "WHERE c.team_id = %s AND d.status = 'published' "
            "AND d.index_status = 'ready' AND c.revision = d.indexed_revision "
            "ORDER BY c.embedding <=> %s::vector, c.id LIMIT %s"
        )
        with self._connect() as conn, conn.cursor() as cur:
            cur.execute(sql, (vec, str(team_id), vec, limit))
            return [
                Hit(r[0], r[1], r[2], float(r[5]), r[3], r[4], r[6], r[7], r[8])
                for r in cur.fetchall()
            ]
