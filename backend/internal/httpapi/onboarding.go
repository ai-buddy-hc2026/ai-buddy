package httpapi

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"mime"
	"net/http"
	"net/url"
	"time"

	"github.com/ai-buddy-hc2026/ai-buddy/backend/internal/auth"
	"github.com/ai-buddy-hc2026/ai-buddy/backend/internal/identifier"
	"github.com/ai-buddy-hc2026/ai-buddy/backend/internal/onboarding"
)

type OnboardingStore interface {
	GetPlan(context.Context, string, string) (onboarding.Plan, error)
	UpdateStatus(context.Context, string, string, onboarding.StatusChange) (onboarding.Task, error)
}

func getPlan(store OnboardingStore) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		user, ok := CurrentUser(r.Context())
		if !ok {
			writeAuthError(w, 401, "UNAUTHORIZED", "Требуется действительный токен.")
			return
		}
		query, err := url.ParseQuery(r.URL.RawQuery)
		if err != nil || len(query) > 1 || (len(query) == 1 && !query.Has("intern_id")) || len(query["intern_id"]) > 1 {
			writeAuthError(w, 400, "INVALID_REQUEST", "Некорректный параметр intern_id.")
			return
		}
		internID := query.Get("intern_id")
		if (query.Has("intern_id") && !identifier.ValidUUID(internID)) || (user.Role != "intern" && internID == "") {
			writeAuthError(w, 400, "INVALID_REQUEST", "Укажите UUID стажера в intern_id.")
			return
		}
		ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
		defer cancel()
		plan, err := store.GetPlan(ctx, user.ID, internID)
		if err != nil {
			writeOnboardingError(w, err)
			return
		}
		writeOnboardingJSON(w, plan)
	}
}

func updateTask(store OnboardingStore) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		user, ok := CurrentUser(r.Context())
		if !ok {
			writeAuthError(w, 401, "UNAUTHORIZED", "Требуется действительный токен.")
			return
		}
		id := r.PathValue("id")
		media, _, err := mime.ParseMediaType(r.Header.Get("Content-Type"))
		if !identifier.ValidUUID(id) || err != nil || media != "application/json" || r.URL.RawQuery != "" {
			writeAuthError(w, 400, "INVALID_REQUEST", "Ожидаются UUID задачи и JSON со status и version.")
			return
		}
		r.Body = http.MaxBytesReader(w, r.Body, 4096)
		decoder := json.NewDecoder(r.Body)
		decoder.DisallowUnknownFields()
		var change onboarding.StatusChange
		if err := decoder.Decode(&change); err != nil || decoder.Decode(&struct{}{}) != io.EOF || !onboarding.ValidStatus(change.Status) || change.Version < 1 {
			writeAuthError(w, 400, "INVALID_REQUEST", "Укажите допустимый status и положительную version.")
			return
		}
		ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
		defer cancel()
		task, err := store.UpdateStatus(ctx, user.ID, id, change)
		if err != nil {
			writeOnboardingError(w, err)
			return
		}
		writeOnboardingJSON(w, task)
	}
}

func writeOnboardingJSON(w http.ResponseWriter, value any) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store")
	_ = json.NewEncoder(w).Encode(value)
}

func writeOnboardingError(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, auth.ErrUnauthorized):
		writeAuthError(w, 401, "UNAUTHORIZED", "Требуется действительный токен.")
	case errors.Is(err, onboarding.ErrInvalidArgument):
		writeAuthError(w, 400, "INVALID_REQUEST", "Некорректные параметры запроса.")
	case errors.Is(err, onboarding.ErrNotFound):
		writeAuthError(w, 404, "NOT_FOUND", "Объект не найден или недоступен.")
	case errors.Is(err, onboarding.ErrForbidden):
		writeAuthError(w, 403, "POLICY_DENIED", "Изменить статус может только назначенный исполнитель.")
	case errors.Is(err, onboarding.ErrVersionConflict):
		writeAuthError(w, 409, "VERSION_CONFLICT", "Задача изменилась. Обновите план и повторите действие.")
	case errors.Is(err, onboarding.ErrPlanInactive):
		writeAuthError(w, 409, "PLAN_NOT_ACTIVE", "План больше не активен.")
	default:
		writeAuthError(w, 503, "SERVICE_UNAVAILABLE", "Онбординг временно недоступен.")
	}
}
