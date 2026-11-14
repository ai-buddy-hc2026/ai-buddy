-- The canonical kb_chunks schema is applied by backend migration 0009_kb_chunks.sql.
CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS kb_chunks (
    id          BIGSERIAL PRIMARY KEY,
    document_id uuid NOT NULL,
    team_id     uuid NOT NULL,
    revision    integer NOT NULL CHECK (revision >= 1),
    doc_title   text NOT NULL CHECK (btrim(doc_title) <> ''),
    section     text NOT NULL DEFAULT '',
    content     text NOT NULL CHECK (btrim(content) <> ''),
    source      text NOT NULL CHECK (btrim(source) <> ''),
    embedding   vector(768) NOT NULL,
    created_at  timestamptz NOT NULL DEFAULT now(),
    FOREIGN KEY (document_id, team_id)
        REFERENCES kb_documents(id, team_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS kb_chunks_document_revision_idx
    ON kb_chunks(document_id, team_id, revision);
CREATE INDEX IF NOT EXISTS kb_chunks_embedding_idx
    ON kb_chunks USING hnsw (embedding vector_cosine_ops);
