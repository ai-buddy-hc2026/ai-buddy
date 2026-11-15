package database

import (
	"context"
	"encoding/json"
	"errors"
	"sort"

	"github.com/ai-buddy-hc2026/ai-buddy/backend/internal/identifier"
	"github.com/ai-buddy-hc2026/ai-buddy/backend/internal/notifications"
	"github.com/ai-buddy-hc2026/ai-buddy/backend/internal/policy"
	"github.com/jackc/pgx/v5"
)

func readSettings(ctx context.Context, tx pgx.Tx, actor planActor) (notifications.Settings, error) {
	var settings notifications.Settings
	var preferences []byte
	err := tx.QueryRow(ctx, `SELECT COALESCE(s.notification_preferences,'{"meeting_reminders":true}'::jsonb),
 COALESCE(s.work_days,ARRAY[1,2,3,4,5]::smallint[]),COALESCE(to_char(s.work_start,'HH24:MI'),'10:00'),
 COALESCE(to_char(s.work_end,'HH24:MI'),'19:00'),COALESCE(u.timezone,t.timezone),COALESCE(s.version,0)
 FROM users u JOIN teams t ON t.id=u.team_id LEFT JOIN user_settings s ON s.user_id=u.id AND s.team_id=u.team_id
 WHERE u.id=$1 AND u.team_id=$2 AND u.active AND t.active`, actor.id, actor.teamID).Scan(&preferences, &settings.WorkDays, &settings.WorkStart, &settings.WorkEnd, &settings.Timezone, &settings.Version)
	if err != nil {
		return settings, err
	}
	err = json.Unmarshal(preferences, &settings.Preferences)
	return settings, err
}

func (s *Notifications) Settings(ctx context.Context, actorID string) (notifications.Settings, error) {
	var empty notifications.Settings
	if !identifier.ValidUUID(actorID) {
		return empty, notifications.ErrInvalid
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return empty, err
	}
	defer rollbackOnboarding(tx)
	actor, err := notificationActor(ctx, tx, actorID, policy.NotificationSettings)
	if err != nil {
		return empty, err
	}
	value, err := readSettings(ctx, tx, actor)
	if err != nil {
		return empty, err
	}
	return value, tx.Commit(ctx)
}

func (s *Notifications) UpdateSettings(ctx context.Context, actorID string, input notifications.SettingsInput) (notifications.Settings, error) {
	var empty notifications.Settings
	if !identifier.ValidUUID(actorID) || !input.Valid() {
		return empty, notifications.ErrInvalid
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return empty, err
	}
	defer rollbackOnboarding(tx)
	if err := lockNotificationUser(ctx, tx, actorID); err != nil {
		return empty, err
	}
	actor, err := notificationActor(ctx, tx, actorID, policy.NotificationSettings)
	if err != nil {
		return empty, err
	}
	current, err := readSettings(ctx, tx, actor)
	if err != nil {
		return empty, err
	}
	if current.Version != *input.Version {
		return empty, notifications.ErrConflict
	}
	sort.Ints(input.WorkDays)
	preferences, err := json.Marshal(notifications.Preferences{MeetingReminders: *input.Preferences.MeetingReminders})
	if err != nil {
		return empty, err
	}
	var version int
	err = tx.QueryRow(ctx, `INSERT INTO user_settings(user_id,team_id,notification_preferences,work_days,work_start,work_end)
 VALUES($1,$2,$3,$4,$5::time,$6::time) ON CONFLICT(user_id) DO UPDATE SET notification_preferences=EXCLUDED.notification_preferences,
 work_days=EXCLUDED.work_days,work_start=EXCLUDED.work_start,work_end=EXCLUDED.work_end,version=user_settings.version+1,updated_at=clock_timestamp()
 WHERE user_settings.team_id=EXCLUDED.team_id AND user_settings.version=$7 RETURNING version`, actor.id, actor.teamID, preferences, input.WorkDays, input.WorkStart, input.WorkEnd, *input.Version).Scan(&version)
	if errors.Is(err, pgx.ErrNoRows) {
		return empty, notifications.ErrConflict
	}
	if err != nil {
		return empty, err
	}
	if !*input.Preferences.MeetingReminders {
		_, err = tx.Exec(ctx, `UPDATE notifications SET status='suppressed',updated_at=$2 WHERE recipient_id=$1 AND kind='meeting_reminder' AND status='pending'`, actor.id, s.now())
	} else {
		// Уже отложенные напоминания переоцениваются при смене часов, но не раньше исходного срока.
		_, err = tx.Exec(ctx, `UPDATE notifications n SET available_at=LEAST(n.available_at,$2),updated_at=$2
 FROM calendar_bookings b WHERE n.booking_id=b.id AND n.recipient_id=$1 AND n.kind='meeting_reminder' AND n.status='pending'
 AND b.starts_at-interval '30 minutes'<=$2 AND n.expires_at>$2`, actor.id, s.now())
	}
	if err != nil {
		return empty, err
	}
	value, err := readSettings(ctx, tx, actor)
	if err != nil {
		return empty, err
	}
	return value, tx.Commit(ctx)
}
