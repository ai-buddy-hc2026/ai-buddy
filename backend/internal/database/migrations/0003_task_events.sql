CREATE TABLE events (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    team_id uuid NOT NULL REFERENCES teams(id) ON DELETE RESTRICT,
    actor_id uuid,
    request_id uuid,
    action_id uuid,
    task_id uuid,
    event_type text NOT NULL CHECK (btrim(event_type) <> ''),
    schema_version smallint NOT NULL DEFAULT 1 CHECK (schema_version >= 1),
    dedup_key text UNIQUE CHECK (dedup_key IS NULL OR btrim(dedup_key) <> ''),
    payload jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(payload) = 'object'),
    created_at timestamptz NOT NULL DEFAULT now(),
    FOREIGN KEY (actor_id, team_id) REFERENCES users(id, team_id) ON DELETE RESTRICT,
    FOREIGN KEY (task_id, team_id) REFERENCES tasks(id, team_id) ON DELETE RESTRICT,
    -- До миграций чата/действий непроверенные ссылки не принимаются.
    CONSTRAINT events_request_pending CHECK (request_id IS NULL),
    CONSTRAINT events_action_pending CHECK (action_id IS NULL)
);

CREATE INDEX events_team_type_created_idx ON events(team_id, event_type, created_at, id);
CREATE INDEX events_actor_created_idx ON events(actor_id, created_at, id) WHERE actor_id IS NOT NULL;
CREATE INDEX events_task_idx ON events(task_id) WHERE task_id IS NOT NULL;
