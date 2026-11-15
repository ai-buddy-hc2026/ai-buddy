package database

import (
	"context"
	"errors"
	"time"

	"github.com/ai-buddy-hc2026/ai-buddy/backend/internal/notifications"
	"github.com/jackc/pgx/v5"
)

func (s *Notifications) Backfill(ctx context.Context, now time.Time) error {
	// Старые подтверждения не рассылаются: восстанавливаются только будущие напоминания.
	rows, err := s.pool.Query(ctx, `SELECT DISTINCT b.id::text FROM calendar_bookings b
 CROSS JOIN LATERAL unnest(ARRAY[b.attendee_id,b.employee_id]) recipient(id)
 JOIN users u ON u.id=recipient.id AND u.team_id=b.team_id AND u.active JOIN teams t ON t.id=u.team_id AND t.active
 WHERE b.starts_at>$1 AND b.confirmed_at<b.starts_at-interval '30 minutes' AND b.status='confirmed'
 AND NOT EXISTS(SELECT 1 FROM notifications n WHERE n.recipient_id=u.id AND n.dedup_key='booking:'||b.id::text||':reminder:30m')`, now)
	if err != nil {
		return err
	}
	ids, err := pgx.CollectRows(rows, pgx.RowTo[string])
	if err != nil {
		return err
	}
	for _, id := range ids {
		if err := s.backfillBooking(ctx, id, now); err != nil {
			return err
		}
	}
	return nil
}

func (s *Notifications) backfillBooking(ctx context.Context, id string, now time.Time) error {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer rollbackOnboarding(tx)
	rows, err := tx.Query(ctx, `SELECT `+bookingFields+` FROM calendar_bookings WHERE id=$1`, id)
	if err != nil {
		return err
	}
	b, err := pgx.CollectExactlyOneRow(rows, readBooking)
	if err != nil {
		return err
	}
	if err := lockBookingRecipients(ctx, tx, b); err != nil {
		return err
	}
	if err := insertBookingReminders(ctx, tx, id, now); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

func (s *Notifications) ProcessDue(ctx context.Context, now time.Time) error {
	_, err := s.pool.Exec(ctx, `UPDATE notifications SET status='expired',updated_at=$1 WHERE status IN ('pending','visible') AND expires_at<=$1`, now)
	if err != nil {
		return err
	}
	rows, err := s.pool.Query(ctx, `SELECT id::text,recipient_id::text FROM notifications WHERE status='pending' AND available_at<=$1 ORDER BY available_at,id LIMIT 100`, now)
	if err != nil {
		return err
	}
	type due struct{ ID, Recipient string }
	items, err := pgx.CollectRows(rows, func(row pgx.CollectableRow) (due, error) {
		var d due
		err := row.Scan(&d.ID, &d.Recipient)
		return d, err
	})
	if err != nil {
		return err
	}
	for _, item := range items {
		if err := s.processOne(ctx, item.ID, item.Recipient, now); err != nil {
			return err
		}
	}
	return nil
}

func (s *Notifications) processOne(ctx context.Context, id, recipient string, now time.Time) error {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer rollbackOnboarding(tx)
	var locked bool
	if err := tx.QueryRow(ctx, `SELECT pg_try_advisory_xact_lock(hashtextextended($1,0))`, "notifications:user:"+recipient).Scan(&locked); err != nil {
		return err
	}
	if !locked {
		return nil
	}
	var teamID string
	var expires time.Time
	err = tx.QueryRow(ctx, `SELECT team_id::text,expires_at FROM notifications WHERE id=$1 AND recipient_id=$2 AND status='pending' AND available_at<=$3 FOR UPDATE SKIP LOCKED`, id, recipient, now).Scan(&teamID, &expires)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil
	}
	if err != nil {
		return err
	}
	status := "visible"
	available := now
	var active bool
	err = tx.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM users u JOIN teams t ON t.id=u.team_id
 JOIN notifications n ON n.recipient_id=u.id AND n.team_id=u.team_id
 JOIN calendar_bookings b ON b.id=n.booking_id AND b.team_id=n.team_id
 JOIN employees h ON h.id=b.employee_id AND h.team_id=b.team_id
 LEFT JOIN users host ON host.id=h.user_id AND host.team_id=h.team_id
 WHERE n.id=$1 AND u.active AND t.active AND h.active AND (h.user_id IS NULL OR host.active)
 AND b.status='confirmed' AND (b.attendee_id=u.id OR b.employee_id=u.id)
 AND EXISTS(SELECT 1 FROM users guest WHERE guest.id=b.attendee_id AND guest.team_id=b.team_id AND guest.active))`, id).Scan(&active)
	if err != nil {
		return err
	}
	if !expires.After(now) {
		status = "expired"
	} else if !active {
		status = "suppressed"
	} else {
		settings, err := readSettings(ctx, tx, planActor{id: recipient, teamID: teamID})
		if err != nil {
			return err
		}
		if !settings.Preferences.MeetingReminders {
			status = "suppressed"
		} else {
			available, err = notifications.NextAllowed(now, settings)
			if err != nil {
				return err
			}
			if !available.Before(expires) {
				status = "expired"
			} else if available.After(now) {
				status = "pending"
			}
		}
	}
	_, err = tx.Exec(ctx, `UPDATE notifications SET status=$2,available_at=$3,updated_at=$4 WHERE id=$1`, id, status, available, now)
	if err != nil {
		return err
	}
	return tx.Commit(ctx)
}
