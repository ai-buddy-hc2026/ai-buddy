-- Моки корпоративных систем: сотрудники, календарь, обучение, доступы, карта.
-- Данные синтетические, заполняются seeds/mocks.sql.

CREATE TABLE corp_employees (
    code text PRIMARY KEY CHECK (code ~ '^[a-z][a-z0-9_-]{0,63}$'),
    -- NULL - общий сотрудник для всех команд (HR).
    team_id uuid REFERENCES teams(id) ON DELETE RESTRICT,
    user_id uuid UNIQUE REFERENCES users(id) ON DELETE SET NULL,
    name text NOT NULL CHECK (btrim(name) <> ''),
    title text NOT NULL CHECK (btrim(title) <> ''),
    kind text NOT NULL CHECK (kind IN ('intern', 'mentor', 'lead', 'hr', 'colleague')),
    tags text[] NOT NULL DEFAULT '{}',
    ask_about text NOT NULL DEFAULT '',
    birthday text CHECK (birthday IS NULL OR birthday ~ '^[0-1][0-9]-[0-3][0-9]$'),
    desk_id text,
    first_day jsonb CHECK (first_day IS NULL OR jsonb_typeof(first_day) = 'object')
);
CREATE INDEX corp_employees_team_idx ON corp_employees(team_id);

CREATE TABLE calendar_slots (
    id uuid PRIMARY KEY,
    host_code text NOT NULL REFERENCES corp_employees(code) ON DELETE CASCADE,
    starts_at timestamptz NOT NULL,
    minutes integer NOT NULL CHECK (minutes BETWEEN 5 AND 240),
    UNIQUE (host_code, starts_at)
);

CREATE TABLE calendar_bookings (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    -- Один слот - одна бронь: повторная бронь дает 409.
    slot_id uuid NOT NULL UNIQUE REFERENCES calendar_slots(id) ON DELETE CASCADE,
    attendee_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    topic text NOT NULL DEFAULT '' CHECK (length(topic) <= 200),
    action_id uuid UNIQUE,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE learning_courses (
    code text PRIMARY KEY CHECK (code ~ '^[a-z][a-z0-9_-]{0,63}$'),
    title text NOT NULL CHECK (btrim(title) <> ''),
    required boolean NOT NULL DEFAULT true,
    due_days integer NOT NULL CHECK (due_days >= 0),
    minutes integer NOT NULL CHECK (minutes > 0)
);

CREATE TABLE learning_progress (
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    course_code text NOT NULL REFERENCES learning_courses(code) ON DELETE CASCADE,
    completed_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, course_code)
);

CREATE TABLE access_systems (
    code text PRIMARY KEY CHECK (code ~ '^[a-z][a-z0-9_-]{0,63}$'),
    title text NOT NULL CHECK (btrim(title) <> ''),
    about text NOT NULL DEFAULT '',
    approver_code text REFERENCES corp_employees(code) ON DELETE SET NULL,
    -- NULL - выдается вручную, автоматического таймера нет.
    grant_after_sec integer CHECK (grant_after_sec IS NULL OR grant_after_sec >= 0)
);

CREATE TABLE role_access_templates (
    role text NOT NULL CHECK (role IN ('intern', 'buddy', 'lead')),
    system_code text NOT NULL REFERENCES access_systems(code) ON DELETE CASCADE,
    PRIMARY KEY (role, system_code)
);

CREATE TABLE access_requests (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    system_code text NOT NULL REFERENCES access_systems(code) ON DELETE CASCADE,
    action_id uuid UNIQUE,
    requested_at timestamptz NOT NULL DEFAULT now(),
    granted_at timestamptz,
    UNIQUE (user_id, system_code)
);

CREATE TABLE map_places (
    id text PRIMARY KEY CHECK (id ~ '^[a-z][a-z0-9_-]{0,63}$'),
    floor integer NOT NULL,
    kind text NOT NULL CHECK (kind IN ('desk', 'kitchen', 'room', 'lift', 'medical')),
    name text NOT NULL CHECK (btrim(name) <> ''),
    aliases text[] NOT NULL DEFAULT '{}',
    x numeric NOT NULL,
    y numeric NOT NULL,
    w numeric NOT NULL,
    d numeric NOT NULL,
    employee_code text REFERENCES corp_employees(code) ON DELETE SET NULL,
    node_id text NOT NULL
);

ALTER TABLE corp_employees ADD CONSTRAINT corp_employees_desk_fk
    FOREIGN KEY (desk_id) REFERENCES map_places(id) ON DELETE SET NULL DEFERRABLE INITIALLY DEFERRED;

-- Новые записи через подтверждение: бронь слота и заявка на доступ.
ALTER TABLE actions_log DROP CONSTRAINT actions_log_action_type_check;
ALTER TABLE actions_log ADD CONSTRAINT actions_log_action_type_check CHECK (action_type IN (
    'absences.create_request', 'checklist.update_status', 'escalation.create',
    'calendar.book_slot', 'access.request_access'));
