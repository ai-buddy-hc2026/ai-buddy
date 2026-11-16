-- Матрица компетенций (идея 29): каталог по трекам, описания уровней 1-4 и самооценка.
-- Самооценку видит только сам пользователь: её читает и пишет только /growth/competencies
-- от его имени, в сводку наставнику и аналитику она не попадает.

CREATE TABLE competencies (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    track text NOT NULL CHECK (track ~ '^[a-z][a-z0-9_-]{0,39}$'),
    code text NOT NULL CHECK (code ~ '^[a-z][a-z0-9_-]{0,39}$'),
    name_ru text NOT NULL CHECK (btrim(name_ru) <> '' AND char_length(name_ru) <= 200),
    name_en text NOT NULL CHECK (btrim(name_en) <> '' AND char_length(name_en) <= 200),
    position integer NOT NULL CHECK (position >= 0),
    UNIQUE (track, code),
    UNIQUE (track, position)
);

CREATE TABLE competency_levels (
    competency_id uuid NOT NULL REFERENCES competencies(id) ON DELETE CASCADE,
    level smallint NOT NULL CHECK (level BETWEEN 1 AND 4),
    description_ru text NOT NULL CHECK (btrim(description_ru) <> '' AND char_length(description_ru) <= 500),
    description_en text NOT NULL CHECK (btrim(description_en) <> '' AND char_length(description_en) <= 500),
    PRIMARY KEY (competency_id, level)
);

-- Трек карты пользователя. Нет записи - трек backend.
CREATE TABLE competency_profiles (
    user_id uuid PRIMARY KEY,
    team_id uuid NOT NULL,
    track text NOT NULL CHECK (track ~ '^[a-z][a-z0-9_-]{0,39}$'),
    FOREIGN KEY (user_id,team_id) REFERENCES users(id,team_id) ON DELETE RESTRICT
);

CREATE TABLE competency_self_assessments (
    user_id uuid NOT NULL,
    team_id uuid NOT NULL,
    competency_id uuid NOT NULL REFERENCES competencies(id) ON DELETE CASCADE,
    level smallint NOT NULL CHECK (level BETWEEN 1 AND 4),
    updated_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, competency_id),
    FOREIGN KEY (user_id,team_id) REFERENCES users(id,team_id) ON DELETE RESTRICT
);
