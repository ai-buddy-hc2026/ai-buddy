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
	"strings"
	"time"
	"unicode/utf8"

	"github.com/ai-buddy-hc2026/ai-buddy/backend/internal/auth"
	"github.com/ai-buddy-hc2026/ai-buddy/backend/internal/escalation"
	"github.com/ai-buddy-hc2026/ai-buddy/backend/internal/identifier"
)

type EscalationStore interface {
	List(context.Context, string, escalation.ListQuery) (escalation.Page, error)
	Answer(context.Context, string, string, escalation.AnswerRequest) (escalation.Answer, error)
}

func WithEscalations(base http.Handler, authService *auth.Service, store EscalationStore) http.Handler {
	mux := http.NewServeMux()
	mux.Handle("GET /buddy/escalations", RequireAuth(authService, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		user, ok := CurrentUser(r.Context())
		if !ok {
			writeAuthError(w, 401, "UNAUTHORIZED", "Требуется действительный токен.")
			return
		}
		query, err := parseEscalationListQuery(r.URL.RawQuery)
		if err != nil {
			writeAuthError(w, 400, "INVALID_REQUEST", "Некорректные фильтры эскалаций.")
			return
		}
		ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
		defer cancel()
		page, err := store.List(ctx, user.ID, query)
		if err != nil {
			switch {
			case errors.Is(err, auth.ErrUnauthorized):
				writeAuthError(w, 401, "UNAUTHORIZED", "Требуется действительный токен.")
			case errors.Is(err, escalation.ErrDenied):
				writeAuthError(w, 403, "POLICY_DENIED", "Эскалации доступны только назначенному наставнику.")
			case errors.Is(err, escalation.ErrInvalid):
				writeAuthError(w, 400, "INVALID_REQUEST", "Некорректные фильтры эскалаций.")
			default:
				writeAuthError(w, 503, "SERVICE_UNAVAILABLE", "Список эскалаций временно недоступен.")
			}
			return
		}
		writeOnboardingJSON(w, page)
	})))
	mux.Handle("POST /buddy/escalations/{id}/answer", RequireAuth(authService, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		user, ok := CurrentUser(r.Context())
		if !ok {
			writeAuthError(w, 401, "UNAUTHORIZED", "Требуется действительный токен.")
			return
		}
		media, _, err := mime.ParseMediaType(r.Header.Get("Content-Type"))
		id := r.PathValue("id")
		if err != nil || media != "application/json" || r.URL.RawQuery != "" || !identifier.ValidUUID(id) {
			writeAuthError(w, 400, "INVALID_REQUEST", "Ожидаются UUID эскалации и JSON с answer_text, add_to_kb и version.")
			return
		}
		r.Body = http.MaxBytesReader(w, r.Body, 90000)
		decoder := json.NewDecoder(r.Body)
		decoder.DisallowUnknownFields()
		var body struct {
			AnswerText string `json:"answer_text"`
			AddToKB    *bool  `json:"add_to_kb"`
			Version    string `json:"version"`
		}
		if err := decoder.Decode(&body); err != nil || decoder.Decode(&struct{}{}) != io.EOF || body.AddToKB == nil || !utf8.ValidString(body.AnswerText) || strings.TrimSpace(body.AnswerText) == "" || utf8.RuneCountInString(body.AnswerText) > 20000 || body.Version == "" || len(body.Version) > 64 {
			writeAuthError(w, 400, "INVALID_REQUEST", "Укажите непустой answer_text, add_to_kb и version.")
			return
		}
		request := escalation.AnswerRequest{AnswerText: body.AnswerText, AddToKB: *body.AddToKB, Version: body.Version}
		ctx, cancel := context.WithTimeout(r.Context(), 10*time.Second)
		defer cancel()
		answer, err := store.Answer(ctx, user.ID, id, request)
		if err != nil {
			switch {
			case errors.Is(err, auth.ErrUnauthorized):
				writeAuthError(w, 401, "UNAUTHORIZED", "Требуется действительный токен.")
			case errors.Is(err, escalation.ErrInvalid):
				writeAuthError(w, 400, "INVALID_REQUEST", "Некорректный ответ наставника.")
			case errors.Is(err, escalation.ErrDenied):
				writeAuthError(w, 403, "POLICY_DENIED", "Ответ доступен только назначенному наставнику.")
			case errors.Is(err, escalation.ErrNotFound):
				writeAuthError(w, 404, "NOT_FOUND", "Эскалация не найдена или недоступна.")
			case errors.Is(err, escalation.ErrConflict):
				writeAuthError(w, 409, "VERSION_CONFLICT", "Эскалация изменилась или уже закрыта.")
			default:
				writeAuthError(w, 503, "SERVICE_UNAVAILABLE", "Не удалось сохранить ответ наставника.")
			}
			return
		}
		writeOnboardingJSON(w, answer)
	})))
	mux.Handle("/", base)
	return mux
}

func parseEscalationListQuery(raw string) (escalation.ListQuery, error) {
	query := escalation.ListQuery{Limit: 50}
	values, err := url.ParseQuery(raw)
	if err != nil {
		return query, escalation.ErrInvalid
	}
	for key, items := range values {
		if len(items) != 1 || items[0] == "" {
			return query, escalation.ErrInvalid
		}
		switch key {
		case "limit":
			query.Limit, err = strconv.Atoi(items[0])
			if err != nil || query.Limit < 1 || query.Limit > 100 {
				return query, escalation.ErrInvalid
			}
		case "cursor":
			if len(items[0]) > 2048 {
				return query, escalation.ErrInvalid
			}
			query.Cursor = items[0]
		case "intern_id":
			if !identifier.ValidUUID(items[0]) {
				return query, escalation.ErrInvalid
			}
			query.InternID = items[0]
		case "status":
			if items[0] != "open" && items[0] != "answered" && items[0] != "closed" {
				return query, escalation.ErrInvalid
			}
			query.Status = items[0]
		default:
			return query, escalation.ErrInvalid
		}
	}
	return query, nil
}
