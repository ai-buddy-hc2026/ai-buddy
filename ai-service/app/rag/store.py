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


@dataclass(frozen=True)
class Hit:
    doc_title: str
    section: str
    text: str
    score: float
    team_id: str | None
    source: str


class Store(Protocol):
    def replace_source(self, source: str, rows: list[ChunkRow]) -> None: ...

    def add(self, source: str, rows: list[ChunkRow]) -> None: ...

    def query(
        self, embedding: list[float], team_id: str | None, limit: int
    ) -> list[Hit]: ...


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
            hits.append(Hit(r.doc_title, r.section, r.text, score, r.team_id, source))
        hits.sort(key=lambda h: h.score, reverse=True)
        return hits[:limit]


def _vec(values: list[float]) -> str:
    return "[" + ",".join(f"{v:.6f}" for v in values) + "]"


class PgStore:
    """Таблица kb_chunks, см. app/rag/schema.sql. Косинусная близость = 1 - (<=>)."""

    def __init__(self, dsn: str):
        self.dsn = dsn

    def _connect(self):
        import psycopg

        return psycopg.connect(self.dsn)

    def _insert(self, cur, source: str, rows: list[ChunkRow]) -> None:
        cur.executemany(
            "INSERT INTO kb_chunks (team_id, doc_title, section, content, source, embedding) "
            "VALUES (%s, %s, %s, %s, %s, %s::vector)",
            [
                (
                    None if r.team_id is None else str(r.team_id),
                    r.doc_title,
                    r.section,
                    r.text,
                    source,
                    _vec(r.embedding),
                )
                for r in rows
            ],
        )

    def replace_source(self, source, rows):
        with self._connect() as conn, conn.cursor() as cur:
            cur.execute("DELETE FROM kb_chunks WHERE source = %s", (source,))
            self._insert(cur, source, rows)

    def add(self, source, rows):
        with self._connect() as conn, conn.cursor() as cur:
            self._insert(cur, source, rows)

    def query(self, embedding, team_id, limit):
        vec = _vec(embedding)
        if team_id is None:
            where, params = "team_id IS NULL", (vec, vec, limit)
        else:
            where, params = "(team_id IS NULL OR team_id::text = %s)", (
                vec,
                str(team_id),
                vec,
                limit,
            )
        sql = (
            "SELECT doc_title, section, content, team_id, source, 1 - (embedding <=> %s::vector) AS score "
            f"FROM kb_chunks WHERE {where} ORDER BY embedding <=> %s::vector LIMIT %s"
        )
        with self._connect() as conn, conn.cursor() as cur:
            cur.execute(sql, params)
            return [
                Hit(r[0], r[1], r[2], float(r[5]), r[3], r[4]) for r in cur.fetchall()
            ]
