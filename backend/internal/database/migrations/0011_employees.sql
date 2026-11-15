CREATE TABLE employees (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    team_id uuid NOT NULL REFERENCES teams(id) ON DELETE RESTRICT,
    user_id uuid UNIQUE,
    display_name text NOT NULL CHECK (char_length(btrim(display_name)) BETWEEN 1 AND 120),
    short_name text NOT NULL CHECK (char_length(btrim(short_name)) BETWEEN 1 AND 60),
    job_title text NOT NULL CHECK (char_length(btrim(job_title)) BETWEEN 1 AND 160),
    kind text NOT NULL CHECK (kind IN ('intern', 'mentor', 'lead', 'hr', 'colleague')),
    tags text[] NOT NULL DEFAULT '{}' CHECK (cardinality(tags) <= 12 AND array_position(tags, NULL) IS NULL),
    ask_about text NOT NULL DEFAULT '' CHECK (char_length(ask_about) <= 1000),
    contact_handle text CHECK (contact_handle IS NULL OR char_length(btrim(contact_handle)) BETWEEN 1 AND 120),
    is_key_contact boolean NOT NULL DEFAULT false,
    sort_order integer NOT NULL DEFAULT 0 CHECK (sort_order >= 0),
    active boolean NOT NULL DEFAULT true,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CHECK (user_id IS NULL OR id = user_id),
    FOREIGN KEY (user_id, team_id) REFERENCES users(id, team_id) ON DELETE RESTRICT
);

CREATE INDEX employees_team_active_order_idx ON employees(team_id, active, sort_order, id);
