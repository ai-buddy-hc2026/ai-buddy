package database

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"strings"
	"time"

	"github.com/ai-buddy-hc2026/ai-buddy/backend/internal/activity"
	"github.com/ai-buddy-hc2026/ai-buddy/backend/internal/identifier"
)

type listScope struct {
	Kind, Actor, Team, Status, Conversation, Role string
	Search                                        string
	Limit                                         int
}
type listCursor struct {
	Version   int
	Scope     listScope
	ID        string
	CreatedAt time.Time
	SortOrder int
}

func (s *Listings) encodeCursor(scope listScope, id string, created time.Time) string {
	return s.encodeCursorValue(listCursor{Version: 1, Scope: scope, ID: id, CreatedAt: created.UTC()})
}

func (s *Listings) encodeCursorValue(cursor listCursor) string {
	data, _ := json.Marshal(cursor)
	mac := hmac.New(sha256.New, s.cursorKey[:])
	_, _ = mac.Write(data)
	return base64.RawURLEncoding.EncodeToString(data) + "." + base64.RawURLEncoding.EncodeToString(mac.Sum(nil))
}

func (s *Listings) decodeCursor(raw string, scope listScope) (listCursor, error) {
	var cursor listCursor
	if len(raw) > 2048 {
		return cursor, activity.ErrInvalid
	}
	parts := strings.Split(raw, ".")
	if len(parts) != 2 {
		return cursor, activity.ErrInvalid
	}
	data, err := base64.RawURLEncoding.DecodeString(parts[0])
	if err != nil {
		return cursor, activity.ErrInvalid
	}
	signature, err := base64.RawURLEncoding.DecodeString(parts[1])
	if err != nil {
		return cursor, activity.ErrInvalid
	}
	mac := hmac.New(sha256.New, s.cursorKey[:])
	_, _ = mac.Write(data)
	if !hmac.Equal(signature, mac.Sum(nil)) || json.Unmarshal(data, &cursor) != nil || cursor.Version != 1 || cursor.Scope != scope || !identifier.ValidUUID(cursor.ID) || (scope.Kind == "actions" && cursor.CreatedAt.IsZero()) {
		return listCursor{}, activity.ErrInvalid
	}
	return cursor, nil
}
