package httpapi

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"mime"
	"net/http"
	"net/url"
	"strconv"
	"time"

	"github.com/ai-buddy-hc2026/ai-buddy/backend/internal/auth"
	"github.com/ai-buddy-hc2026/ai-buddy/backend/internal/identifier"
	"github.com/ai-buddy-hc2026/ai-buddy/backend/internal/notifications"
)

type NotificationStore interface {
	Settings(context.Context, string) (notifications.Settings, error)
	UpdateSettings(context.Context, string, notifications.SettingsInput) (notifications.Settings, error)
	List(context.Context, string, notifications.Query) (notifications.Page, error)
	Read(context.Context, string, string) (notifications.Notification, error)
	Resource(context.Context, string, string) (notifications.Resource, error)
}

func notificationQuery(raw string) (notifications.Query, error) {
	q := notifications.Query{Limit: 20}
	values, err := url.ParseQuery(raw)
	if err != nil {
		return q, notifications.ErrInvalid
	}
	for key, items := range values {
		if len(items) != 1 || items[0] == "" {
			return q, notifications.ErrInvalid
		}
		switch key {
		case "limit":
			q.Limit, err = strconv.Atoi(items[0])
			if err != nil {
				return q, notifications.ErrInvalid
			}
		case "cursor":
			q.Cursor = items[0]
		default:
			return q, notifications.ErrInvalid
		}
	}
	if q.Limit < 1 || q.Limit > 100 || len(q.Cursor) > 2048 {
		return q, notifications.ErrInvalid
	}
	return q, nil
}

func WithNotifications(base http.Handler, service *auth.Service, store NotificationStore) http.Handler {
	mux := http.NewServeMux()
	wrap := func(action string) http.Handler {
		return RequireAuth(service, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			user, _ := CurrentUser(r.Context())
			ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
			defer cancel()
			var result any
			var err error
			if action != "list" && r.URL.RawQuery != "" {
				writeNotificationError(w, notifications.ErrInvalid)
				return
			}
			switch action {
			case "settings":
				result, err = store.Settings(ctx, user.ID)
			case "update":
				var input notifications.SettingsInput
				media, _, parseErr := mime.ParseMediaType(r.Header.Get("Content-Type"))
				if parseErr != nil || media != "application/json" {
					writeNotificationError(w, notifications.ErrInvalid)
					return
				}
				decoder := json.NewDecoder(http.MaxBytesReader(w, r.Body, 8192))
				decoder.DisallowUnknownFields()
				if decoder.Decode(&input) != nil || decoder.Decode(new(any)) != io.EOF || !input.Valid() {
					writeNotificationError(w, notifications.ErrInvalid)
					return
				}
				result, err = store.UpdateSettings(ctx, user.ID, input)
			case "list":
				var query notifications.Query
				query, err = notificationQuery(r.URL.RawQuery)
				if err == nil {
					result, err = store.List(ctx, user.ID, query)
				}
			case "read", "resource":
				id := r.PathValue("id")
				if !identifier.ValidUUID(id) {
					writeNotificationError(w, notifications.ErrInvalid)
					return
				}
				if action == "read" {
					raw, readErr := io.ReadAll(http.MaxBytesReader(w, r.Body, 1))
					if readErr != nil || len(raw) != 0 {
						writeNotificationError(w, notifications.ErrInvalid)
						return
					}
					result, err = store.Read(ctx, user.ID, id)
				} else {
					result, err = store.Resource(ctx, user.ID, id)
				}
			}
			if err != nil {
				writeNotificationError(w, err)
				return
			}
			w.Header().Set("Cache-Control", "no-store")
			writeOnboardingJSON(w, result)
		}))
	}
	mux.Handle("GET /me/settings", wrap("settings"))
	mux.Handle("PATCH /me/settings", wrap("update"))
	mux.Handle("GET /notifications", wrap("list"))
	mux.Handle("PATCH /notifications/{id}/read", wrap("read"))
	mux.Handle("GET /notifications/{id}/resource", wrap("resource"))
	mux.Handle("/", base)
	return mux
}

func writeNotificationError(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, notifications.ErrInvalid):
		writeAuthError(w, 400, "INVALID_REQUEST", "Проверь параметры уведомлений и рабочие часы.")
	case errors.Is(err, notifications.ErrConflict):
		writeAuthError(w, 409, "VERSION_CONFLICT", "Настройки изменились. Обнови страницу и повтори сохранение.")
	case errors.Is(err, notifications.ErrNotFound):
		writeAuthError(w, 404, "NOT_FOUND", "Уведомление или связанный материал недоступны.")
	case errors.Is(err, notifications.ErrDenied):
		writeAuthError(w, 403, "POLICY_DENIED", "Недостаточно прав для уведомлений.")
	case errors.Is(err, auth.ErrUnauthorized):
		writeAuthError(w, 401, "UNAUTHORIZED", "Требуется действительный токен.")
	default:
		writeAuthError(w, 503, "SERVICE_UNAVAILABLE", "Уведомления временно недоступны.")
	}
}
