package escalation

import (
	"encoding/json"
	"errors"
	"time"
)

var (
	ErrInvalid  = errors.New("invalid escalation answer")
	ErrNotFound = errors.New("escalation not found")
	ErrDenied   = errors.New("escalation access denied")
	ErrConflict = errors.New("escalation answer conflict")
)

type AnswerRequest struct {
	AnswerText string `json:"answer_text"`
	AddToKB    bool   `json:"add_to_kb"`
	Version    string `json:"version"`
}

type Answer struct {
	ID           string    `json:"id"`
	Status       string    `json:"status"`
	AnswerText   string    `json:"answer_text"`
	AnsweredBy   string    `json:"answered_by"`
	AnsweredAt   time.Time `json:"answered_at"`
	AddToKB      bool      `json:"add_to_kb"`
	KBDocumentID *string   `json:"kb_document_id"`
	KBStatus     string    `json:"kb_status"`
	Version      string    `json:"version"`
}

type ListQuery struct {
	Limit    int
	Cursor   string
	InternID string
	Status   string
}

type Publication struct {
	DocumentID      string  `json:"document_id"`
	Revision        int     `json:"revision"`
	Status          string  `json:"status"`
	IndexStatus     string  `json:"index_status"`
	IndexedRevision *int    `json:"indexed_revision"`
	IndexError      *string `json:"index_error"`
}

type Record struct {
	ID              string          `json:"id"`
	ActionID        string          `json:"action_id"`
	InternID        string          `json:"intern_id"`
	BuddyID         string          `json:"buddy_id"`
	Question        string          `json:"question"`
	ContextSnapshot json.RawMessage `json:"context_snapshot"`
	Status          string          `json:"status"`
	AnswerText      *string         `json:"answer_text"`
	AnsweredBy      *string         `json:"answered_by"`
	AnsweredAt      *time.Time      `json:"answered_at"`
	Publication     *Publication    `json:"publication"`
	Version         string          `json:"version"`
	CreatedAt       time.Time       `json:"created_at"`
	UpdatedAt       time.Time       `json:"updated_at"`
}

type Page struct {
	Items      []Record `json:"items"`
	NextCursor *string  `json:"next_cursor"`
}
