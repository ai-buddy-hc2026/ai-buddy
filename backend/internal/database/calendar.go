package database

import (
	"context"
	"errors"
	"sort"
	"strings"
	"time"

	"github.com/ai-buddy-hc2026/ai-buddy/backend/internal/calendar"
	"github.com/ai-buddy-hc2026/ai-buddy/backend/internal/identifier"
	"github.com/ai-buddy-hc2026/ai-buddy/backend/internal/policy"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

type Calendar struct {
	pool *pgxpool.Pool
	now  func() time.Time
}

func NewCalendar(pool *pgxpool.Pool) *Calendar { return &Calendar{pool: pool, now: time.Now} }

const calendarHost = ` FROM employees e JOIN teams t ON t.id=e.team_id LEFT JOIN users u ON u.id=e.user_id AND u.team_id=e.team_id
 WHERE e.id=$1 AND e.team_id=$2 AND e.active AND t.active AND (e.user_id IS NULL OR u.active)`

func calendarActor(ctx context.Context, tx pgx.Tx, actorID string, op policy.Operation) (planActor, error) {
	actor, err := loadPlanActor(ctx, tx, actorID, false)
	if err != nil {
		return actor, err
	}
	if policy.Check(actor.policyActor(), op, policy.Resource{TeamID: actor.teamID, OwnerID: actor.id}) != "" {
		return actor, calendar.ErrDenied
	}
	return actor, nil
}

func (s *Calendar) Slots(ctx context.Context, actorID, employeeID string, w calendar.Window) ([]calendar.Slot, error) {
	empty := []calendar.Slot{}
	if !identifier.ValidUUID(actorID) || !identifier.ValidUUID(employeeID) || !w.Valid() {
		return empty, calendar.ErrInvalid
	}
	tx, err := s.pool.BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.RepeatableRead})
	if err != nil {
		return empty, err
	}
	defer rollbackOnboarding(tx)
	actor, err := calendarActor(ctx, tx, actorID, policy.ReadCalendar)
	if err != nil {
		return empty, err
	}
	var name, timezone string
	err = tx.QueryRow(ctx, `SELECT e.display_name,COALESCE(u.timezone,t.timezone)`+calendarHost, employeeID, actor.teamID).Scan(&name, &timezone)
	if errors.Is(err, pgx.ErrNoRows) {
		return empty, calendar.ErrNotFound
	}
	if err != nil {
		return empty, err
	}
	if _, err := time.LoadLocation(timezone); err != nil {
		return empty, err
	}
	rows, err := tx.Query(ctx, `SELECT s.id::text,s.starts_at,s.ends_at FROM calendar_slots s
 WHERE s.employee_id=$1 AND s.team_id=$2 AND s.active AND s.starts_at>=$3 AND s.starts_at<$4 AND s.starts_at>$5
 AND NOT EXISTS(SELECT 1 FROM calendar_bookings b WHERE b.slot_id=s.id)
 AND NOT EXISTS(SELECT 1 FROM calendar_bookings b WHERE b.team_id=s.team_id AND b.starts_at<s.ends_at AND b.ends_at>s.starts_at
 AND (b.employee_id IN ($1,$6) OR b.attendee_id IN ($1,$6)))
 ORDER BY s.starts_at,s.id LIMIT 201`, employeeID, actor.teamID, w.From, w.To, s.now(), actorID)
	if err != nil {
		return empty, err
	}
	items, err := pgx.CollectRows(rows, func(row pgx.CollectableRow) (calendar.Slot, error) {
		item := calendar.Slot{EmployeeID: employeeID, HostName: name, Timezone: timezone}
		err := row.Scan(&item.ID, &item.StartsAt, &item.EndsAt)
		item.StartsAt, item.EndsAt = item.StartsAt.UTC(), item.EndsAt.UTC()
		return item, err
	})
	if err != nil {
		return empty, err
	}
	if len(items) > 200 {
		return empty, calendar.ErrInvalid
	}
	if items == nil {
		items = empty
	}
	return items, tx.Commit(ctx)
}

const bookingFields = `id::text,slot_id::text,employee_id::text,attendee_id::text,host_name,attendee_name,starts_at,ends_at,timezone,topic,status,confirmed_at`

func readBooking(row pgx.CollectableRow) (calendar.Booking, error) {
	var b calendar.Booking
	err := row.Scan(&b.ID, &b.SlotID, &b.EmployeeID, &b.AttendeeID, &b.HostName, &b.AttendeeName, &b.StartsAt, &b.EndsAt, &b.Timezone, &b.Topic, &b.Status, &b.ConfirmedAt)
	b.StartsAt, b.EndsAt, b.ConfirmedAt = b.StartsAt.UTC(), b.EndsAt.UTC(), b.ConfirmedAt.UTC()
	return b, err
}

func existingBooking(ctx context.Context, tx pgx.Tx, actor planActor, key string, input calendar.Input) (calendar.Booking, error) {
	rows, err := tx.Query(ctx, `SELECT `+bookingFields+` FROM calendar_bookings WHERE attendee_id=$1 AND team_id=$2 AND idempotency_key=$3`, actor.id, actor.teamID, key)
	if err != nil {
		return calendar.Booking{}, err
	}
	b, err := pgx.CollectExactlyOneRow(rows, readBooking)
	if err == nil && (b.SlotID != input.SlotID || b.Topic != input.Topic) {
		return b, calendar.ErrIdempotency
	}
	return b, err
}

func (s *Calendar) Book(ctx context.Context, actorID, key string, input calendar.Input) (calendar.Booking, error) {
	var empty calendar.Booking
	if !identifier.ValidUUID(actorID) || !input.Valid(key) {
		return empty, calendar.ErrInvalid
	}
	input.Topic = strings.TrimSpace(input.Topic)
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return empty, err
	}
	defer rollbackOnboarding(tx)
	actor, err := calendarActor(ctx, tx, actorID, policy.BookCalendar)
	if err != nil {
		return empty, err
	}
	if b, err := existingBooking(ctx, tx, actor, key, input); err == nil {
		return b, tx.Commit(ctx)
	} else if !errors.Is(err, pgx.ErrNoRows) {
		return empty, err
	}
	var slot calendar.Slot
	err = tx.QueryRow(ctx, `SELECT s.employee_id::text FROM calendar_slots s JOIN employees e ON e.id=s.employee_id AND e.team_id=s.team_id WHERE s.id=$1 AND s.team_id=$2`, input.SlotID, actor.teamID).Scan(&slot.EmployeeID)
	if errors.Is(err, pgx.ErrNoRows) {
		return empty, calendar.ErrNotFound
	}
	if err != nil {
		return empty, err
	}
	if slot.EmployeeID == actor.id {
		return empty, calendar.ErrInvalid
	}
	// Одинаковый порядок блокировок защищает обоих участников даже в разных слотах.
	participants := []string{actor.id, slot.EmployeeID}
	sort.Strings(participants)
	for _, id := range participants {
		if _, err := tx.Exec(ctx, `SELECT pg_advisory_xact_lock(hashtextextended($1,0))`, "calendar:person:"+id); err != nil {
			return empty, err
		}
	}
	actor, err = calendarActor(ctx, tx, actorID, policy.BookCalendar)
	if err != nil {
		return empty, err
	}
	if b, err := existingBooking(ctx, tx, actor, key, input); err == nil {
		return b, tx.Commit(ctx)
	} else if !errors.Is(err, pgx.ErrNoRows) {
		return empty, err
	}
	err = tx.QueryRow(ctx, `SELECT e.display_name,COALESCE(u.timezone,t.timezone)`+calendarHost+` FOR SHARE OF e,t`, slot.EmployeeID, actor.teamID).Scan(&slot.HostName, &slot.Timezone)
	if errors.Is(err, pgx.ErrNoRows) {
		return empty, calendar.ErrNotFound
	}
	if err != nil {
		return empty, err
	}
	if _, err := time.LoadLocation(slot.Timezone); err != nil {
		return empty, err
	}
	err = tx.QueryRow(ctx, `SELECT starts_at,ends_at FROM calendar_slots WHERE id=$1 AND team_id=$2 AND active FOR UPDATE`, input.SlotID, actor.teamID).Scan(&slot.StartsAt, &slot.EndsAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return empty, calendar.ErrNotFound
	}
	if err != nil {
		return empty, err
	}
	if !slot.StartsAt.After(s.now()) {
		return empty, calendar.ErrConflict
	}
	var busy bool
	err = tx.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM calendar_bookings WHERE team_id=$1 AND starts_at<$2 AND ends_at>$3 AND
 (employee_id IN ($4,$5) OR attendee_id IN ($4,$5)))`, actor.teamID, slot.EndsAt, slot.StartsAt, slot.EmployeeID, actor.id).Scan(&busy)
	if err != nil {
		return empty, err
	}
	if busy {
		return empty, calendar.ErrConflict
	}
	var attendeeName string
	err = tx.QueryRow(ctx, `SELECT COALESCE(e.display_name,u.display_name) FROM users u LEFT JOIN employees e ON e.user_id=u.id AND e.team_id=u.team_id WHERE u.id=$1 AND u.team_id=$2 AND u.active FOR SHARE OF u`, actor.id, actor.teamID).Scan(&attendeeName)
	if errors.Is(err, pgx.ErrNoRows) {
		return empty, calendar.ErrDenied
	}
	if err != nil {
		return empty, err
	}
	rows, err := tx.Query(ctx, `INSERT INTO calendar_bookings(team_id,slot_id,employee_id,attendee_id,idempotency_key,topic,starts_at,ends_at,timezone,host_name,attendee_name)
 VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING `+bookingFields, actor.teamID, input.SlotID, slot.EmployeeID, actor.id, key, input.Topic, slot.StartsAt, slot.EndsAt, slot.Timezone, slot.HostName, attendeeName)
	if err != nil {
		return empty, err
	}
	b, err := pgx.CollectExactlyOneRow(rows, readBooking)
	if err != nil {
		return empty, err
	}
	return b, tx.Commit(ctx)
}

func (s *Calendar) Bookings(ctx context.Context, actorID string, w calendar.Window) ([]calendar.Booking, error) {
	empty := []calendar.Booking{}
	if !identifier.ValidUUID(actorID) || !w.Valid() {
		return empty, calendar.ErrInvalid
	}
	tx, err := s.pool.BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.RepeatableRead})
	if err != nil {
		return empty, err
	}
	defer rollbackOnboarding(tx)
	actor, err := calendarActor(ctx, tx, actorID, policy.ReadBookings)
	if err != nil {
		return empty, err
	}
	rows, err := tx.Query(ctx, `SELECT `+bookingFields+` FROM calendar_bookings WHERE team_id=$1 AND (attendee_id=$2 OR employee_id=$2)
 AND ends_at>$3 AND starts_at<$4 ORDER BY starts_at,id LIMIT 201`, actor.teamID, actor.id, w.From, w.To)
	if err != nil {
		return empty, err
	}
	items, err := pgx.CollectRows(rows, readBooking)
	if err != nil {
		return empty, err
	}
	if len(items) > 200 {
		return empty, calendar.ErrInvalid
	}
	if items == nil {
		items = empty
	}
	return items, tx.Commit(ctx)
}
