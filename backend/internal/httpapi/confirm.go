package httpapi

import (
	"context"
	"errors"
	"io"
	"net/http"
	"time"

	"github.com/ai-buddy-hc2026/ai-buddy/backend/internal/activity"
	"github.com/ai-buddy-hc2026/ai-buddy/backend/internal/auth"
	"github.com/ai-buddy-hc2026/ai-buddy/backend/internal/identifier"
	"github.com/ai-buddy-hc2026/ai-buddy/backend/internal/tools"
)

type ConfirmStore interface {
	Confirm(context.Context, string, string) (activity.Action, error)
}

func WithConfirmation(base http.Handler, authService *auth.Service, store ConfirmStore) http.Handler {
	mux := http.NewServeMux()
	mux.Handle("POST /actions/{id}/confirm", RequireAuth(authService, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		user, ok := CurrentUser(r.Context())
		if !ok {
			writeActivityError(w, auth.ErrUnauthorized)
			return
		}
		raw, err := io.ReadAll(http.MaxBytesReader(w, r.Body, 1))
		if err != nil || len(raw) != 0 || r.URL.RawQuery != "" || !identifier.ValidUUID(r.PathValue("id")) {
			writeActivityError(w, activity.ErrInvalid)
			return
		}
		ctx, cancel := context.WithTimeout(r.Context(), 10*time.Second)
		defer cancel()
		result, err := store.Confirm(ctx, user.ID, r.PathValue("id"))
		if err != nil {
			switch {
			case errors.Is(err, tools.ErrNotFound):
				writeActivityError(w, activity.ErrNotFound)
			case errors.Is(err, tools.ErrDenied):
				writeActivityError(w, activity.ErrDenied)
			case errors.Is(err, tools.ErrActionNotConfirmable):
				writeAuthError(w, 409, "ACTION_NOT_CONFIRMABLE", "Действие нельзя подтвердить.")
			default:
				writeActivityError(w, err)
			}
			return
		}
		w.Header().Set("Content-Type", "application/json")
		w.Header().Set("Cache-Control", "no-store")
		if result.Status == "confirmed" || result.Status == "executing" {
			w.WriteHeader(202)
		}
		writeOnboardingJSON(w, result)
	})))
	mux.Handle("/", base)
	return mux
}
