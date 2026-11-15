package httpapi

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/ai-buddy-hc2026/ai-buddy/backend/internal/auth"
	"github.com/ai-buddy-hc2026/ai-buddy/backend/internal/notifications"
)

type notificationStub struct {
	calls int
	actor string
	err   error
}

func (s *notificationStub) Settings(_ context.Context, actor string) (notifications.Settings, error) {
	s.calls++
	s.actor = actor
	return notifications.Settings{}, s.err
}
func (s *notificationStub) UpdateSettings(ctx context.Context, actor string, _ notifications.SettingsInput) (notifications.Settings, error) {
	return s.Settings(ctx, actor)
}
func (s *notificationStub) List(_ context.Context, actor string, _ notifications.Query) (notifications.Page, error) {
	s.calls++
	s.actor = actor
	return notifications.Page{Items: []notifications.Notification{}}, s.err
}
func (s *notificationStub) Read(_ context.Context, actor, _ string) (notifications.Notification, error) {
	s.calls++
	s.actor = actor
	return notifications.Notification{}, s.err
}
func (s *notificationStub) Resource(_ context.Context, actor, _ string) (notifications.Resource, error) {
	s.calls++
	s.actor = actor
	return notifications.Resource{}, s.err
}

func TestNotificationsHTTPAccessAndValidation(t *testing.T) {
	user := auth.User{ID: "a24a3478-cf42-51b1-b05b-9833260247a5", Login: "intern_anya", Role: "intern", Team: auth.Team{ID: "4496e76d-35da-5cf7-a3d5-c9a89d88c5a2"}}
	service, err := auth.New(&authStore{u: user}, []byte("synthetic-test-key-with-at-least-32-bytes"), time.Hour)
	if err != nil {
		t.Fatal(err)
	}
	token, err := service.Login(context.Background(), user.Login)
	if err != nil {
		t.Fatal(err)
	}
	store := &notificationStub{}
	handler := WithNotifications(http.NotFoundHandler(), service, store)
	valid := `{"version":1,"preferences":{"meeting_reminders":true},"work_days":[1,2,3,4,5],"work_start":"10:00","work_end":"19:00"}`
	id := "30000000-0000-4000-8000-000000000001"
	for _, tc := range []struct {
		method, path, body string
		status             int
	}{
		{"GET", "/notifications?recipient_id=other", "", 400},
		{"GET", "/notifications?limit=0", "", 400},
		{"GET", "/notifications?limit=20&limit=20", "", 400},
		{"PATCH", "/me/settings", strings.Replace(valid, `"version":1`, `"version":1,"mode":"off_day"`, 1), 400},
		{"PATCH", "/me/settings", strings.Replace(valid, `"version":1`, `"version":1,"user_id":"other"`, 1), 400},
		{"PATCH", "/me/settings", strings.Replace(valid, `"meeting_reminders":true`, `"meeting_reminders":true,"mode":"normal"`, 1), 400},
		{"PATCH", "/me/settings", valid + `{}`, 400},
		{"PATCH", "/me/settings", strings.Replace(valid, `[1,2,3,4,5]`, `[1,1]`, 1), 400},
		{"PATCH", "/notifications/" + id + "/read", `{}`, 400},
		{"GET", "/notifications/bad/resource", "", 400},
		{"GET", "/me/settings?user_id=other", "", 400},
		{"GET", "/notifications", "", 200},
		{"GET", "/me/settings", "", 200},
		{"PATCH", "/me/settings", valid, 200},
		{"PATCH", "/notifications/" + id + "/read", "", 200},
		{"GET", "/notifications/" + id + "/resource", "", 200},
	} {
		before := store.calls
		r := httptest.NewRequest(tc.method, tc.path, strings.NewReader(tc.body))
		r.Header.Set("Authorization", "Bearer "+token.AccessToken)
		r.Header.Set("Content-Type", "application/json")
		w := httptest.NewRecorder()
		handler.ServeHTTP(w, r)
		if w.Code != tc.status {
			t.Fatalf("%s %s: %d %s", tc.method, tc.path, w.Code, w.Body.String())
		}
		if tc.status == 400 && store.calls != before {
			t.Fatal("invalid request reached store")
		}
		if tc.status == 200 && (store.actor != user.ID || w.Header().Get("Cache-Control") != "no-store") {
			t.Fatal("identity or caching boundary lost")
		}
	}
	for _, tc := range []struct {
		err    error
		status int
	}{{notifications.ErrConflict, 409}, {notifications.ErrDenied, 403}, {notifications.ErrNotFound, 404}, {context.DeadlineExceeded, 503}} {
		store.err = tc.err
		r := httptest.NewRequest("GET", "/me/settings", nil)
		r.Header.Set("Authorization", "Bearer "+token.AccessToken)
		w := httptest.NewRecorder()
		handler.ServeHTTP(w, r)
		if w.Code != tc.status {
			t.Fatal(w.Code)
		}
	}
	before := store.calls
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, httptest.NewRequest("GET", "/notifications", nil))
	if w.Code != 401 || store.calls != before {
		t.Fatal("anonymous request reached store")
	}
}
