package mocks

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"regexp"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/ai-buddy-hc2026/ai-buddy/backend/internal/auth"
	"github.com/ai-buddy-hc2026/ai-buddy/backend/internal/httpapi"
	"github.com/ai-buddy-hc2026/ai-buddy/backend/internal/identifier"
	"github.com/ai-buddy-hc2026/ai-buddy/backend/internal/tools"
)

const (
	requestTimeout = 10 * time.Second
	maxBodyBytes   = 4 << 10
	maxTopicRunes  = 200
)

var codePattern = regexp.MustCompile(`^[a-z][a-z0-9_-]{0,63}$`)

type handler struct {
	db  Querier
	now func() time.Time
}

type routeFunc func(*http.Request, auth.User) (int, any, error)

// Register добавляет HTTP-эндпоинты моков поверх base. Все маршруты требуют токен.
func Register(base http.Handler, service *auth.Service, db Querier) http.Handler {
	if service == nil || db == nil {
		return base
	}
	h := handler{db: db, now: time.Now}
	mux := http.NewServeMux()
	routes := map[string]routeFunc{
		"GET /employees":                         h.employees,
		"GET /employees/owner":                   h.owner,
		"GET /employees/me/first-day":            h.firstDay,
		"GET /calendar/{code}/office-hours":      h.officeHours,
		"GET /calendar/bookings":                 h.bookings,
		"POST /calendar/bookings":                h.book,
		"GET /learning/courses":                  h.courses,
		"POST /learning/courses/{code}/complete": h.completeCourse,
		"GET /access":                            h.access,
		"POST /access/requests":                  h.requestAccess,
		"GET /map":                               h.mapPlaces,
	}
	for pattern, route := range routes {
		mux.Handle(pattern, httpapi.RequireAuth(service, serve(route)))
	}
	mux.Handle("/", base)
	return mux
}

func serve(route routeFunc) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		user, ok := httpapi.CurrentUser(r.Context())
		if !ok {
			writeError(w, http.StatusUnauthorized, "UNAUTHORIZED", "Требуется действительный токен.")
			return
		}
		ctx, cancel := context.WithTimeout(r.Context(), requestTimeout)
		defer cancel()
		status, body, err := route(r.WithContext(ctx), user)
		if err != nil {
			writeFailure(r.Context(), w, err)
			return
		}
		w.Header().Set("Cache-Control", "no-store")
		if body == nil {
			w.WriteHeader(status)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(status)
		_ = json.NewEncoder(w).Encode(body)
	})
}

func (h handler) employees(r *http.Request, user auth.User) (int, any, error) {
	items, err := TeamEmployees(r.Context(), h.db, user.Team.ID)
	return http.StatusOK, map[string]any{"items": items}, err
}

func (h handler) owner(r *http.Request, user auth.User) (int, any, error) {
	topic := strings.TrimSpace(r.URL.Query().Get("topic"))
	if topic == "" || utf8.RuneCountInString(topic) > maxTopicRunes {
		return 0, nil, tools.ErrInvalid
	}
	team, err := TeamEmployees(r.Context(), h.db, user.Team.ID)
	if err != nil {
		return 0, nil, err
	}
	mentor, err := MentorCode(r.Context(), h.db, user.ID)
	if err != nil {
		return 0, nil, err
	}
	match := MatchOwner(topic, team, mentor)
	return http.StatusOK, map[string]any{"owner": match.Owner, "matched_tag": match.MatchedTag, "fallback": match.Fallback}, nil
}

func (h handler) firstDay(r *http.Request, user auth.User) (int, any, error) {
	raw, err := FirstDay(r.Context(), h.db, user.ID)
	if err != nil {
		return 0, nil, err
	}
	var data any
	if raw != nil {
		data = json.RawMessage(raw)
	}
	return http.StatusOK, map[string]any{"first_day": data}, nil
}

func (h handler) officeHours(r *http.Request, user auth.User) (int, any, error) {
	code := r.PathValue("code")
	if !codePattern.MatchString(code) {
		return 0, nil, tools.ErrInvalid
	}
	host, slots, err := FreeSlots(r.Context(), h.db, user.Team.ID, code, h.now())
	if err != nil {
		return 0, nil, err
	}
	return http.StatusOK, map[string]any{"host": host, "items": slots}, nil
}

func (h handler) bookings(r *http.Request, user auth.User) (int, any, error) {
	items, err := MyBookings(r.Context(), h.db, user.ID, h.now())
	return http.StatusOK, map[string]any{"items": items}, err
}

// book - явное действие пользователя в UI (кнопка в диалоге брони).
func (h handler) book(r *http.Request, user auth.User) (int, any, error) {
	var input struct {
		SlotID string `json:"slot_id"`
		Topic  string `json:"topic"`
	}
	if err := decodeBody(r, &input); err != nil {
		return 0, nil, err
	}
	if !identifier.ValidUUID(input.SlotID) || utf8.RuneCountInString(input.Topic) > maxTopicRunes {
		return 0, nil, tools.ErrInvalid
	}
	booking, err := Book(r.Context(), h.db, user.Team.ID, input.SlotID, user.ID, strings.TrimSpace(input.Topic), nil, h.now())
	return http.StatusCreated, booking, err
}

func (h handler) courses(r *http.Request, user auth.User) (int, any, error) {
	items, err := Courses(r.Context(), h.db, user.ID)
	return http.StatusOK, map[string]any{"items": items}, err
}

func (h handler) completeCourse(r *http.Request, user auth.User) (int, any, error) {
	code := r.PathValue("code")
	if !codePattern.MatchString(code) {
		return 0, nil, tools.ErrInvalid
	}
	return http.StatusNoContent, nil, CompleteCourse(r.Context(), h.db, user.ID, code)
}

func (h handler) access(r *http.Request, user auth.User) (int, any, error) {
	items, err := AccessPackage(r.Context(), h.db, user.ID, user.Role, h.now())
	return http.StatusOK, map[string]any{"items": items}, err
}

func (h handler) requestAccess(r *http.Request, user auth.User) (int, any, error) {
	var input struct {
		System string `json:"system"`
	}
	if err := decodeBody(r, &input); err != nil {
		return 0, nil, err
	}
	if !codePattern.MatchString(input.System) {
		return 0, nil, tools.ErrInvalid
	}
	item, err := RequestAccess(r.Context(), h.db, user.ID, user.Role, input.System, nil, h.now())
	return http.StatusCreated, item, err
}

func (h handler) mapPlaces(r *http.Request, _ auth.User) (int, any, error) {
	places, err := Places(r.Context(), h.db)
	return http.StatusOK, map[string]any{"places": places}, err
}

func decodeBody(r *http.Request, target any) error {
	raw, err := io.ReadAll(io.LimitReader(r.Body, maxBodyBytes+1))
	if err != nil || len(raw) > maxBodyBytes {
		return tools.ErrInvalid
	}
	return tools.Decode(raw, target)
}

func writeFailure(ctx context.Context, w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, tools.ErrInvalid):
		writeError(w, http.StatusBadRequest, "INVALID_ARGUMENT", "Неверные параметры запроса.")
	case errors.Is(err, tools.ErrNotFound):
		writeError(w, http.StatusNotFound, "NOT_FOUND", "Не найдено или недоступно.")
	case errors.Is(err, tools.ErrBusinessConflict):
		writeError(w, http.StatusConflict, "CONFLICT", "Уже занято или уже запрошено.")
	case errors.Is(err, context.DeadlineExceeded):
		writeError(w, http.StatusGatewayTimeout, "TIMEOUT", "Сервис не ответил вовремя.")
	default:
		slog.ErrorContext(ctx, "corporate mock failed", "error", err)
		writeError(w, http.StatusInternalServerError, "INTERNAL_ERROR", "Внутренняя ошибка.")
	}
}

func writeError(w http.ResponseWriter, status int, code, message string) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(map[string]any{"error": map[string]string{"code": code, "message": message}})
}
