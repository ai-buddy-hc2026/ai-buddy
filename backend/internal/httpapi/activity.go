package httpapi

import (
	"context"
	"errors"
	"net/http"
	"net/url"
	"strconv"
	"time"

	"github.com/ai-buddy-hc2026/ai-buddy/backend/internal/activity"
	"github.com/ai-buddy-hc2026/ai-buddy/backend/internal/auth"
	"github.com/ai-buddy-hc2026/ai-buddy/backend/internal/identifier"
)

type ListingStore interface {
	ListInterns(context.Context, string, activity.Query) (activity.InternPage, error)
	ListActions(context.Context, string, activity.Query) (activity.ActionPage, error)
}

// WithListings подключает списки независимо от доступности LLM и MCP.
func WithListings(base http.Handler, service *auth.Service, store ListingStore) http.Handler {
	mux := http.NewServeMux()
	mux.Handle("GET /buddy/interns", RequireAuth(service, listActivity(store, true)))
	mux.Handle("GET /actions", RequireAuth(service, listActivity(store, false)))
	mux.Handle("/", base)
	return mux
}

func parseListQuery(raw string, interns bool) (activity.Query, error) {
	q := activity.Query{Limit: 50}
	values, err := url.ParseQuery(raw)
	if err != nil {
		return q, activity.ErrInvalid
	}
	for key, items := range values {
		if len(items) != 1 || items[0] == "" {
			return q, activity.ErrInvalid
		}
		switch key {
		case "limit":
			q.Limit, err = strconv.Atoi(items[0])
			if err != nil || q.Limit < 1 || q.Limit > 100 {
				return q, activity.ErrInvalid
			}
		case "cursor":
			if len(items[0]) > 2048 {
				return q, activity.ErrInvalid
			}
			q.Cursor = items[0]
		case "status":
			if interns || !activity.ValidStatus(items[0]) {
				return q, activity.ErrInvalid
			}
			q.Status = items[0]
		case "conversation_id":
			if interns || !identifier.ValidUUID(items[0]) {
				return q, activity.ErrInvalid
			}
			q.ConversationID = items[0]
		default:
			return q, activity.ErrInvalid
		}
	}
	return q, nil
}

func listActivity(store ListingStore, interns bool) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		user, ok := CurrentUser(r.Context())
		if !ok {
			writeActivityError(w, auth.ErrUnauthorized)
			return
		}
		query, err := parseListQuery(r.URL.RawQuery, interns)
		if err != nil {
			writeActivityError(w, err)
			return
		}
		ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
		defer cancel()
		var result any
		if interns {
			result, err = store.ListInterns(ctx, user.ID, query)
		} else {
			result, err = store.ListActions(ctx, user.ID, query)
		}
		if err != nil {
			writeActivityError(w, err)
			return
		}
		writeOnboardingJSON(w, result)
	})
}

func writeActivityError(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, auth.ErrUnauthorized):
		writeAuthError(w, 401, "UNAUTHORIZED", "Требуется действительный токен.")
	case errors.Is(err, activity.ErrInvalid):
		writeAuthError(w, 400, "INVALID_REQUEST", "Некорректные параметры списка или курсор.")
	case errors.Is(err, activity.ErrDenied):
		writeAuthError(w, 403, "POLICY_DENIED", "Операция недоступна для текущего пользователя.")
	case errors.Is(err, activity.ErrNotFound):
		writeAuthError(w, 404, "NOT_FOUND", "Объект не найден или недоступен.")
	default:
		writeAuthError(w, 503, "SERVICE_UNAVAILABLE", "Список временно недоступен.")
	}
}
