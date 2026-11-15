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
	"github.com/ai-buddy-hc2026/ai-buddy/backend/internal/calendar"
	"github.com/ai-buddy-hc2026/ai-buddy/backend/internal/identifier"
)

type CalendarStore interface {
	Slots(context.Context, string, string, calendar.Window) ([]calendar.Slot, error)
	Bookings(context.Context, string, calendar.Window) ([]calendar.Booking, error)
	Book(context.Context, string, string, calendar.Input) (calendar.Booking, error)
}

func calendarWindow(raw string, now time.Time) (calendar.Window, error) {
	w := calendar.Window{From: now.UTC(), To: now.UTC().AddDate(0, 0, 14)}
	values, err := url.ParseQuery(raw)
	if err != nil {
		return w, calendar.ErrInvalid
	}
	for key, items := range values {
		if len(items) != 1 || items[0] == "" {
			return w, calendar.ErrInvalid
		}
		value, err := time.Parse(time.RFC3339, items[0])
		if err != nil {
			return w, calendar.ErrInvalid
		}
		switch key {
		case "from":
			w.From = value.UTC()
		case "to":
			w.To = value.UTC()
		default:
			return w, calendar.ErrInvalid
		}
	}
	if (values.Has("from") != values.Has("to")) || !w.Valid() {
		return w, calendar.ErrInvalid
	}
	return w, nil
}

func WithCalendar(base http.Handler, service *auth.Service, store CalendarStore) http.Handler {
	mux := http.NewServeMux()
	read := func(slots bool) http.Handler {
		return RequireAuth(service, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			user, _ := CurrentUser(r.Context())
			window, err := calendarWindow(r.URL.RawQuery, time.Now())
			if err != nil {
				writeCalendarError(w, err)
				return
			}
			ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
			defer cancel()
			var result any
			if slots {
				if !identifier.ValidUUID(r.PathValue("employee_id")) {
					writeCalendarError(w, calendar.ErrInvalid)
					return
				}
				result, err = store.Slots(ctx, user.ID, r.PathValue("employee_id"), window)
			} else {
				result, err = store.Bookings(ctx, user.ID, window)
			}
			if err != nil {
				writeCalendarError(w, err)
				return
			}
			w.Header().Set("Cache-Control", "no-store")
			writeOnboardingJSON(w, map[string]any{"items": result})
		}))
	}
	mux.Handle("GET /calendar/{employee_id}/office-hours", read(true))
	mux.Handle("GET /calendar/bookings", read(false))
	mux.Handle("POST /calendar/bookings", RequireAuth(service, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		user, _ := CurrentUser(r.Context())
		var input calendar.Input
		media, _, err := mime.ParseMediaType(r.Header.Get("Content-Type"))
		key := r.Header.Get("Idempotency-Key")
		if err != nil || media != "application/json" || r.URL.RawQuery != "" || len(r.Header.Values("Idempotency-Key")) != 1 {
			writeCalendarError(w, calendar.ErrInvalid)
			return
		}
		decoder := json.NewDecoder(http.MaxBytesReader(w, r.Body, 8192))
		decoder.DisallowUnknownFields()
		if decoder.Decode(&input) != nil || decoder.Decode(new(any)) != io.EOF || !input.Valid(key) {
			writeCalendarError(w, calendar.ErrInvalid)
			return
		}
		ctx, cancel := context.WithTimeout(r.Context(), 10*time.Second)
		defer cancel()
		result, err := store.Book(ctx, user.ID, key, input)
		if err != nil {
			writeCalendarError(w, err)
			return
		}
		w.Header().Set("Cache-Control", "no-store")
		writeOnboardingJSON(w, result)
	})))
	mux.Handle("/", base)
	return mux
}

func writeCalendarError(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, calendar.ErrInvalid):
		writeAuthError(w, 400, "INVALID_REQUEST", "Проверь параметры календаря, подтверждение и ключ повтора.")
	case errors.Is(err, auth.ErrUnauthorized):
		writeAuthError(w, 401, "UNAUTHORIZED", "Требуется действительный токен.")
	case errors.Is(err, calendar.ErrDenied):
		writeAuthError(w, 403, "POLICY_DENIED", "Действие календаря недоступно.")
	case errors.Is(err, calendar.ErrNotFound):
		writeAuthError(w, 404, "NOT_FOUND", "Приёмные часы или слот недоступны.")
	case errors.Is(err, calendar.ErrConflict):
		writeAuthError(w, 409, "SLOT_UNAVAILABLE", "Слот уже занят, истёк или пересекается с другой встречей. Обнови доступность.")
	case errors.Is(err, calendar.ErrIdempotency):
		writeAuthError(w, 409, "IDEMPOTENCY_CONFLICT", "Этот ключ уже использован для другой брони.")
	default:
		writeAuthError(w, 503, "SERVICE_UNAVAILABLE", "Календарь временно недоступен. Повтори запрос с тем же ключом.")
	}
}
