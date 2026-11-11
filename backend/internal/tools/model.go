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
	ErrInvalid      = errors.New("INVALID_ARGUMENT")
	ErrContext      = errors.New("INVALID_CONTEXT")
	ErrDenied       = errors.New("POLICY_DENIED")
	ErrConfirmation = errors.New("CONFIRMATION_REQUIRED")
	ErrConflict     = errors.New("IDEMPOTENCY_CONFLICT")
	ErrUnavailable  = errors.New("TOOL_UNAVAILABLE")
	ErrNoManager    = errors.New("MANAGER_NOT_ASSIGNED")
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
type Manager struct {
	ID   string `json:"id"`
	Name string `json:"name"`
}
type Absence struct {
	ID       string `json:"id"`
	Date     string `json:"date"`
	Type     string `json:"type"`
	Status   string `json:"status"`
	Approver string `json:"approver"`
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
func ValidateAbsence(p AbsenceParameters, now time.Time, timezone string) error {
	loc, err := time.LoadLocation(timezone)
	if err != nil {
		return ErrUnavailable
	}
	date, err := time.ParseInLocation(time.DateOnly, p.Date, loc)
	if err != nil || date.Format(time.DateOnly) != p.Date || (p.Type != "отгул" && p.Type != "отпуск") {
		return ErrInvalid
	}
	local := now.In(loc)
	today := time.Date(local.Year(), local.Month(), local.Day(), 0, 0, 0, 0, loc)
	if date.Before(today) || date.After(today.AddDate(0, 0, 365)) {
		return ErrInvalid
	}
	return nil
}
