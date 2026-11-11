-- Черновик для миграции Василия. Подогнать типы (team_id) под схему БД.
CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS kb_chunks (
    id          BIGSERIAL PRIMARY KEY,
    document_id BIGINT NULL,                 -- kb_documents.id (для mentor_answer, S-6)
    team_id     TEXT NULL,                   -- NULL: общий документ для всех команд
    doc_title   TEXT NOT NULL,
    section     TEXT NOT NULL,
    content     TEXT NOT NULL,
    source      TEXT NOT NULL DEFAULT 'seed', -- seed | mentor_answer
    embedding   vector(768) NOT NULL,         -- intfloat/multilingual-e5-base
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS kb_chunks_team_idx ON kb_chunks (team_id);
CREATE INDEX IF NOT EXISTS kb_chunks_embedding_idx
    ON kb_chunks USING hnsw (embedding vector_cosine_ops);
