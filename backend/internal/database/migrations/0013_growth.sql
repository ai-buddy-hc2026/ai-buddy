-- Рост и сообщество (идеи 8, 20, 22, 29, 45, 48): brag document, запросы обратной связи,
-- события и группы по интересам, треки онбординга, итоги встреч, пары random coffee.

CREATE TABLE brag_items (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    team_id uuid NOT NULL REFERENCES teams(id) ON DELETE RESTRICT,
    user_id uuid NOT NULL,
    kind text NOT NULL CHECK (kind IN ('task','pr','review','feedback','manual')),
    title text NOT NULL CHECK (btrim(title) <> '' AND char_length(title) <= 300),
    link text CHECK (link IS NULL OR (link ~ '^https?://' AND char_length(link) <= 2000)),
    occurred_on date NOT NULL,
    source_task_id uuid,
    deleted_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    FOREIGN KEY (user_id,team_id) REFERENCES users(id,team_id) ON DELETE RESTRICT,
    FOREIGN KEY (source_task_id,team_id) REFERENCES tasks(id,team_id) ON DELETE RESTRICT,
    UNIQUE (user_id, source_task_id)
);
CREATE INDEX brag_items_user_date_idx ON brag_items(user_id, occurred_on DESC, id) WHERE deleted_at IS NULL;

CREATE TABLE feedback_requests (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    team_id uuid NOT NULL REFERENCES teams(id) ON DELETE RESTRICT,
    requester_id uuid NOT NULL,
    recipient_id uuid NOT NULL,
    artifact_url text NOT NULL CHECK (artifact_url ~ '^https?://' AND char_length(artifact_url) <= 2000),
    artifact_title text NOT NULL CHECK (btrim(artifact_title) <> '' AND char_length(artifact_title) <= 300),
    question text NOT NULL CHECK (btrim(question) <> '' AND char_length(question) <= 300),
    answer text CHECK (answer IS NULL OR (btrim(answer) <> '' AND char_length(answer) <= 4000)),
    sent_at timestamptz NOT NULL DEFAULT now(),
    expires_at timestamptz NOT NULL,
    answered_at timestamptz,
    saved_to_brag boolean NOT NULL DEFAULT false,
    external_id text CHECK (external_id IS NULL OR char_length(external_id) <= 200),
    FOREIGN KEY (requester_id,team_id) REFERENCES users(id,team_id) ON DELETE RESTRICT,
    FOREIGN KEY (recipient_id,team_id) REFERENCES users(id,team_id) ON DELETE RESTRICT,
    CHECK (requester_id <> recipient_id),
    CHECK (expires_at > sent_at),
    CHECK ((answer IS NULL) = (answered_at IS NULL)),
    CHECK (NOT saved_to_brag OR answer IS NOT NULL)
);
CREATE INDEX feedback_requests_requester_idx ON feedback_requests(requester_id, sent_at DESC);
CREATE INDEX feedback_requests_recipient_idx ON feedback_requests(recipient_id, sent_at DESC);

-- Таблица events уже занята событиями задач, поэтому community_events.
CREATE TABLE community_events (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    team_id uuid NOT NULL REFERENCES teams(id) ON DELETE RESTRICT,
    kind text NOT NULL CHECK (kind IN ('training','avitotech','internal','user')),
    title text NOT NULL CHECK (btrim(title) <> '' AND char_length(title) <= 200),
    description text NOT NULL DEFAULT '' CHECK (char_length(description) <= 4000),
    starts_at timestamptz NOT NULL,
    minutes integer NOT NULL CHECK (minutes > 0 AND minutes <= 1440),
    place_id text,
    place_name text NOT NULL DEFAULT '',
    host_id uuid NOT NULL,
    tags text[] NOT NULL DEFAULT '{}',
    capacity integer CHECK (capacity IS NULL OR capacity > 0),
    materials text[] NOT NULL DEFAULT '{}',
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (id,team_id),
    FOREIGN KEY (host_id,team_id) REFERENCES users(id,team_id) ON DELETE RESTRICT
);
CREATE INDEX community_events_team_start_idx ON community_events(team_id, starts_at, id);

CREATE TABLE event_attendees (
    event_id uuid NOT NULL,
    team_id uuid NOT NULL,
    user_id uuid NOT NULL,
    joined_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (event_id, user_id),
    FOREIGN KEY (event_id,team_id) REFERENCES community_events(id,team_id) ON DELETE CASCADE,
    FOREIGN KEY (user_id,team_id) REFERENCES users(id,team_id) ON DELETE RESTRICT
);

CREATE TABLE user_interests (
    user_id uuid NOT NULL,
    team_id uuid NOT NULL,
    tag text NOT NULL CHECK (tag = lower(btrim(tag)) AND tag <> '' AND char_length(tag) <= 40),
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, tag),
    FOREIGN KEY (user_id,team_id) REFERENCES users(id,team_id) ON DELETE RESTRICT
);
CREATE INDEX user_interests_team_tag_idx ON user_interests(team_id, tag);

-- Каталог треков живёт во фронте; здесь выбор и прогресс модулей (включая skipped_by_test).
CREATE TABLE user_tracks (
    user_id uuid PRIMARY KEY,
    team_id uuid NOT NULL,
    selected jsonb NOT NULL DEFAULT '[]' CHECK (jsonb_typeof(selected) = 'array'),
    modules jsonb NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(modules) = 'object'),
    updated_at timestamptz NOT NULL DEFAULT now(),
    FOREIGN KEY (user_id,team_id) REFERENCES users(id,team_id) ON DELETE RESTRICT
);

-- Итоги встречи. Договорённости становятся задачами плана с seed_key meeting:<key>:<n>.
CREATE TABLE meeting_notes (
    user_id uuid NOT NULL,
    team_id uuid NOT NULL,
    meeting_key text NOT NULL CHECK (meeting_key ~ '^[A-Za-z0-9_.:-]{1,100}$'),
    summary text NOT NULL CHECK (btrim(summary) <> '' AND char_length(summary) <= 4000),
    agreements jsonb NOT NULL CHECK (jsonb_typeof(agreements) = 'array'),
    task_count integer NOT NULL CHECK (task_count >= 0),
    saved_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, meeting_key),
    FOREIGN KEY (user_id,team_id) REFERENCES users(id,team_id) ON DELETE RESTRICT
);

-- Пары random coffee на неделю. Подбор делает планировщик, здесь только хранение.
CREATE TABLE coffee_pairs (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    team_id uuid NOT NULL REFERENCES teams(id) ON DELETE RESTRICT,
    week_start date NOT NULL CHECK (extract(isodow FROM week_start) = 1),
    user_a uuid NOT NULL,
    user_b uuid NOT NULL,
    status text NOT NULL DEFAULT 'proposed' CHECK (status IN ('proposed','met','skipped')),
    created_at timestamptz NOT NULL DEFAULT now(),
    CHECK (user_a < user_b),
    UNIQUE (week_start, user_a, user_b),
    FOREIGN KEY (user_a,team_id) REFERENCES users(id,team_id) ON DELETE RESTRICT,
    FOREIGN KEY (user_b,team_id) REFERENCES users(id,team_id) ON DELETE RESTRICT
);
CREATE INDEX coffee_pairs_user_a_idx ON coffee_pairs(user_a, week_start DESC);
CREATE INDEX coffee_pairs_user_b_idx ON coffee_pairs(user_b, week_start DESC);
