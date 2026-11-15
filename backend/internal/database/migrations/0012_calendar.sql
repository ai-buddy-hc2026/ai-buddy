ALTER TABLE employees ADD CONSTRAINT employees_id_team_key UNIQUE (id, team_id);

CREATE TABLE calendar_slots (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    team_id uuid NOT NULL REFERENCES teams(id) ON DELETE RESTRICT,
    employee_id uuid NOT NULL,
    starts_at timestamptz NOT NULL,
    ends_at timestamptz NOT NULL,
    active boolean NOT NULL DEFAULT true,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CHECK (ends_at > starts_at AND ends_at <= starts_at + interval '4 hours'),
    UNIQUE (employee_id, starts_at),
    UNIQUE (id, employee_id, team_id),
    FOREIGN KEY (employee_id, team_id) REFERENCES employees(id, team_id) ON DELETE RESTRICT
);
CREATE INDEX calendar_slots_team_time_idx ON calendar_slots(team_id, employee_id, starts_at) WHERE active;

CREATE TABLE calendar_bookings (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    team_id uuid NOT NULL REFERENCES teams(id) ON DELETE RESTRICT,
    slot_id uuid NOT NULL UNIQUE,
    employee_id uuid NOT NULL,
    attendee_id uuid NOT NULL,
    idempotency_key uuid NOT NULL,
    topic text NOT NULL CHECK (char_length(btrim(topic)) BETWEEN 1 AND 500),
    status text NOT NULL DEFAULT 'confirmed' CHECK (status = 'confirmed'),
    starts_at timestamptz NOT NULL,
    ends_at timestamptz NOT NULL CHECK (ends_at > starts_at),
    timezone text NOT NULL CHECK (btrim(timezone) <> ''),
    host_name text NOT NULL CHECK (btrim(host_name) <> ''),
    attendee_name text NOT NULL CHECK (btrim(attendee_name) <> ''),
    confirmed_at timestamptz NOT NULL DEFAULT now(),
    created_at timestamptz NOT NULL DEFAULT now(),
    CHECK (employee_id <> attendee_id),
    UNIQUE (attendee_id, idempotency_key),
    FOREIGN KEY (slot_id, employee_id, team_id) REFERENCES calendar_slots(id, employee_id, team_id) ON DELETE RESTRICT,
    FOREIGN KEY (attendee_id, team_id) REFERENCES users(id, team_id) ON DELETE RESTRICT
);
CREATE INDEX calendar_bookings_attendee_time_idx ON calendar_bookings(team_id, attendee_id, starts_at);
CREATE INDEX calendar_bookings_host_time_idx ON calendar_bookings(team_id, employee_id, starts_at);
