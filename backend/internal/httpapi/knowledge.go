package httpapi

import (
	"context"
	"errors"
	"net/http"
	"net/url"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/ai-buddy-hc2026/ai-buddy/backend/internal/auth"
	"github.com/ai-buddy-hc2026/ai-buddy/backend/internal/knowledge"
)

type KnowledgeStore interface {
	Search(context.Context, string, string) (knowledge.SearchResult, error)
}

func WithKnowledge(base http.Handler, authService *auth.Service, store KnowledgeStore) http.Handler {
	mux := http.NewServeMux()
	mux.Handle("GET /knowledge/search", RequireAuth(authService, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		values, err := url.ParseQuery(r.URL.RawQuery)
		if err != nil || len(values) != 1 || len(values["q"]) != 1 || utf8.RuneCountInString(values.Get("q")) == 0 || utf8.RuneCountInString(values.Get("q")) > 250 {
			writeAuthError(w, 400, "INVALID_REQUEST", "Укажите поисковый запрос q длиной от 1 до 250 символов.")
			return
		}
		user, ok := CurrentUser(r.Context())
		if !ok {
			writeAuthError(w, 401, "UNAUTHORIZED", "Требуется действительный токен.")
			return
		}
		ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
		defer cancel()
		result, err := store.Search(ctx, user.ID, strings.TrimSpace(values.Get("q")))
		if err != nil {
			switch {
			case errors.Is(err, auth.ErrUnauthorized):
				writeAuthError(w, 401, "UNAUTHORIZED", "Требуется действительный токен.")
			case errors.Is(err, knowledge.ErrInvalid):
				writeAuthError(w, 400, "INVALID_REQUEST", "Некорректный поисковый запрос.")
			case errors.Is(err, knowledge.ErrDenied):
				writeAuthError(w, 403, "POLICY_DENIED", "Поиск доступен только стажеру.")
			default:
				writeAuthError(w, 503, "SERVICE_UNAVAILABLE", "Поиск по базе знаний временно недоступен.")
			}
			return
		}
		writeOnboardingJSON(w, result)
	})))
	mux.Handle("/", base)
	return mux
}
