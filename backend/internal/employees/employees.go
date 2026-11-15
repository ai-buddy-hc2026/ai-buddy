// Package employees описывает публичный справочник коллег, отдельно от прав входа.
package employees

import (
	"errors"
	"strings"
	"unicode/utf8"
)

var ErrInvalid = errors.New("invalid employee query")

type Employee struct {
	ID            string   `json:"id"`
	TeamID        string   `json:"team_id"`
	TeamName      string   `json:"team_name"`
	UserID        *string  `json:"user_id"`
	DisplayName   string   `json:"display_name"`
	ShortName     string   `json:"short_name"`
	JobTitle      string   `json:"job_title"`
	Kind          string   `json:"kind"`
	Tags          []string `json:"tags"`
	AskAbout      string   `json:"ask_about"`
	ContactHandle *string  `json:"contact_handle"`
	IsKeyContact  bool     `json:"is_key_contact"`
	SortOrder     int      `json:"sort_order"`
}

type Query struct {
	Search string
	Limit  int
	Cursor string
}

type Page struct {
	Items      []Employee `json:"items"`
	NextCursor *string    `json:"next_cursor"`
}

func NormalizeSearch(value string) string { return strings.ToLower(strings.TrimSpace(value)) }

func ValidQuery(q Query) bool {
	return utf8.ValidString(q.Search) && utf8.RuneCountInString(q.Search) <= 200 && q.Limit >= 1 && q.Limit <= 100 && len(q.Cursor) <= 2048
}
