package httpapi

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"mime"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"

	"github.com/ai-buddy-hc2026/ai-buddy/backend/internal/auth"
	"github.com/ai-buddy-hc2026/ai-buddy/backend/internal/chat"
	"github.com/ai-buddy-hc2026/ai-buddy/backend/internal/identifier"
)

func chatError(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, auth.ErrUnauthorized):
		writeAuthError(w, 401, "UNAUTHORIZED", "Требуется действительный токен.")
	case errors.Is(err, chat.ErrInvalid):
		writeAuthError(w, 400, "INVALID_REQUEST", "Некорректные параметры сообщения.")
	case errors.Is(err, chat.ErrCursor):
		writeAuthError(w, 400, "INVALID_LAST_EVENT_ID", "Некорректный курсор потока или истории.")
	case errors.Is(err, chat.ErrNotFound):
		writeAuthError(w, 404, "NOT_FOUND", "Беседа или запрос не найдены.")
	case errors.Is(err, chat.ErrRunning):
		writeAuthError(w, 409, "GENERATION_IN_PROGRESS", "Дождитесь завершения текущего ответа.")
	default:
		writeAuthError(w, 503, "SERVICE_UNAVAILABLE", "Чат временно недоступен.")
	}
}

func postChat(service *chat.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		user, ok := CurrentUser(r.Context())
		if !ok {
			chatError(w, auth.ErrUnauthorized)
			return
		}
		media, _, err := mime.ParseMediaType(r.Header.Get("Content-Type"))
		if err != nil || media != "application/json" || r.URL.RawQuery != "" {
			chatError(w, chat.ErrInvalid)
			return
		}
		r.Body = http.MaxBytesReader(w, r.Body, 65536)
		decoder := json.NewDecoder(r.Body)
		decoder.DisallowUnknownFields()
		var input chat.Input
		if err := decoder.Decode(&input); err != nil || decoder.Decode(&struct{}{}) != io.EOF || !chat.ValidateInput(&input) {
			chatError(w, chat.ErrInvalid)
			return
		}
		// После сохранения генерация принадлежит сервису, а не соединению браузера.
		accepted, err := service.Start(r.Context(), user.ID, input)
		if err != nil {
			chatError(w, err)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		w.Header().Set("Cache-Control", "no-store")
		w.WriteHeader(http.StatusAccepted)
		_ = json.NewEncoder(w).Encode(accepted)
	}
}

func getChatHistory(service *chat.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		user, ok := CurrentUser(r.Context())
		if !ok {
			chatError(w, auth.ErrUnauthorized)
			return
		}
		query, err := url.ParseQuery(r.URL.RawQuery)
		if err != nil {
			chatError(w, chat.ErrInvalid)
			return
		}
		for key, values := range query {
			if (key != "conversation_id" && key != "cursor" && key != "limit") || len(values) != 1 {
				chatError(w, chat.ErrInvalid)
				return
			}
		}
		conv, cursor := query.Get("conversation_id"), query.Get("cursor")
		if (query.Has("conversation_id") && !identifier.ValidUUID(conv)) || (query.Has("cursor") && (cursor == "" || len(cursor) > 2048)) {
			chatError(w, chat.ErrInvalid)
			return
		}
		limit := 50
		if query.Has("limit") {
			limit, err = strconv.Atoi(query.Get("limit"))
			if err != nil || limit < 1 || limit > 100 {
				chatError(w, chat.ErrInvalid)
				return
			}
		}
		ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
		defer cancel()
		history, err := service.History(ctx, user.ID, conv, cursor, limit)
		if err != nil {
			chatError(w, err)
			return
		}
		writeOnboardingJSON(w, history)
	}
}

func lastEventID(r *http.Request, id string) (int, error) {
	values := r.Header.Values("Last-Event-ID")
	if len(values) == 0 {
		return 0, nil
	}
	if len(values) != 1 || len(values[0]) > 64 {
		return 0, chat.ErrCursor
	}
	parts := strings.Split(values[0], ":")
	if len(parts) != 2 || parts[0] != id || parts[1] == "" || parts[1][0] == '0' {
		return 0, chat.ErrCursor
	}
	for _, ch := range parts[1] {
		if ch < '0' || ch > '9' {
			return 0, chat.ErrCursor
		}
	}
	seq, err := strconv.ParseInt(parts[1], 10, 32)
	if err != nil || seq < 1 {
		return 0, chat.ErrCursor
	}
	return int(seq), nil
}

func streamChat(service *chat.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		user, ok := CurrentUser(r.Context())
		if !ok {
			chatError(w, auth.ErrUnauthorized)
			return
		}
		id := r.PathValue("id")
		if !identifier.ValidUUID(id) || r.URL.RawQuery != "" {
			chatError(w, chat.ErrInvalid)
			return
		}
		after, err := lastEventID(r, id)
		if err != nil {
			chatError(w, err)
			return
		}
		ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
		feed, err := service.Open(ctx, user.ID, id, after)
		cancel()
		if err != nil {
			chatError(w, err)
			return
		}
		serveFeed(w, r, feed, after, 15*time.Second)
	}
}

func serveFeed(w http.ResponseWriter, r *http.Request, feed *chat.Feed, after int, heartbeat time.Duration) {
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("X-Accel-Buffering", "no")
	controller := http.NewResponseController(w)
	flush := func() bool {
		_ = controller.SetWriteDeadline(time.Now().Add(5 * time.Second))
		return controller.Flush() == nil
	}
	if !flush() {
		return
	}
	defer func() { _ = controller.SetWriteDeadline(time.Time{}) }()
	ticker := time.NewTicker(heartbeat)
	defer ticker.Stop()
	for {
		events, done, changed := feed.Snapshot(after)
		for _, event := range events {
			raw, err := json.Marshal(event)
			if err != nil {
				return
			}
			_ = controller.SetWriteDeadline(time.Now().Add(5 * time.Second))
			if _, err := fmt.Fprintf(w, "id: %s:%d\nevent: %s\ndata: %s\n\n", event.RequestID, event.Seq, event.Type, raw); err != nil || !flush() {
				return
			}
			after = event.Seq
		}
		if done {
			return
		}
		select {
		case <-r.Context().Done():
			return
		case <-changed:
		case <-ticker.C:
			_ = controller.SetWriteDeadline(time.Now().Add(5 * time.Second))
			if _, err := io.WriteString(w, ": ping\n\n"); err != nil || !flush() {
				return
			}
		}
	}
}
