package httpapi

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"net/http"
	"time"

	"github.com/ai-buddy-hc2026/ai-buddy/backend/internal/auth"
	"github.com/ai-buddy-hc2026/ai-buddy/backend/internal/features"
	"github.com/ai-buddy-hc2026/ai-buddy/backend/internal/identifier"
)

// ActionTypeStore находит тип действия владельца; пустая строка - действия нет.
type ActionTypeStore interface {
	ActionType(ctx context.Context, actorID, actionID string) (string, error)
}

const maxAnswerBody = 64 << 10

// WithFeatures добавляет GET /features и выключает сценарии по флагам (V-10).
// Обертка стоит снаружи остальных маршрутов, права по-прежнему проверяет base.
func WithFeatures(base http.Handler, authService *auth.Service, flags features.Flags, actions ActionTypeStore) http.Handler {
	mux := http.NewServeMux()
	mux.Handle("GET /features", RequireAuth(authService, http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		writeOnboardingJSON(w, flags.Map())
	})))
	mux.Handle("POST /chat/messages", gate(flags, features.Chat, base))
	mux.Handle("POST /actions/{id}/confirm", RequireAuth(authService, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		user, ok := CurrentUser(r.Context())
		id := r.PathValue("id")
		if ok && identifier.ValidUUID(id) && actions != nil {
			ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
			actionType, err := actions.ActionType(ctx, user.ID, id)
			cancel()
			if err != nil {
				writeAuthError(w, 503, "SERVICE_UNAVAILABLE", "Действие временно недоступно.")
				return
			}
			if key := features.ForAction(actionType); key != "" && !flags.Enabled(key) {
				writeFeatureDisabled(w, key)
				return
			}
		}
		base.ServeHTTP(w, r)
	})))
	mux.Handle("POST /buddy/escalations/{id}/answer", http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// Выключенные эскалации запрещают только новые вопросы; ответы на уже созданные остаются.
		if flags.Enabled(features.KBPublish) {
			base.ServeHTTP(w, r)
			return
		}
		raw, err := io.ReadAll(http.MaxBytesReader(w, r.Body, maxAnswerBody))
		if err != nil {
			writeAuthError(w, 400, "INVALID_REQUEST", "Проверь поля ответа.")
			return
		}
		var body struct {
			AddToKB bool `json:"add_to_kb"`
		}
		if json.Unmarshal(raw, &body) == nil && body.AddToKB {
			writeFeatureDisabled(w, features.KBPublish)
			return
		}
		r.Body = io.NopCloser(bytes.NewReader(raw))
		base.ServeHTTP(w, r)
	}))
	mux.Handle("/", base)
	return mux
}

func gate(flags features.Flags, key string, next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !flags.Enabled(key) {
			writeFeatureDisabled(w, key)
			return
		}
		next.ServeHTTP(w, r)
	})
}

func writeFeatureDisabled(w http.ResponseWriter, key string) {
	status := http.StatusConflict
	if key == features.Chat {
		status = http.StatusServiceUnavailable
	}
	writeAuthError(w, status, "FEATURE_DISABLED", "Сценарий временно выключен: "+key+".")
}
