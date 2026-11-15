package httpapi

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/ai-buddy-hc2026/ai-buddy/backend/internal/auth"
	"github.com/ai-buddy-hc2026/ai-buddy/backend/internal/calendar"
)

type calendarStub struct {
	calls int
	actor string
}

func (s *calendarStub) Slots(_ context.Context, actor, _ string, _ calendar.Window) ([]calendar.Slot, error) {
	s.actor = actor
	return []calendar.Slot{}, nil
}
func (s *calendarStub) Bookings(_ context.Context, actor string, _ calendar.Window) ([]calendar.Booking, error) {
	s.actor = actor
	return []calendar.Booking{}, nil
}
func (s *calendarStub) Book(_ context.Context, actor, _ string, _ calendar.Input) (calendar.Booking, error) {
	s.actor = actor
	s.calls++
	return calendar.Booking{Status: "confirmed"}, nil
}

func TestCalendarHTTPConfirmation(t *testing.T) {
	user := auth.User{ID: "a24a3478-cf42-51b1-b05b-9833260247a5", Login: "intern_anya", Role: "intern", Team: auth.Team{ID: "4496e76d-35da-5cf7-a3d5-c9a89d88c5a2"}}
	service, err := auth.New(&authStore{u: user}, []byte("synthetic-test-key-with-at-least-32-bytes"), time.Hour)
	if err != nil {
		t.Fatal(err)
	}
	token, err := service.Login(context.Background(), user.Login)
	if err != nil {
		t.Fatal(err)
	}
	store := &calendarStub{}
	handler := WithCalendar(http.NotFoundHandler(), service, store)
	valid := `{"slot_id":"30000000-0000-4000-8000-000000000001","topic":"1:1","confirmed":true}`
	for _, tc := range []struct {
		body, key string
		status    int
	}{
		{valid, "", 400}, {strings.Replace(valid, `true`, `false`, 1), "40000000-0000-4000-8000-000000000001", 400},
		{strings.Replace(valid, `"topic"`, `"attendee_id":"other","topic"`, 1), "40000000-0000-4000-8000-000000000001", 400},
		{valid + `{}`, "40000000-0000-4000-8000-000000000001", 400}, {valid, "40000000-0000-4000-8000-000000000001", 200},
	} {
		r := httptest.NewRequest("POST", "/calendar/bookings", strings.NewReader(tc.body))
		r.Header.Set("Content-Type", "application/json")
		r.Header.Set("Authorization", "Bearer "+token.AccessToken)
		if tc.key != "" {
			r.Header.Set("Idempotency-Key", tc.key)
		}
		w := httptest.NewRecorder()
		handler.ServeHTTP(w, r)
		if w.Code != tc.status {
			t.Fatalf("status=%d body=%s", w.Code, w.Body.String())
		}
	}
	if store.calls != 1 || store.actor != user.ID {
		t.Fatalf("unconfirmed mutation calls=%d actor=%s", store.calls, store.actor)
	}
	r := httptest.NewRequest("GET", "/calendar/bookings", nil)
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, r)
	if w.Code != 401 {
		t.Fatal(w.Code)
	}
}

func TestCalendarWindowValidation(t *testing.T) {
	now := time.Date(2030, 1, 1, 0, 0, 0, 0, time.UTC)
	if w, err := calendarWindow("", now); err != nil || w.To.Sub(w.From) != 14*24*time.Hour {
		t.Fatal(w, err)
	}
	for _, raw := range []string{"team_id=other", "from=bad", "from=2030-01-01T00:00:00Z", "from=2030-01-01T00:00:00Z&to=2031-01-01T00:00:00Z", "from=2030-01-01T00:00:00Z&to=2030-01-01T00:00:00Z", "from=x&from=y"} {
		if _, err := calendarWindow(raw, now); err == nil {
			t.Fatal("invalid calendar window accepted")
		}
	}
}
