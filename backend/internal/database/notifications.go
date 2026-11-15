package database

import (
	"context"
	"errors"
	"time"

	"github.com/ai-buddy-hc2026/ai-buddy/backend/internal/identifier"
	"github.com/ai-buddy-hc2026/ai-buddy/backend/internal/notifications"
	"github.com/ai-buddy-hc2026/ai-buddy/backend/internal/policy"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

type Notifications struct {
	pool     *pgxpool.Pool
	listings *Listings
	now      func() time.Time
}

func NewNotifications(pool *pgxpool.Pool, key []byte) (*Notifications, error) {
	listings, err := NewListings(pool, key)
	if err != nil {
		return nil, err
	}
	return &Notifications{pool: pool, listings: listings, now: time.Now}, nil
}

func notificationActor(ctx context.Context, tx pgx.Tx, id string, op policy.Operation) (planActor, error) {
	if !identifier.ValidUUID(id) {
		return planActor{}, notifications.ErrInvalid
	}
	actor, err := loadPlanActor(ctx, tx, id, false)
	if err != nil {
		return actor, err
	}
	if policy.Check(actor.policyActor(), op, policy.Resource{TeamID: actor.teamID, OwnerID: actor.id}) != "" {
		return actor, notifications.ErrDenied
	}
	return actor, nil
}

const notificationJoins = ` FROM notifications n
 LEFT JOIN calendar_bookings b ON b.id=n.booking_id AND b.team_id=n.team_id
 LEFT JOIN escalations e ON e.id=n.escalation_id AND e.team_id=n.team_id `
const notificationWhere = ` n.recipient_id=$1 AND n.team_id=$2 AND n.status='visible'
 AND (n.expires_at IS NULL OR n.expires_at>$3)
 AND ((b.id IS NOT NULL AND (b.attendee_id=$1 OR b.employee_id=$1))
 OR (e.id IS NOT NULL AND e.intern_id=$1 AND e.answer_text IS NOT NULL AND e.answered_at IS NOT NULL)) `
const notificationFields = `n.id::text,n.kind,n.booking_id::text,n.escalation_id::text,n.created_at,n.read_at,
 b.starts_at,b.timezone,CASE WHEN b.employee_id=n.recipient_id THEN b.attendee_name ELSE b.host_name END,left(e.question,120)`

func notificationUTC(value *time.Time) *time.Time {
	if value == nil {
		return nil
	}
	utc := value.UTC()
	return &utc
}
func readNotification(row pgx.CollectableRow) (notifications.Notification, error) {
	var n notifications.Notification
	err := row.Scan(&n.ID, &n.Kind, &n.BookingID, &n.EscalationID, &n.CreatedAt, &n.ReadAt, &n.StartsAt, &n.Timezone, &n.PersonName, &n.QuestionPreview)
	n.CreatedAt = n.CreatedAt.UTC()
	n.ReadAt = notificationUTC(n.ReadAt)
	n.StartsAt = notificationUTC(n.StartsAt)
	return n, err
}

func (s *Notifications) List(ctx context.Context, actorID string, q notifications.Query) (notifications.Page, error) {
	page := notifications.Page{Items: []notifications.Notification{}}
	if q.Limit < 1 || q.Limit > 100 || len(q.Cursor) > 2048 {
		return page, notifications.ErrInvalid
	}
	tx, err := s.pool.BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.RepeatableRead})
	if err != nil {
		return page, err
	}
	defer rollbackOnboarding(tx)
	actor, err := notificationActor(ctx, tx, actorID, policy.ReadNotifications)
	if err != nil {
		return page, err
	}
	scope := listScope{Kind: "notifications", Actor: actor.id, Team: actor.teamID, Limit: q.Limit}
	var beforeTime *time.Time
	var beforeID *string
	if q.Cursor != "" {
		cursor, err := s.listings.decodeCursor(q.Cursor, scope)
		if err != nil || cursor.CreatedAt.IsZero() {
			return page, notifications.ErrInvalid
		}
		beforeTime = &cursor.CreatedAt
		beforeID = &cursor.ID
	}
	now := s.now().UTC()
	err = tx.QueryRow(ctx, `SELECT count(*)`+notificationJoins+` WHERE `+notificationWhere+` AND n.read_at IS NULL`, actor.id, actor.teamID, now).Scan(&page.UnreadCount)
	if err != nil {
		return page, err
	}
	rows, err := tx.Query(ctx, `SELECT `+notificationFields+notificationJoins+` WHERE `+notificationWhere+`
 AND ($4::timestamptz IS NULL OR (n.created_at,n.id)<($4,$5::uuid)) ORDER BY n.created_at DESC,n.id DESC LIMIT $6`, actor.id, actor.teamID, now, beforeTime, beforeID, q.Limit+1)
	if err != nil {
		return page, err
	}
	items, err := pgx.CollectRows(rows, readNotification)
	if err != nil {
		return page, err
	}
	if len(items) > q.Limit {
		last := items[q.Limit-1]
		cursor := s.listings.encodeCursor(scope, last.ID, last.CreatedAt)
		page.NextCursor = &cursor
		items = items[:q.Limit]
	}
	if items != nil {
		page.Items = items
	}
	return page, tx.Commit(ctx)
}

func notificationByID(ctx context.Context, tx pgx.Tx, actor planActor, id string, now time.Time, lock bool) (notifications.Notification, error) {
	query := `SELECT ` + notificationFields + notificationJoins + ` WHERE ` + notificationWhere + ` AND n.id=$4`
	if lock {
		query += ` FOR UPDATE OF n`
	}
	rows, err := tx.Query(ctx, query, actor.id, actor.teamID, now, id)
	if err != nil {
		return notifications.Notification{}, err
	}
	n, err := pgx.CollectExactlyOneRow(rows, readNotification)
	if errors.Is(err, pgx.ErrNoRows) {
		return n, notifications.ErrNotFound
	}
	return n, err
}

func (s *Notifications) Read(ctx context.Context, actorID, id string) (notifications.Notification, error) {
	var empty notifications.Notification
	if !identifier.ValidUUID(id) {
		return empty, notifications.ErrInvalid
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return empty, err
	}
	defer rollbackOnboarding(tx)
	actor, err := notificationActor(ctx, tx, actorID, policy.ReadNotifications)
	if err != nil {
		return empty, err
	}
	now := s.now().UTC()
	n, err := notificationByID(ctx, tx, actor, id, now, true)
	if err != nil {
		return empty, err
	}
	if n.ReadAt == nil {
		var saved time.Time
		err = tx.QueryRow(ctx, `UPDATE notifications SET read_at=$2,updated_at=$2 WHERE id=$1 RETURNING read_at`, id, now).Scan(&saved)
		if err != nil {
			return empty, err
		}
		n.ReadAt = notificationUTC(&saved)
	}
	return n, tx.Commit(ctx)
}

func (s *Notifications) Resource(ctx context.Context, actorID, id string) (notifications.Resource, error) {
	var result notifications.Resource
	if !identifier.ValidUUID(id) {
		return result, notifications.ErrInvalid
	}
	tx, err := s.pool.BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.RepeatableRead})
	if err != nil {
		return result, err
	}
	defer rollbackOnboarding(tx)
	actor, err := notificationActor(ctx, tx, actorID, policy.ReadNotifications)
	if err != nil {
		return result, err
	}
	n, err := notificationByID(ctx, tx, actor, id, s.now(), false)
	if err != nil {
		return result, err
	}
	if n.BookingID != nil {
		rows, err := tx.Query(ctx, `SELECT `+bookingFields+` FROM calendar_bookings WHERE id=$1 AND team_id=$2 AND (attendee_id=$3 OR employee_id=$3)`, *n.BookingID, actor.teamID, actor.id)
		if err != nil {
			return result, err
		}
		booking, err := pgx.CollectExactlyOneRow(rows, readBooking)
		if err != nil {
			return result, err
		}
		result.Type = "booking"
		result.Booking = &booking
	} else {
		var answer notifications.MentorAnswer
		err = tx.QueryRow(ctx, `SELECT id::text,question,answer_text,answered_at FROM escalations WHERE id=$1 AND team_id=$2 AND intern_id=$3 AND answer_text IS NOT NULL`, *n.EscalationID, actor.teamID, actor.id).Scan(&answer.ID, &answer.Question, &answer.AnswerText, &answer.AnsweredAt)
		if err != nil {
			return result, err
		}
		answer.AnsweredAt = answer.AnsweredAt.UTC()
		result.Type = "mentor_answer"
		result.Answer = &answer
	}
	return result, tx.Commit(ctx)
}
