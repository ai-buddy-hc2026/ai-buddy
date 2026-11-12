CREATE TABLE teams (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    code text NOT NULL UNIQUE CHECK (btrim(code) <> ''),
    name text NOT NULL CHECK (btrim(name) <> ''),
    timezone text NOT NULL CHECK (btrim(timezone) <> ''),
    active boolean NOT NULL DEFAULT true,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE users (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    team_id uuid NOT NULL REFERENCES teams(id) ON DELETE RESTRICT,
    login text NOT NULL UNIQUE CHECK (btrim(login) <> '' AND login = lower(btrim(login))),
    display_name text NOT NULL CHECK (btrim(display_name) <> ''),
    role text NOT NULL CHECK (role IN ('intern', 'buddy', 'lead')),
    buddy_id uuid,
    manager_id uuid,
    timezone text CHECK (timezone IS NULL OR btrim(timezone) <> ''),
    active boolean NOT NULL DEFAULT true,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (id, team_id),
    FOREIGN KEY (buddy_id, team_id) REFERENCES users(id, team_id) ON DELETE RESTRICT,
    FOREIGN KEY (manager_id, team_id) REFERENCES users(id, team_id) ON DELETE RESTRICT,
    CHECK (buddy_id IS NULL OR buddy_id <> id),
    CHECK (manager_id IS NULL OR manager_id <> id)
);

CREATE INDEX users_team_role_idx ON users(team_id, role);
CREATE INDEX users_buddy_idx ON users(buddy_id) WHERE buddy_id IS NOT NULL;
CREATE INDEX users_manager_idx ON users(manager_id) WHERE manager_id IS NOT NULL;
