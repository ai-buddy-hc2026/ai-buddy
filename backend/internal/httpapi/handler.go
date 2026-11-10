package httpapi

import (
	"log/slog"
	"net/http"
	"time"
)

func NewHandler(logger *slog.Logger) http.Handler {
	mux := http.NewServeMux()
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
