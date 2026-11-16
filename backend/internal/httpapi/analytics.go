package httpapi

import (
	"context"
	"errors"
	"net/http"
	"time"

	"github.com/ai-buddy-hc2026/ai-buddy/backend/internal/analytics"
	"github.com/ai-buddy-hc2026/ai-buddy/backend/internal/auth"
)

type AnalyticsStore interface {
	Summary(context.Context, string) (analytics.Summary, error)
}

// WithAnalytics добавляет GET /analytics/summary (SA-6) для lead и buddy.
func WithAnalytics(base http.Handler, authService *auth.Service, store AnalyticsStore) http.Handler {
	mux := http.NewServeMux()
	mux.Handle("GET /analytics/summary", RequireAuth(authService, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		user, ok := CurrentUser(r.Context())
		if !ok {
			writeAuthError(w, 401, "UNAUTHORIZED", "Требуется действительный токен.")
			return
		}
		if r.URL.RawQuery != "" {
			writeAuthError(w, 400, "INVALID_REQUEST", "Параметры не поддерживаются.")
			return
		}
		ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
		defer cancel()
		summary, err := store.Summary(ctx, user.ID)
		if err != nil {
			switch {
			case errors.Is(err, auth.ErrUnauthorized):
				writeAuthError(w, 401, "UNAUTHORIZED", "Требуется действительный токен.")
			case errors.Is(err, analytics.ErrDenied):
				writeAuthError(w, 403, "POLICY_DENIED", "Метрики доступны наставнику и руководителю.")
			default:
				writeAuthError(w, 503, "SERVICE_UNAVAILABLE", "Метрики временно недоступны.")
			}
			return
		}
		writeOnboardingJSON(w, summary)
	})))
	mux.Handle("/", base)
	return mux
}
