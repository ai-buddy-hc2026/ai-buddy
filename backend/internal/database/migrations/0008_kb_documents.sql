CREATE TABLE kb_documents (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    team_id uuid NOT NULL REFERENCES teams(id) ON DELETE RESTRICT,
    slug text NOT NULL CHECK (slug ~ '^[a-z0-9][a-z0-9_-]{0,127}$'),
    title text NOT NULL CHECK (btrim(title) <> '' AND char_length(title) <= 500),
    content text NOT NULL CHECK (btrim(content) <> '' AND char_length(content) <= 30000),
    source_type text NOT NULL CHECK (source_type IN ('seed', 'buddy_answer')),
    source_escalation_id uuid UNIQUE,
    created_by uuid,
    revision integer NOT NULL DEFAULT 1 CHECK (revision >= 1),
    status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'archived')),
    index_status text NOT NULL DEFAULT 'pending' CHECK (index_status IN ('pending', 'ready', 'failed')),
    indexed_revision integer,
    index_error text,
    search_vector tsvector GENERATED ALWAYS AS (to_tsvector('simple', content)) STORED,
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (team_id, slug),
    UNIQUE (id, team_id),
    FOREIGN KEY (source_escalation_id, team_id) REFERENCES escalations(id, team_id) ON DELETE RESTRICT,
    FOREIGN KEY (created_by, team_id) REFERENCES users(id, team_id) ON DELETE RESTRICT,
    CHECK ((source_type = 'seed' AND source_escalation_id IS NULL AND created_by IS NULL)
        OR (source_type = 'buddy_answer' AND source_escalation_id IS NOT NULL AND created_by IS NOT NULL)),
    CHECK (indexed_revision IS NULL OR indexed_revision BETWEEN 1 AND revision),
    CHECK ((index_status = 'ready' AND indexed_revision = revision AND index_error IS NULL)
        OR (index_status = 'pending' AND index_error IS NULL)
        OR (index_status = 'failed' AND index_error IS NOT NULL))
);

CREATE INDEX kb_documents_team_status_search_idx
    ON kb_documents USING GIN (search_vector)
    WHERE status = 'published' AND index_status = 'ready';
CREATE INDEX kb_documents_team_source_idx ON kb_documents(team_id, source_type, updated_at DESC);
