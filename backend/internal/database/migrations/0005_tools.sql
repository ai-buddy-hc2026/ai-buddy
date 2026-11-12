ALTER TABLE chat_requests ADD CONSTRAINT chat_requests_actor_team_unique UNIQUE (id, user_id, team_id);

CREATE TABLE actions_log (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    team_id uuid NOT NULL REFERENCES teams(id) ON DELETE RESTRICT,
    request_id uuid NOT NULL,
    proposal_seq integer NOT NULL CHECK (proposal_seq > 0),
    actor_id uuid NOT NULL,
    action_type text NOT NULL CHECK (action_type IN ('absences.create_request', 'checklist.update_status', 'escalation.create')),
    parameters jsonb NOT NULL CHECK (jsonb_typeof(parameters) = 'object'),
    status text NOT NULL DEFAULT 'proposed' CHECK (status IN ('proposed','confirmed','executing','succeeded','failed','cancelled')),
    idempotency_key uuid NOT NULL UNIQUE DEFAULT gen_random_uuid(),
    confirmed_by uuid,
    confirmed_at timestamptz,
    started_at timestamptz,
    finished_at timestamptz,
    attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
    result jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(result) = 'object'),
    last_error jsonb CHECK (last_error IS NULL OR jsonb_typeof(last_error) = 'object'),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (id, team_id),
    UNIQUE (request_id, proposal_seq),
    -- Владелец действия обязан совпадать с владельцем генерации.
    FOREIGN KEY (request_id, actor_id, team_id) REFERENCES chat_requests(id, user_id, team_id) ON DELETE RESTRICT,
    FOREIGN KEY (confirmed_by, team_id) REFERENCES users(id, team_id) ON DELETE RESTRICT,
    CHECK ((confirmed_by IS NULL) = (confirmed_at IS NULL)),
    CHECK (confirmed_by IS NULL OR confirmed_by = actor_id),
    CHECK (
      (status = 'proposed' AND confirmed_at IS NULL AND started_at IS NULL AND finished_at IS NULL)
      OR (status = 'confirmed' AND confirmed_at IS NOT NULL AND started_at IS NULL AND finished_at IS NULL)
      OR (status = 'executing' AND confirmed_at IS NOT NULL AND started_at IS NOT NULL AND attempt_count >= 1 AND finished_at IS NULL)
      OR (status IN ('succeeded','failed') AND confirmed_at IS NOT NULL AND started_at IS NOT NULL AND attempt_count >= 1 AND finished_at IS NOT NULL)
      OR (status = 'cancelled' AND started_at IS NULL AND finished_at IS NOT NULL)
    ),
    CHECK (status <> 'failed' OR last_error IS NOT NULL),
    CHECK (status <> 'succeeded' OR last_error IS NULL)
);
CREATE INDEX actions_actor_created_idx ON actions_log(actor_id, created_at DESC, id);
CREATE INDEX actions_team_status_idx ON actions_log(team_id, status, created_at, id);

-- После подтверждения нельзя заменить параметры или устойчивый ключ действия.
CREATE FUNCTION protect_confirmed_action() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF OLD.status <> 'proposed' AND
       ROW(NEW.team_id,NEW.request_id,NEW.actor_id,NEW.action_type,NEW.parameters,NEW.idempotency_key,NEW.confirmed_by,NEW.confirmed_at)
       IS DISTINCT FROM
       ROW(OLD.team_id,OLD.request_id,OLD.actor_id,OLD.action_type,OLD.parameters,OLD.idempotency_key,OLD.confirmed_by,OLD.confirmed_at)
    THEN RAISE EXCEPTION 'confirmed action is immutable'; END IF;
    IF OLD.status = 'succeeded' AND NEW IS DISTINCT FROM OLD THEN
       RAISE EXCEPTION 'successful action is immutable';
    END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER actions_protect_confirmed BEFORE UPDATE ON actions_log
FOR EACH ROW EXECUTE FUNCTION protect_confirmed_action();

CREATE TABLE absence_requests (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    team_id uuid NOT NULL REFERENCES teams(id) ON DELETE RESTRICT,
    employee_id uuid NOT NULL,
    action_id uuid NOT NULL UNIQUE,
    idempotency_key uuid NOT NULL UNIQUE,
    absence_date date NOT NULL,
    absence_type text NOT NULL CHECK (absence_type IN ('отгул','отпуск')),
    approver_id uuid NOT NULL,
    status text NOT NULL DEFAULT 'pending_approval' CHECK (status = 'pending_approval'),
    created_at timestamptz NOT NULL DEFAULT now(),
    FOREIGN KEY (employee_id, team_id) REFERENCES users(id, team_id) ON DELETE RESTRICT,
    FOREIGN KEY (approver_id, team_id) REFERENCES users(id, team_id) ON DELETE RESTRICT,
    FOREIGN KEY (action_id, team_id) REFERENCES actions_log(id, team_id) ON DELETE RESTRICT
);
CREATE INDEX absence_employee_date_idx ON absence_requests(team_id, employee_id, absence_date DESC, id DESC);

ALTER TABLE events ADD CONSTRAINT events_action_fk FOREIGN KEY (action_id, team_id) REFERENCES actions_log(id, team_id) ON DELETE RESTRICT;
ALTER TABLE events DROP CONSTRAINT events_action_pending;
CREATE INDEX events_action_idx ON events(action_id) WHERE action_id IS NOT NULL;
