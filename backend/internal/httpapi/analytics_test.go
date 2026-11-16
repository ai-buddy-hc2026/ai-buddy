package httpapi

import (
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/ai-buddy-hc2026/ai-buddy/backend/internal/analytics"
	"github.com/ai-buddy-hc2026/ai-buddy/backend/internal/auth"
)

type analyticsStoreStub struct {
	actorID string
	err     error
}

func (s *analyticsStoreStub) Summary(_ context.Context, actorID string) (analytics.Summary, error) {
	s.actorID = actorID
	if s.err != nil {
		return analytics.Summary{}, s.err
	}
	return analytics.Summary{Scope: "team", Questions: 4, Escalations: 1}.Complete(), nil
}

func TestAnalyticsSummaryEndpoint(t *testing.T) {
	users := &authStore{u: auth.User{ID: "10000000-0000-0000-0000-000000000003", Login: "lead_maria", Role: "lead", Team: auth.Team{ID: "00000000-0000-0000-0000-000000000001"}}}
	service, err := auth.New(users, []byte("synthetic-test-key-with-at-least-32-bytes"), time.Hour)
	if err != nil {
		t.Fatal(err)
	}
	login, err := service.Login(context.Background(), users.u.Login)
	if err != nil {
		t.Fatal(err)
	}
	tests := []struct {
		name   string
		path   string
		token  string
		err    error
		status int
	}{
		{"ok", "/analytics/summary", login.AccessToken, nil, 200},
		{"no token", "/analytics/summary", "", nil, 401},
		{"query rejected", "/analytics/summary?x=1", login.AccessToken, nil, 400},
		{"intern denied", "/analytics/summary", login.AccessToken, analytics.ErrDenied, 403},
		{"store down", "/analytics/summary", login.AccessToken, errors.New("db down"), 503},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			store := &analyticsStoreStub{err: tt.err}
			handler := WithAnalytics(NewHandler(slog.Default(), service, nil), service, store)
			request := httptest.NewRequest(http.MethodGet, tt.path, nil)
			if tt.token != "" {
				request.Header.Set("Authorization", "Bearer "+tt.token)
			}
			w := httptest.NewRecorder()
			handler.ServeHTTP(w, request)
			if w.Code != tt.status {
				t.Fatalf("status %d: %s", w.Code, w.Body.String())
			}
			if tt.status != 200 {
				return
			}
			var body analytics.Summary
			if err := json.Unmarshal(w.Body.Bytes(), &body); err != nil || body.DeflectionRate != 75 || store.actorID != users.u.ID {
				t.Fatalf("body %s err %v", w.Body.String(), err)
			}
		})
	}
}
