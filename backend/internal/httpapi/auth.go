package httpapi

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"mime"
	"net/http"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/ai-buddy-hc2026/ai-buddy/backend/internal/auth"
)

type userContextKey struct{}

func CurrentUser(ctx context.Context) (auth.User, bool) {
	u, ok := ctx.Value(userContextKey{}).(auth.User)
	return u, ok
}

// RequireAuth проверяет токен и заново читает активного пользователя из БД.
// Проверки владельца и разрешённого действия выполняются обработчиком инструмента.
func RequireAuth(service *auth.Service, next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		parts := strings.Fields(r.Header.Get("Authorization"))
		if len(r.Header.Values("Authorization")) != 1 || len(parts) != 2 || !strings.EqualFold(parts[0], "Bearer") || len(parts[1]) > 8192 {
			writeAuthError(w, http.StatusUnauthorized, "UNAUTHORIZED", "Требуется действительный токен.")
			return
		}
		ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
		defer cancel()
		u, err := service.Authenticate(ctx, parts[1])
		if err != nil {
			if errors.Is(err, auth.ErrUnauthorized) {
				writeAuthError(w, http.StatusUnauthorized, "UNAUTHORIZED", "Требуется действительный токен.")
			} else {
				writeAuthError(w, http.StatusServiceUnavailable, "SERVICE_UNAVAILABLE", "Вход временно недоступен.")
			}
			return
		}
		// Таймаут поиска пользователя не ограничивает длительность последующего SSE.
		next.ServeHTTP(w, r.WithContext(context.WithValue(r.Context(), userContextKey{}, u)))
	})
}

func mockLogin(service *auth.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		media, _, err := mime.ParseMediaType(r.Header.Get("Content-Type"))
		if err != nil || media != "application/json" {
			writeAuthError(w, http.StatusBadRequest, "INVALID_REQUEST", "Ожидается JSON с логином.")
			return
		}
		r.Body = http.MaxBytesReader(w, r.Body, 4096)
		decoder := json.NewDecoder(r.Body)
		decoder.DisallowUnknownFields()
		var input struct {
			Login string `json:"login"`
		}
		if err := decoder.Decode(&input); err != nil || decoder.Decode(&struct{}{}) != io.EOF {
			writeAuthError(w, http.StatusBadRequest, "INVALID_REQUEST", "Ожидается JSON с логином.")
			return
		}
		input.Login = strings.TrimSpace(input.Login)
		if !utf8.ValidString(input.Login) || utf8.RuneCountInString(input.Login) < 1 || utf8.RuneCountInString(input.Login) > 100 {
			writeAuthError(w, http.StatusBadRequest, "INVALID_REQUEST", "Логин должен содержать 1-100 символов.")
			return
		}
		ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
		defer cancel()
		result, err := service.Login(ctx, input.Login)
		if err != nil {
			if errors.Is(err, auth.ErrUnauthorized) {
				writeAuthError(w, http.StatusUnauthorized, "INVALID_LOGIN", "Пользователь недоступен.")
			} else {
				writeAuthError(w, http.StatusServiceUnavailable, "SERVICE_UNAVAILABLE", "Вход временно недоступен.")
			}
			return
		}
		w.Header().Set("Content-Type", "application/json")
		w.Header().Set("Cache-Control", "no-store")
		_ = json.NewEncoder(w).Encode(result)
	}
}

func writeAuthError(w http.ResponseWriter, status int, code, message string) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store")
	if status == http.StatusUnauthorized {
		w.Header().Set("WWW-Authenticate", "Bearer")
	}
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(map[string]any{"error": map[string]string{"code": code, "message": message}})
}
