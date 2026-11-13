CREATE TABLE conversations (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    team_id uuid NOT NULL REFERENCES teams(id) ON DELETE RESTRICT,
    owner_id uuid NOT NULL,
    title text NOT NULL DEFAULT '',
    status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (id, owner_id, team_id),
    UNIQUE (id, team_id),
    FOREIGN KEY (owner_id, team_id) REFERENCES users(id, team_id) ON DELETE RESTRICT
);
CREATE UNIQUE INDEX conversations_active_owner_idx ON conversations(owner_id) WHERE status = 'active';
CREATE INDEX conversations_owner_updated_idx ON conversations(owner_id, updated_at DESC, id);

CREATE TABLE chat_requests (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    team_id uuid NOT NULL REFERENCES teams(id) ON DELETE RESTRICT,
    conversation_id uuid NOT NULL,
    user_id uuid NOT NULL,
    status text NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'done', 'error')),
    context_snapshot jsonb NOT NULL CHECK (jsonb_typeof(context_snapshot) = 'object'),
    input_hash text NOT NULL CHECK (length(input_hash) = 64),
    deadline_at timestamptz NOT NULL,
    last_seq integer NOT NULL DEFAULT 0 CHECK (last_seq >= 0),
    terminal_seq integer CHECK (terminal_seq > 0),
    error_code text,
    error_message text,
    finished_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (id, team_id),
    FOREIGN KEY (conversation_id, user_id, team_id) REFERENCES conversations(id, owner_id, team_id) ON DELETE RESTRICT,
    CHECK (deadline_at > created_at),
    CHECK (
        (status = 'running' AND finished_at IS NULL AND terminal_seq IS NULL AND error_code IS NULL AND error_message IS NULL)
        OR (status = 'done' AND finished_at IS NOT NULL AND terminal_seq IS NOT NULL AND last_seq = terminal_seq AND error_code IS NULL AND error_message IS NULL)
        OR (status = 'error' AND finished_at IS NOT NULL AND terminal_seq IS NOT NULL AND last_seq = terminal_seq
            AND error_code IS NOT NULL AND btrim(error_code) <> '' AND error_message IS NOT NULL AND btrim(error_message) <> '')
    )
);
CREATE UNIQUE INDEX chat_requests_running_conversation_idx ON chat_requests(conversation_id) WHERE status = 'running';
CREATE INDEX chat_requests_conversation_created_idx ON chat_requests(conversation_id, created_at, id);
CREATE INDEX chat_requests_deadline_idx ON chat_requests(deadline_at) WHERE status = 'running';

CREATE TABLE chat_messages (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    request_id uuid NOT NULL REFERENCES chat_requests(id) ON DELETE RESTRICT,
    role text NOT NULL CHECK (role IN ('user', 'assistant')),
    content text NOT NULL,
    sources jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(sources) = 'array'),
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (request_id, role),
    CHECK ((role = 'user' AND btrim(content) <> '' AND char_length(content) <= 4000 AND sources = '[]'::jsonb)
        OR (role = 'assistant' AND char_length(content) <= 20000))
);

ALTER TABLE events ADD CONSTRAINT events_request_fk FOREIGN KEY (request_id, team_id) REFERENCES chat_requests(id, team_id) ON DELETE RESTRICT;
ALTER TABLE events DROP CONSTRAINT events_request_pending;
CREATE INDEX events_request_idx ON events(request_id) WHERE request_id IS NOT NULL;
