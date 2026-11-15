package database

import (
	"context"
	"sort"
	"time"

	"github.com/ai-buddy-hc2026/ai-buddy/backend/internal/calendar"
	"github.com/jackc/pgx/v5"
)

func lockNotificationUser(ctx context.Context, tx pgx.Tx, userID string) error {
	_, err := tx.Exec(ctx, `SELECT pg_advisory_xact_lock(hashtextextended($1,0))`, "notifications:user:"+userID)
	return err
}

func seedNotificationSettings(ctx context.Context, tx pgx.Tx) error {
	_, err := tx.Exec(ctx, `INSERT INTO user_settings(user_id,team_id) SELECT u.id,u.team_id FROM users u JOIN teams t ON t.id=u.team_id WHERE u.active AND t.active ON CONFLICT(user_id) DO NOTHING`)
	return err
}

func lockBookingRecipients(ctx context.Context, tx pgx.Tx, b calendar.Booking) error {
	ids := []string{b.AttendeeID, b.EmployeeID}
	sort.Strings(ids)
	for _, id := range ids {
		if err := lockNotificationUser(ctx, tx, id); err != nil {
			return err
		}
	}
	return nil
}

func insertBookingReminders(ctx context.Context, tx pgx.Tx, bookingID string, now time.Time) error {
	_, err := tx.Exec(ctx, `INSERT INTO notifications(team_id,recipient_id,kind,booking_id,dedup_key,status,available_at,expires_at)
 SELECT b.team_id,u.id,'meeting_reminder',b.id,'booking:'||b.id::text||':reminder:30m',
 CASE WHEN COALESCE((s.notification_preferences->>'meeting_reminders')::boolean,true) THEN 'pending' ELSE 'suppressed' END,
 b.starts_at-interval '30 minutes',b.starts_at
 FROM calendar_bookings b CROSS JOIN LATERAL unnest(ARRAY[b.attendee_id,b.employee_id]) recipient(id)
 JOIN users u ON u.id=recipient.id AND u.team_id=b.team_id AND u.active
 JOIN teams t ON t.id=u.team_id AND t.active
 LEFT JOIN user_settings s ON s.user_id=u.id AND s.team_id=u.team_id
 WHERE b.id=$1 AND b.status='confirmed' AND b.starts_at>$2 AND b.confirmed_at<b.starts_at-interval '30 minutes'
 ON CONFLICT(recipient_id,dedup_key) DO NOTHING`, bookingID, now)
	return err
}

// Записывается в той же транзакции, что и бронь; внешняя доставка не выполняется.
func enqueueBookingNotifications(ctx context.Context, tx pgx.Tx, b calendar.Booking) error {
	if err := lockBookingRecipients(ctx, tx, b); err != nil {
		return err
	}
	_, err := tx.Exec(ctx, `INSERT INTO notifications(team_id,recipient_id,kind,booking_id,dedup_key,status)
 SELECT b.team_id,u.id,'booking_confirmed',b.id,'booking:'||b.id::text||':confirmed','visible'
 FROM calendar_bookings b CROSS JOIN LATERAL unnest(ARRAY[b.attendee_id,b.employee_id]) recipient(id)
 JOIN users u ON u.id=recipient.id AND u.team_id=b.team_id AND u.active
 JOIN teams t ON t.id=u.team_id AND t.active WHERE b.id=$1
 ON CONFLICT(recipient_id,dedup_key) DO NOTHING`, b.ID)
	if err != nil {
		return err
	}
	return insertBookingReminders(ctx, tx, b.ID, b.ConfirmedAt)
}

func enqueueMentorNotification(ctx context.Context, tx pgx.Tx, teamID, internID, id string, version time.Time) error {
	if err := lockNotificationUser(ctx, tx, internID); err != nil {
		return err
	}
	_, err := tx.Exec(ctx, `INSERT INTO notifications(team_id,recipient_id,kind,escalation_id,dedup_key,status)
 SELECT $1,u.id,'mentor_answer',$3,$4,'visible' FROM users u JOIN teams t ON t.id=u.team_id
 WHERE u.id=$2 AND u.team_id=$1 AND u.active AND t.active ON CONFLICT(recipient_id,dedup_key) DO NOTHING`, teamID, internID, id, "escalation:"+id+":answer:"+version.UTC().Format(time.RFC3339Nano))
	return err
}
