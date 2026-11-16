package companion

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"mime"
	"net/http"
	"net/url"
	"strconv"
	"time"

	"github.com/ai-buddy-hc2026/ai-buddy/backend/internal/auth"
	"github.com/ai-buddy-hc2026/ai-buddy/backend/internal/httpapi"
	"github.com/ai-buddy-hc2026/ai-buddy/backend/internal/identifier"
)

const (
	requestTimeout        = 5 * time.Second
	maxBodyBytes          = 16 << 10
	defaultUnansweredDays = 30
	maxUnansweredDays     = 365
)

// Backend - операции, которые нужны HTTP-слою. Реализуется Store.
type Backend interface {
	View(context.Context, auth.User) (View, error)
	Save(context.Context, auth.User, Settings) (View, error)
	SetDayMode(context.Context, auth.User, bool) (View, error)
	Notifications(context.Context, string, bool) (NotificationPage, error)
	MarkRead(context.Context, string, string) (Notification, error)
	Pilot(context.Context, auth.User) (PilotReport, error)
	Unanswered(context.Context, auth.User, int) (UnansweredReport, error)
	LinkTelegram(context.Context, auth.User) (TelegramLink, error)
	UnlinkTelegram(context.Context, auth.User) (TelegramLink, error)
}

type userHandler func(http.ResponseWriter, *http.Request, auth.User)

// WithRoutes добавляет эндпоинты компаньона поверх base.
func WithRoutes(base http.Handler, authService *auth.Service, backend Backend) http.Handler {
	mux := http.NewServeMux()
	bind := func(pattern string, handle userHandler) {
		mux.Handle(pattern, httpapi.RequireAuth(authService, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			user, ok := httpapi.CurrentUser(r.Context())
			if !ok {
				writeError(w, http.StatusUnauthorized, "UNAUTHORIZED", "Требуется действительный токен.")
				return
			}
			ctx, cancel := context.WithTimeout(r.Context(), requestTimeout)
			defer cancel()
			handle(w, r.WithContext(ctx), user)
		})))
	}
	h := handlers{backend: backend}
	bind("GET /settings", h.getSettings)
	bind("PATCH /settings", h.putSettings)
	bind("POST /day-mode", h.dayMode)
	bind("GET /notifications", h.notifications)
	bind("POST /notifications/{id}/read", h.markRead)
	bind("GET /companion/pilot", h.pilot)
	bind("GET /companion/unanswered", h.unanswered)
	bind("POST /channels/telegram/link", h.linkTelegram)
	bind("DELETE /channels/telegram", h.unlinkTelegram)
	mux.Handle("/", base)
	return mux
}

type handlers struct {
	backend Backend
}

func (h handlers) getSettings(w http.ResponseWriter, r *http.Request, u auth.User) {
	view, err := h.backend.View(r.Context(), u)
	respond(w, view, err)
}

func (h handlers) putSettings(w http.ResponseWriter, r *http.Request, u auth.User) {
	var settings Settings
	if !decodeJSON(w, r, &settings) {
		return
	}
	if err := settings.Validate(); err != nil {
		writeError(w, http.StatusBadRequest, "INVALID_SETTINGS", "Проверь тему, язык, тон и рабочие часы.")
		return
	}
	view, err := h.backend.Save(r.Context(), u, settings)
	respond(w, view, err)
}

func (h handlers) dayMode(w http.ResponseWriter, r *http.Request, u auth.User) {
	var body struct {
		Enabled *bool `json:"enabled"`
	}
	if !decodeJSON(w, r, &body) {
		return
	}
	if body.Enabled == nil {
		writeError(w, http.StatusBadRequest, "INVALID_REQUEST", "Укажи enabled.")
		return
	}
	view, err := h.backend.SetDayMode(r.Context(), u, *body.Enabled)
	respond(w, view, err)
}

func (h handlers) notifications(w http.ResponseWriter, r *http.Request, u auth.User) {
	values, err := url.ParseQuery(r.URL.RawQuery)
	unread := values.Get("unread")
	if err != nil || len(values) > 1 || (len(values) == 1 && unread == "") || (unread != "" && unread != "true" && unread != "false") {
		writeError(w, http.StatusBadRequest, "INVALID_REQUEST", "Допустим только фильтр unread=true|false.")
		return
	}
	page, err := h.backend.Notifications(r.Context(), u.ID, unread == "true")
	respond(w, page, err)
}

func (h handlers) markRead(w http.ResponseWriter, r *http.Request, u auth.User) {
	id := r.PathValue("id")
	if !identifier.ValidUUID(id) {
		writeError(w, http.StatusBadRequest, "INVALID_REQUEST", "Ожидается UUID уведомления.")
		return
	}
	item, err := h.backend.MarkRead(r.Context(), u.ID, id)
	respond(w, item, err)
}

func (h handlers) pilot(w http.ResponseWriter, r *http.Request, u auth.User) {
	report, err := h.backend.Pilot(r.Context(), u)
	respond(w, report, err)
}

func (h handlers) unanswered(w http.ResponseWriter, r *http.Request, u auth.User) {
	days := defaultUnansweredDays
	if raw := r.URL.Query().Get("days"); raw != "" {
		parsed, err := strconv.Atoi(raw)
		if err != nil || parsed < 1 || parsed > maxUnansweredDays {
			writeError(w, http.StatusBadRequest, "INVALID_REQUEST", "days должен быть от 1 до 365.")
			return
		}
		days = parsed
	}
	report, err := h.backend.Unanswered(r.Context(), u, days)
	respond(w, report, err)
}

func (h handlers) linkTelegram(w http.ResponseWriter, r *http.Request, u auth.User) {
	link, err := h.backend.LinkTelegram(r.Context(), u)
	respond(w, link, err)
}

func (h handlers) unlinkTelegram(w http.ResponseWriter, r *http.Request, u auth.User) {
	link, err := h.backend.UnlinkTelegram(r.Context(), u)
	respond(w, link, err)
}

func decodeJSON(w http.ResponseWriter, r *http.Request, target any) bool {
	media, _, err := mime.ParseMediaType(r.Header.Get("Content-Type"))
	if err != nil || media != "application/json" {
		writeError(w, http.StatusBadRequest, "INVALID_REQUEST", "Ожидается JSON.")
		return false
	}
	r.Body = http.MaxBytesReader(w, r.Body, maxBodyBytes)
	decoder := json.NewDecoder(r.Body)
	decoder.DisallowUnknownFields()
	if decoder.Decode(target) != nil || decoder.Decode(&struct{}{}) != io.EOF {
		writeError(w, http.StatusBadRequest, "INVALID_REQUEST", "Проверь поля запроса.")
		return false
	}
	return true
}

func respond(w http.ResponseWriter, value any, err error) {
	switch {
	case err == nil:
		writeJSON(w, http.StatusOK, value)
	case errors.Is(err, auth.ErrUnauthorized):
		writeError(w, http.StatusUnauthorized, "UNAUTHORIZED", "Требуется действительный токен.")
	case errors.Is(err, ErrInvalid):
		writeError(w, http.StatusBadRequest, "INVALID_REQUEST", "Некорректный запрос.")
	case errors.Is(err, ErrDenied):
		writeError(w, http.StatusForbidden, "POLICY_DENIED", "Недостаточно прав.")
	case errors.Is(err, ErrNotFound):
		writeError(w, http.StatusNotFound, "NOT_FOUND", "Запись не найдена.")
	default:
		writeError(w, http.StatusServiceUnavailable, "SERVICE_UNAVAILABLE", "Сервис временно недоступен.")
	}
}

func writeJSON(w http.ResponseWriter, status int, value any) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(value)
}

func writeError(w http.ResponseWriter, status int, code, message string) {
	writeJSON(w, status, map[string]any{"error": map[string]string{"code": code, "message": message}})
}
