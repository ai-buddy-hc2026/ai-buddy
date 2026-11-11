// Package tools описывает внутренний контракт корпоративных инструментов.
package tools

import (
	"bytes"
	"encoding/json"
	"errors"
	"io"
	"time"
)

var (
	ErrInvalid              = errors.New("INVALID_ARGUMENT")
	ErrContext              = errors.New("INVALID_CONTEXT")
	ErrDenied               = errors.New("POLICY_DENIED")
	ErrConfirmation         = errors.New("CONFIRMATION_REQUIRED")
	ErrConflict             = errors.New("IDEMPOTENCY_CONFLICT")
	ErrUnavailable          = errors.New("TOOL_UNAVAILABLE")
	ErrNoManager            = errors.New("MANAGER_NOT_ASSIGNED")
	ErrNotFound             = errors.New("NOT_FOUND")
	ErrClosed               = errors.New("REQUEST_CLOSED")
	ErrUnknownRequest       = errors.New("REQUEST_NOT_FOUND")
	ErrBusinessConflict     = errors.New("CONFLICT")
	ErrActionNotConfirmable = errors.New("ACTION_NOT_CONFIRMABLE")
)

type PlanInput struct {
	InternID string `json:"intern_id,omitempty"`
}
type ActionInput struct {
	ActionID string `json:"action_id"`
}
type EmployeeInput struct {
	EmployeeID string `json:"employee_id,omitempty"`
}
type EmptyInput struct{}

type AbsenceParameters struct {
	Date     string `json:"date"`
	Type     string `json:"type"`
	Approver string `json:"approver"`
}
type TaskParameters struct {
	TaskID  string `json:"task_id"`
	Status  string `json:"status"`
	Version int    `json:"version"`
}

type ContextMessage struct {
	MessageID string            `json:"message_id"`
	Role      string            `json:"role"`
	Content   string            `json:"content"`
	Sources   []json.RawMessage `json:"sources"`
}
type EscalationParameters struct {
	BuddyID         string           `json:"buddy_id"`
	Question        string           `json:"question"`
	ContextSnapshot []ContextMessage `json:"context_snapshot"`
}
type EscalationResult struct {
	ID      string `json:"id"`
	Status  string `json:"status"`
	BuddyID string `json:"buddy_id"`
}
type Manager struct {
	ID   string `json:"id"`
	Name string `json:"name"`
	Role string `json:"role"`
}
type Context struct{ ActorID, TeamID, Role string }
type ListAbsencesInput struct {
	Cursor string `json:"cursor,omitempty"`
	Limit  int    `json:"limit,omitempty"`
}
type AbsenceType struct {
	Code  string `json:"code"`
	Label string `json:"label"`
}
type PolicyData struct {
	NoticePeriodDays int           `json:"notice_period_days"`
	RequiresApproval bool          `json:"requires_approval"`
	AllowedTypes     []AbsenceType `json:"allowed_types"`
}
type CreateAbsenceInput struct {
	Date string `json:"date"`
	Type string `json:"type"`
}
type CreateAbsenceResult struct {
	ActionID   string `json:"action_id"`
	ExternalID string `json:"external_id"`
	Status     string `json:"status"`
	Approver   string `json:"approver"`
}
type StatusResult struct {
	TaskID    string    `json:"task_id"`
	OldStatus string    `json:"old_status"`
	Status    string    `json:"status"`
	Version   int       `json:"version"`
	UpdatedAt time.Time `json:"updated_at"`
}
type Absence struct {
	ID         string `json:"external_id"`
	EmployeeID string `json:"employee_id"`
	Date       string `json:"date"`
	Type       string `json:"type"`
	Status     string `json:"status"`
	Approver   string `json:"approver"`
}
type AbsencePolicy struct {
	Revision       int      `json:"revision"`
	Title          string   `json:"title"`
	Types          []string `json:"types"`
	MaxAdvanceDays int      `json:"max_advance_days"`
	Timezone       string   `json:"timezone"`
}

// Decode отклоняет неизвестные поля, null и несколько JSON-значений.
func Decode(raw json.RawMessage, target any) error {
	if len(raw) == 0 || bytes.Equal(bytes.TrimSpace(raw), []byte("null")) {
		return ErrInvalid
	}
	d := json.NewDecoder(bytes.NewReader(raw))
	d.DisallowUnknownFields()
	if d.Decode(target) != nil || d.Decode(new(any)) != io.EOF {
		return ErrInvalid
	}
	return nil
}

// ValidateAbsence применяет синтетические правила демо, а не регламент компании.
func ValidateAbsence(p AbsenceParameters, now time.Time, timezone string, domain ...PolicyData) error {
	loc, err := time.LoadLocation(timezone)
	if err != nil {
		return ErrUnavailable
	}
	date, err := time.ParseInLocation(time.DateOnly, p.Date, loc)
	if err != nil || date.Format(time.DateOnly) != p.Date {
		return ErrInvalid
	}
	configuration := PolicyData{NoticePeriodDays: 3, RequiresApproval: true, AllowedTypes: []AbsenceType{{Code: "day_off", Label: "Отгул"}}}
	if len(domain) > 0 {
		configuration = domain[0]
	}
	allowed := false
	for _, kind := range configuration.AllowedTypes {
		if kind.Code == p.Type {
			allowed = true
		}
	}
	local := now.In(loc)
	today := time.Date(local.Year(), local.Month(), local.Day(), 0, 0, 0, 0, loc)
	if !allowed || date.Before(today.AddDate(0, 0, configuration.NoticePeriodDays)) {
		return ErrBusinessConflict
	}
	return nil
}
