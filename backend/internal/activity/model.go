// Package activity описывает списки действий и назначенных стажеров.
package activity

import (
	"encoding/json"
	"errors"
	"time"

	"github.com/ai-buddy-hc2026/ai-buddy/backend/internal/auth"
)

var (
	ErrInvalid  = errors.New("invalid list request")
	ErrDenied   = errors.New("list policy denied")
	ErrNotFound = errors.New("list resource unavailable")
)

type Query struct {
	Limit                          int
	Cursor, Status, ConversationID string
}

func ValidStatus(status string) bool {
	switch status {
	case "proposed", "confirmed", "executing", "succeeded", "failed", "cancelled":
		return true
	default:
		return false
	}
}

type ErrorDetail struct {
	Code    string `json:"code"`
	Message string `json:"message"`
}
type Action struct {
	ID           string          `json:"id"`
	RequestID    string          `json:"request_id"`
	ProposalSeq  int             `json:"proposal_seq"`
	ActionType   string          `json:"action_type"`
	Details      json.RawMessage `json:"details"`
	Status       string          `json:"status"`
	Result       json.RawMessage `json:"result"`
	LastError    *ErrorDetail    `json:"last_error"`
	AttemptCount int             `json:"attempt_count"`
	CreatedAt    time.Time       `json:"created_at"`
	UpdatedAt    time.Time       `json:"updated_at"`
}
type ActionPage struct {
	Items      []Action `json:"items"`
	NextCursor *string  `json:"next_cursor"`
}
type InternPage struct {
	Items      []auth.User `json:"items"`
	NextCursor *string     `json:"next_cursor"`
}
