-- Компаньон: настройки, «Не мой день», очередь уведомлений, флаг пилота, привязка Telegram (заглушка).

CREATE TABLE user_settings (
    user_id uuid PRIMARY KEY,
    team_id uuid NOT NULL,
    settings jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(settings) = 'object'),
    updated_at timestamptz NOT NULL DEFAULT now(),
    FOREIGN KEY (user_id, team_id) REFERENCES users(id, team_id) ON DELETE CASCADE
);

CREATE TABLE user_day_status (
    user_id uuid NOT NULL,
    team_id uuid NOT NULL,
    day date NOT NULL,
    mode text NOT NULL CHECK (mode = 'not_my_day'),
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, day),
    FOREIGN KEY (user_id, team_id) REFERENCES users(id, team_id) ON DELETE CASCADE
);

-- Приватность: в аналитике режима храним только счётчик за день, без автора.
CREATE TABLE day_mode_totals (
    day date PRIMARY KEY,
    presses bigint NOT NULL DEFAULT 0 CHECK (presses >= 0)
);

CREATE TABLE notifications (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL,
    team_id uuid NOT NULL,
    feature text NOT NULL CHECK (feature IN ('briefing', 'hints', 'stuck', 'reminders', 'coffee', 'birthday', 'system')),
    dedup_key text NOT NULL CHECK (btrim(dedup_key) <> ''),
    title text NOT NULL CHECK (btrim(title) <> ''),
    body text NOT NULL DEFAULT '',
    deliver_at timestamptz NOT NULL DEFAULT now(),
    read_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (user_id, dedup_key),
    FOREIGN KEY (user_id, team_id) REFERENCES users(id, team_id) ON DELETE CASCADE
);

CREATE INDEX notifications_user_deliver_idx ON notifications(user_id, deliver_at DESC, id);

-- Пилот: стажёры с buddy_enabled=false - контрольная группа.
CREATE TABLE pilot_assignments (
    user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    buddy_enabled boolean NOT NULL DEFAULT true
);

-- Заглушка привязки Telegram: реального бота нет, linked_at ставится сразу.
CREATE TABLE telegram_links (
    user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    code text NOT NULL CHECK (btrim(code) <> ''),
    linked_at timestamptz NOT NULL DEFAULT now()
);

-- Дни рождения для напоминаний (синтетические, только месяц и день).
CREATE TABLE user_birthdays (
    user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    month smallint NOT NULL CHECK (month BETWEEN 1 AND 12),
    day smallint NOT NULL CHECK (day BETWEEN 1 AND 31)
);
