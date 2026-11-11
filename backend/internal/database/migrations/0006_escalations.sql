CREATE TABLE escalations (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    team_id uuid NOT NULL REFERENCES teams(id) ON DELETE RESTRICT,
    action_id uuid NOT NULL UNIQUE,
    intern_id uuid NOT NULL,
    buddy_id uuid NOT NULL,
    question text NOT NULL CHECK (btrim(question) <> '' AND char_length(question) <= 4000),
    context_snapshot jsonb NOT NULL CHECK (jsonb_typeof(context_snapshot)='array' AND jsonb_array_length(context_snapshot)<=10),
    status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','answered','closed')),
    answer_text text CHECK (answer_text IS NULL OR (btrim(answer_text)<>'' AND char_length(answer_text)<=20000)),
    answered_by uuid,
    answered_at timestamptz,
    closed_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (id,team_id),
    FOREIGN KEY (action_id,team_id) REFERENCES actions_log(id,team_id) ON DELETE RESTRICT,
    FOREIGN KEY (intern_id,team_id) REFERENCES users(id,team_id) ON DELETE RESTRICT,
    FOREIGN KEY (buddy_id,team_id) REFERENCES users(id,team_id) ON DELETE RESTRICT,
    FOREIGN KEY (answered_by,team_id) REFERENCES users(id,team_id) ON DELETE RESTRICT,
    CHECK ((answer_text IS NULL AND answered_by IS NULL AND answered_at IS NULL)
        OR (answer_text IS NOT NULL AND answered_by IS NOT NULL AND answered_at IS NOT NULL)),
    CHECK ((status='open' AND answer_text IS NULL AND closed_at IS NULL)
        OR (status='answered' AND answer_text IS NOT NULL AND closed_at IS NULL)
        OR (status='closed' AND closed_at IS NOT NULL))
);
CREATE INDEX escalations_buddy_status_created_idx ON escalations(buddy_id,status,created_at,id);
CREATE INDEX escalations_intern_created_idx ON escalations(intern_id,created_at DESC,id);
