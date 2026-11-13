package chat

import (
	"encoding/json"
	"errors"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/ai-buddy-hc2026/ai-buddy/backend/internal/identifier"
)

const MaxBuffer = 4 << 20

var (
	ErrNotFound    = errors.New("chat not found")
	ErrInvalid     = errors.New("invalid chat request")
	ErrRunning     = errors.New("generation already running")
	ErrCursor      = errors.New("invalid chat cursor")
	ErrUnavailable = errors.New("chat unavailable")
)

type Error struct {
	Code    string `json:"code"`
	Message string `json:"message"`
}
type Input struct {
	ConversationID string `json:"conversation_id,omitempty"`
	Message        string `json:"message"`
}
type HistoryMessage struct {
	Role    string `json:"role"`
	Content string `json:"content"`
}
type Payload struct {
	RequestID      string           `json:"request_id"`
	ConversationID string           `json:"conversation_id"`
	UserID         string           `json:"user_id"`
	TeamID         string           `json:"team_id"`
	Role           string           `json:"role"`
	Stage          string           `json:"stage"`
	Timestamp      time.Time        `json:"timestamp"`
	Timezone       string           `json:"timezone"`
	Message        string           `json:"message"`
	History        []HistoryMessage `json:"history"`
}
type Request struct {
	RequestID  string     `json:"request_id"`
	Status     string     `json:"status"`
	CreatedAt  time.Time  `json:"created_at"`
	FinishedAt *time.Time `json:"finished_at"`
	Error      *Error     `json:"error"`
	StreamURL  string     `json:"stream_url"`
}
type Record struct {
	Request
	ConversationID   string
	UserID           string
	TeamID           string
	LastSeq          int
	FullText         string
	AnswerStatus     string
	QuestionCategory string
}
type Accepted struct {
	RequestID      string `json:"request_id"`
	ConversationID string `json:"conversation_id"`
	Status         string `json:"status"`
	StreamURL      string `json:"stream_url"`
}
type Message struct {
	ID        string            `json:"id"`
	Role      string            `json:"role"`
	Content   string            `json:"content"`
	Sources   []json.RawMessage `json:"sources"`
	CreatedAt time.Time         `json:"created_at"`
}
type Turn struct {
	Request  Request           `json:"request"`
	Messages []Message         `json:"messages"`
	Actions  []json.RawMessage `json:"actions"`
}
type History struct {
	ConversationID *string  `json:"conversation_id"`
	Items          []Turn   `json:"items"`
	ActiveRequest  *Request `json:"active_request"`
	NextCursor     *string  `json:"next_cursor"`
}
type Event struct {
	Type      string          `json:"event"`
	RequestID string          `json:"request_id"`
	Seq       int             `json:"seq"`
	Data      json.RawMessage `json:"data"`
}
type Token struct {
	Text *string `json:"text"`
}
type Done struct {
	FullText         *string           `json:"full_text"`
	Sources          []json.RawMessage `json:"sources"`
	AnswerStatus     string            `json:"answer_status,omitempty"`
	QuestionCategory string            `json:"question_category,omitempty"`
}

// ValidMetadata допускает старый протокол без обеих меток на время обновления Python.
func (done Done) ValidMetadata() bool {
	if done.AnswerStatus == "" && done.QuestionCategory == "" {
		return true
	}
	validStatus := done.AnswerStatus == "answered" || done.AnswerStatus == "unknown"
	validCategory := done.QuestionCategory == "task" || done.QuestionCategory == "process" || done.QuestionCategory == "access" || done.QuestionCategory == "technical" || done.QuestionCategory == "other"
	return validStatus && validCategory
}

func StreamURL(id string) string { return "/chat/stream/" + id }

func ValidateInput(input *Input) bool {
	input.Message = strings.TrimSpace(input.Message)
	return utf8.ValidString(input.Message) && utf8.RuneCountInString(input.Message) > 0 && utf8.RuneCountInString(input.Message) <= 4000 &&
		(input.ConversationID == "" || identifier.ValidUUID(input.ConversationID))
}

func NewEvent(id string, seq int, kind string, data any) Event {
	raw, _ := json.Marshal(data) // Только локальные Token/Done/Error с JSON-совместимыми полями.
	return Event{Type: kind, RequestID: id, Seq: seq, Data: raw}
}

func Failure(id string, seq int, code string) Event {
	message := map[string]string{
		"AI_UNAVAILABLE":     "Ассистент временно недоступен.",
		"GENERATION_TIMEOUT": "Превышено время ожидания ответа.",
		"STREAM_INTERRUPTED": "Поток ответа прерван. Повторите запрос.",
		"INVALID_AI_EVENT":   "Получен некорректный ответ AI-сервиса.",
		"BUFFER_LIMIT":       "Ответ превысил допустимый размер.",
		"PERSISTENCE_ERROR":  "Не удалось сохранить ответ.",
		"LLM_TIMEOUT":        "Превышено время ожидания ответа от языковой модели.",
		"LLM_UNAVAILABLE":    "Ассистент временно недоступен.",
		"TOOL_FAILED":        "Не удалось завершить обращение к инструменту.",
		"INTERNAL_ERROR":     "Не удалось завершить генерацию ответа.",
	}[code]
	if message == "" {
		code, message = "INTERNAL_ERROR", "Не удалось завершить генерацию ответа."
	}
	return NewEvent(id, seq, "error", Error{Code: code, Message: message})
}

// ParseEvent проверяет транспорт; предложения дополнительно проверяет Go-хранилище.
func ParseEvent(raw []byte, id string) (Event, error) {
	var event Event
	if !utf8.Valid(raw) || json.Unmarshal(raw, &event) != nil || event.RequestID != id || !identifier.ValidUUID(event.RequestID) || event.Seq < 1 || len(event.Data) == 0 {
		return event, ErrInvalid
	}
	switch event.Type {
	case "token":
		var token Token
		if json.Unmarshal(event.Data, &token) != nil || token.Text == nil || *token.Text == "" {
			return event, ErrInvalid
		}
		event.Data, _ = json.Marshal(token)
	case "done":
		var done Done
		if json.Unmarshal(event.Data, &done) != nil || done.FullText == nil || utf8.RuneCountInString(*done.FullText) > 20000 || done.Sources == nil || len(done.Sources) != 0 ||
			!done.ValidMetadata() {
			return event, ErrInvalid
		}
		event.Data, _ = json.Marshal(done)
	case "tool_call", "action_proposal":
		var value map[string]json.RawMessage
		if json.Unmarshal(event.Data, &value) != nil || value == nil {
			return event, ErrInvalid
		}
		event.Data, _ = json.Marshal(value)
	case "error":
		var failure Error
		if json.Unmarshal(event.Data, &failure) != nil || strings.TrimSpace(failure.Message) == "" {
			return event, ErrInvalid
		}
		switch failure.Code {
		case "LLM_TIMEOUT", "LLM_UNAVAILABLE", "TOOL_FAILED", "INTERNAL_ERROR":
			event = Failure(id, event.Seq, failure.Code) // Технические подробности Python не выходят в UI.
		default:
			return event, ErrInvalid
		}
	default:
		return event, ErrInvalid
	}
	return event, nil
}
