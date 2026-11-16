package companion

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/ai-buddy-hc2026/ai-buddy/backend/internal/auth"
)

type users struct{ u auth.User }

func (s users) FindByLogin(_ context.Context, login string) (auth.User, error) {
	if login != s.u.Login {
		return auth.User{}, auth.ErrUnauthorized
	}
	return s.u, nil
}

func (s users) FindByID(_ context.Context, id string) (auth.User, error) {
	if id != s.u.ID {
		return auth.User{}, auth.ErrUnauthorized
	}
	return s.u, nil
}

type backendStub struct {
	err      error
	saved    *Settings
	dayMode  *bool
	unread   bool
	days     int
	markedID string
}

func (b *backendStub) View(context.Context, auth.User) (View, error) {
	return View{Settings: Defaults(DefaultTimezone), BuddyEnabled: true}, b.err
}

func (b *backendStub) Save(_ context.Context, _ auth.User, s Settings) (View, error) {
	b.saved = &s
	return View{Settings: s}, b.err
}

func (b *backendStub) SetDayMode(_ context.Context, _ auth.User, enabled bool) (View, error) {
	b.dayMode = &enabled
	return View{}, b.err
}

func (b *backendStub) Notifications(_ context.Context, _ string, unread bool) (NotificationPage, error) {
	b.unread = unread
	return NotificationPage{Items: []Notification{}}, b.err
}

func (b *backendStub) MarkRead(_ context.Context, _ string, id string) (Notification, error) {
	b.markedID = id
	return Notification{ID: id}, b.err
}

func (b *backendStub) Pilot(context.Context, auth.User) (PilotReport, error) {
	return PilotReport{}, b.err
}

func (b *backendStub) Unanswered(_ context.Context, _ auth.User, days int) (UnansweredReport, error) {
	b.days = days
	return UnansweredReport{Days: days, Items: []CategoryCount{}}, b.err
}

func (b *backendStub) LinkTelegram(context.Context, auth.User) (TelegramLink, error) {
	return TelegramLink{Linked: true}, b.err
}

func (b *backendStub) UnlinkTelegram(context.Context, auth.User) (TelegramLink, error) {
	return TelegramLink{}, b.err
}

const settingsBody = `{"theme":"dark","lang":"ru","tone":"short","workHours":{"start":"09:00","end":"18:00","days":[1,2,3],"timezone":"Europe/Moscow"},"toggles":{"briefing":true,"hints":false,"birthdayReminders":true,"randomCoffee":false,"showInterests":false}}`

func TestRoutes(t *testing.T) {
	user := auth.User{ID: "10000000-0000-0000-0000-000000000001", Login: "intern_anya", Role: "intern", Team: auth.Team{ID: "00000000-0000-0000-0000-000000000001"}}
	service, err := auth.New(users{u: user}, []byte("synthetic-test-key-with-at-least-32-bytes"), time.Hour)
	if err != nil {
		t.Fatal(err)
	}
	login, err := service.Login(context.Background(), user.Login)
	if err != nil {
		t.Fatal(err)
	}
	const notificationID = "20000000-0000-0000-0000-000000000001"
	for _, tc := range []struct {
		name, method, target, body string
		noAuth                     bool
		backendErr                 error
		status                     int
		check                      func(*testing.T, *backendStub)
	}{
		{name: "settings no token", method: "GET", target: "/settings", noAuth: true, status: 401},
		{name: "settings get", method: "GET", target: "/settings", status: 200},
		{name: "settings patch", method: "PATCH", target: "/settings", body: settingsBody, status: 200, check: func(t *testing.T, b *backendStub) {
			if b.saved == nil || b.saved.Theme != "dark" || b.saved.Toggles.Hints {
				t.Fatalf("saved = %+v", b.saved)
			}
		}},
		{name: "settings unknown field", method: "PATCH", target: "/settings", body: `{"theme":"dark","x":1}`, status: 400},
		{name: "settings invalid", method: "PATCH", target: "/settings", body: strings.Replace(settingsBody, "09:00", "20:00", 1), status: 400},
		{name: "day mode on", method: "POST", target: "/day-mode", body: `{"enabled":true}`, status: 200, check: func(t *testing.T, b *backendStub) {
			if b.dayMode == nil || !*b.dayMode {
				t.Fatal("day mode not passed")
			}
		}},
		{name: "day mode missing", method: "POST", target: "/day-mode", body: `{}`, status: 400},
		{name: "day mode denied", method: "POST", target: "/day-mode", body: `{"enabled":true}`, backendErr: ErrDenied, status: 403},
		{name: "notifications unread", method: "GET", target: "/notifications?unread=true", status: 200, check: func(t *testing.T, b *backendStub) {
			if !b.unread {
				t.Fatal("unread filter lost")
			}
		}},
		{name: "notifications bad filter", method: "GET", target: "/notifications?unread=yes", status: 400},
		{name: "notifications unknown param", method: "GET", target: "/notifications?limit=5", status: 400},
		{name: "mark read", method: "POST", target: "/notifications/" + notificationID + "/read", status: 200, check: func(t *testing.T, b *backendStub) {
			if b.markedID != notificationID {
				t.Fatalf("marked = %q", b.markedID)
			}
		}},
		{name: "mark read bad id", method: "POST", target: "/notifications/nope/read", status: 400},
		{name: "mark read missing", method: "POST", target: "/notifications/" + notificationID + "/read", backendErr: ErrNotFound, status: 404},
		{name: "pilot denied", method: "GET", target: "/companion/pilot", backendErr: ErrDenied, status: 403},
		{name: "unanswered default", method: "GET", target: "/companion/unanswered", status: 200, check: func(t *testing.T, b *backendStub) {
			if b.days != defaultUnansweredDays {
				t.Fatalf("days = %d", b.days)
			}
		}},
		{name: "unanswered bad days", method: "GET", target: "/companion/unanswered?days=0", status: 400},
		{name: "telegram link", method: "POST", target: "/channels/telegram/link", status: 200},
		{name: "telegram unlink", method: "DELETE", target: "/channels/telegram", status: 200},
		{name: "storage down", method: "GET", target: "/settings", backendErr: errors.New("db down"), status: 503},
	} {
		t.Run(tc.name, func(t *testing.T) {
			backend := &backendStub{err: tc.backendErr}
			base := http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(http.StatusTeapot) })
			handler := WithRoutes(base, service, backend)
			req := httptest.NewRequest(tc.method, tc.target, strings.NewReader(tc.body))
			if tc.body != "" {
				req.Header.Set("Content-Type", "application/json")
			}
			if !tc.noAuth {
				req.Header.Set("Authorization", "Bearer "+login.AccessToken)
			}
			rec := httptest.NewRecorder()
			handler.ServeHTTP(rec, req)
			if rec.Code != tc.status {
				t.Fatalf("status = %d, want %d, body %s", rec.Code, tc.status, rec.Body.String())
			}
			if tc.check != nil {
				tc.check(t, backend)
			}
		})
	}
}

func TestRoutesFallThrough(t *testing.T) {
	base := http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(http.StatusTeapot) })
	rec := httptest.NewRecorder()
	WithRoutes(base, nil, &backendStub{}).ServeHTTP(rec, httptest.NewRequest("GET", "/health", nil))
	if rec.Code != http.StatusTeapot {
		t.Fatalf("status = %d", rec.Code)
	}
}
