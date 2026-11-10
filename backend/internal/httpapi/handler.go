package httpapi

import (
	"encoding/json"
	"log/slog"
	"net/http"
	"time"

	"github.com/ai-buddy-hc2026/ai-buddy/backend/internal/auth"
)

func NewHandler(logger *slog.Logger, service *auth.Service) http.Handler {
	mux := http.NewServeMux()
	if service != nil {
		mux.HandleFunc("POST /auth/mock-login", mockLogin(service))
		mux.Handle("GET /me", RequireAuth(service, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			u, ok := CurrentUser(r.Context())
			if !ok {
				writeAuthError(w, http.StatusUnauthorized, "UNAUTHORIZED", "Требуется действительный токен.")
				return
			}
			w.Header().Set("Content-Type", "application/json")
			w.Header().Set("Cache-Control", "no-store")
			_ = json.NewEncoder(w).Encode(u)
		})))
	}
	mux.HandleFunc("GET /health", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		if _, err := w.Write([]byte("{\"status\":\"ok\"}\n")); err != nil {
			logger.ErrorContext(r.Context(), "write health response", "error", err)
		}
	})
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()
		mux.ServeHTTP(w, r)
		logger.InfoContext(r.Context(), "http request",
			"method", r.Method, "path", r.URL.Path, "duration", time.Since(start))
	})
}
