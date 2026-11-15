ALTER TABLE calendar_bookings ADD CONSTRAINT calendar_bookings_id_team_key UNIQUE (id, team_id);

CREATE TABLE user_settings (
    user_id uuid PRIMARY KEY,
    team_id uuid NOT NULL REFERENCES teams(id) ON DELETE RESTRICT,
    notification_preferences jsonb NOT NULL DEFAULT '{"meeting_reminders":true}'::jsonb,
    work_days smallint[] NOT NULL DEFAULT '{1,2,3,4,5}',
    work_start time NOT NULL DEFAULT '10:00',
    work_end time NOT NULL DEFAULT '19:00',
    version integer NOT NULL DEFAULT 1 CHECK (version >= 1),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    FOREIGN KEY (user_id, team_id) REFERENCES users(id, team_id) ON DELETE RESTRICT,
    CHECK (jsonb_typeof(notification_preferences)='object'
      AND notification_preferences ? 'meeting_reminders'
      AND jsonb_typeof(notification_preferences->'meeting_reminders')='boolean'
      AND notification_preferences - 'meeting_reminders' = '{}'::jsonb),
    CHECK (cardinality(work_days) BETWEEN 1 AND 7 AND array_position(work_days,NULL) IS NULL
      AND work_days <@ ARRAY[1,2,3,4,5,6,7]::smallint[]),
    CHECK (work_start < work_end)
);

CREATE TABLE notifications (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    team_id uuid NOT NULL REFERENCES teams(id) ON DELETE RESTRICT,
    recipient_id uuid NOT NULL,
    kind text NOT NULL CHECK (kind IN ('booking_confirmed','meeting_reminder','mentor_answer')),
    booking_id uuid,
    escalation_id uuid,
    dedup_key text NOT NULL CHECK (btrim(dedup_key) <> ''),
    status text NOT NULL CHECK (status IN ('pending','visible','suppressed','expired')),
    available_at timestamptz NOT NULL DEFAULT now(),
    expires_at timestamptz,
    read_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    FOREIGN KEY (recipient_id,team_id) REFERENCES users(id,team_id) ON DELETE RESTRICT,
    FOREIGN KEY (booking_id,team_id) REFERENCES calendar_bookings(id,team_id) ON DELETE RESTRICT,
    FOREIGN KEY (escalation_id,team_id) REFERENCES escalations(id,team_id) ON DELETE RESTRICT,
    UNIQUE (recipient_id,dedup_key),
    CHECK ((kind IN ('booking_confirmed','meeting_reminder') AND booking_id IS NOT NULL AND escalation_id IS NULL)
      OR (kind='mentor_answer' AND booking_id IS NULL AND escalation_id IS NOT NULL)),
    CHECK (kind<>'meeting_reminder' OR expires_at IS NOT NULL)
);
CREATE INDEX notifications_due_idx ON notifications(available_at,id) WHERE status='pending';
CREATE INDEX notifications_recipient_created_idx ON notifications(recipient_id,created_at DESC,id) WHERE status='visible';
CREATE INDEX notifications_unread_idx ON notifications(recipient_id,created_at DESC,id) WHERE status='visible' AND read_at IS NULL;
CREATE INDEX notifications_booking_idx ON notifications(booking_id) WHERE booking_id IS NOT NULL;
CREATE INDEX notifications_escalation_idx ON notifications(escalation_id) WHERE escalation_id IS NOT NULL;
CREATE INDEX calendar_bookings_starts_idx ON calendar_bookings(starts_at,id);
