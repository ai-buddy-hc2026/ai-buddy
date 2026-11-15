// Package calendar описывает приёмные слоты и подтверждённые брони календаря.
package calendar

import (
	"errors"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/ai-buddy-hc2026/ai-buddy/backend/internal/identifier"
)

var (
	ErrInvalid     = errors.New("invalid calendar request")
	ErrNotFound    = errors.New("calendar resource unavailable")
	ErrDenied      = errors.New("calendar policy denied")
	ErrConflict    = errors.New("calendar slot or participant unavailable")
	ErrIdempotency = errors.New("calendar idempotency payload mismatch")
)

type Window struct{ From, To time.Time }

func (w Window) Valid() bool {
	return !w.From.IsZero() && w.To.After(w.From) && w.To.Sub(w.From) <= 31*24*time.Hour
}

type Slot struct {
	ID         string    `json:"id"`
	EmployeeID string    `json:"employee_id"`
	HostName   string    `json:"host_name"`
	StartsAt   time.Time `json:"starts_at"`
	EndsAt     time.Time `json:"ends_at"`
	Timezone   string    `json:"timezone"`
}

type Booking struct {
	ID           string    `json:"id"`
	SlotID       string    `json:"slot_id"`
	EmployeeID   string    `json:"employee_id"`
	AttendeeID   string    `json:"attendee_id"`
	HostName     string    `json:"host_name"`
	AttendeeName string    `json:"attendee_name"`
	StartsAt     time.Time `json:"starts_at"`
	EndsAt       time.Time `json:"ends_at"`
	Timezone     string    `json:"timezone"`
	Topic        string    `json:"topic"`
	Status       string    `json:"status"`
	ConfirmedAt  time.Time `json:"confirmed_at"`
}

type Input struct {
	SlotID    string `json:"slot_id"`
	Topic     string `json:"topic"`
	Confirmed bool   `json:"confirmed"`
}

func (i Input) Valid(key string) bool {
	return identifier.ValidUUID(i.SlotID) && identifier.ValidUUID(key) && i.Confirmed &&
		utf8.ValidString(i.Topic) && strings.TrimSpace(i.Topic) != "" && utf8.RuneCountInString(i.Topic) <= 500
}
