CREATE TABLE onboarding_plans (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    team_id uuid NOT NULL REFERENCES teams(id) ON DELETE RESTRICT,
    intern_id uuid NOT NULL,
    title text NOT NULL CHECK (btrim(title) <> ''),
    start_date date NOT NULL,
    current_stage text NOT NULL CHECK (current_stage IN ('week_1', 'week_2', 'weeks_3_4')),
    status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'completed', 'archived')),
    completed_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (id, team_id),
    FOREIGN KEY (intern_id, team_id) REFERENCES users(id, team_id) ON DELETE RESTRICT,
    CHECK ((status <> 'completed' OR completed_at IS NOT NULL)
        AND (status <> 'active' OR completed_at IS NULL))
);

CREATE UNIQUE INDEX onboarding_plans_active_intern_idx ON onboarding_plans(intern_id) WHERE status = 'active';
CREATE INDEX onboarding_plans_intern_created_idx ON onboarding_plans(intern_id, created_at DESC, id);

CREATE TABLE tasks (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    team_id uuid NOT NULL REFERENCES teams(id) ON DELETE RESTRICT,
    plan_id uuid NOT NULL,
    assignee_id uuid NOT NULL,
    seed_key text NOT NULL CHECK (btrim(seed_key) <> ''),
    stage text NOT NULL CHECK (stage IN ('week_1', 'week_2', 'weeks_3_4')),
    title text NOT NULL CHECK (btrim(title) <> ''),
    description text NOT NULL DEFAULT '',
    position integer NOT NULL CHECK (position >= 0),
    due_date date,
    status text NOT NULL DEFAULT 'todo' CHECK (status IN ('todo', 'in_progress', 'blocked', 'done')),
    version integer NOT NULL DEFAULT 1 CHECK (version >= 1),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (id, team_id),
    UNIQUE (plan_id, seed_key),
    UNIQUE (plan_id, stage, position),
    FOREIGN KEY (plan_id, team_id) REFERENCES onboarding_plans(id, team_id) ON DELETE RESTRICT,
    FOREIGN KEY (assignee_id, team_id) REFERENCES users(id, team_id) ON DELETE RESTRICT
);

CREATE INDEX tasks_assignee_status_due_idx ON tasks(assignee_id, status, due_date, id);

CREATE TABLE task_status_history (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    task_id uuid NOT NULL REFERENCES tasks(id) ON DELETE RESTRICT,
    version integer NOT NULL CHECK (version >= 1),
    from_status text CHECK (from_status IN ('todo', 'in_progress', 'blocked', 'done')),
    to_status text NOT NULL CHECK (to_status IN ('todo', 'in_progress', 'blocked', 'done')),
    changed_by uuid REFERENCES users(id) ON DELETE RESTRICT,
    reason text NOT NULL DEFAULT '',
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (task_id, version),
    CHECK ((version = 1 AND from_status IS NULL)
        OR (version > 1 AND from_status IS NOT NULL AND from_status <> to_status))
);
