package httpapi

import (
	"context"
	"errors"
	"io"
	"log/slog"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/ai-buddy-hc2026/ai-buddy/backend/internal/auth"
	"github.com/ai-buddy-hc2026/ai-buddy/backend/internal/onboarding"
)

type testPlans struct {
	err               error
	calls             int
	actorID, internID string
}

func (s *testPlans) GetPlan(ctx context.Context, actorID, internID string) (onboarding.Plan, error) {
	s.calls++
	s.actorID, s.internID = actorID, internID
	if _, ok := ctx.Deadline(); !ok {
		return onboarding.Plan{}, errors.New("deadline missing")
	}
	return onboarding.Plan{}, s.err
}
func (s *testPlans) UpdateStatus(ctx context.Context, actorID, taskID string, change onboarding.StatusChange) (onboarding.Task, error) {
	s.calls++
	s.actorID = actorID
	if _, ok := ctx.Deadline(); !ok {
		return onboarding.Task{}, errors.New("deadline missing")
	}
	return onboarding.Task{ID: taskID, Status: change.Status, Version: change.Version + 1, Materials: []onboarding.Material{}}, s.err
}

func TestOnboardingValidationAndErrors(t *testing.T) {
	user := auth.User{ID: "10000000-0000-0000-0000-000000000001", Login: "intern_anya", Role: "intern", Team: auth.Team{ID: "00000000-0000-0000-0000-000000000001"}}
	service, err := auth.New(&authStore{u: user}, []byte("synthetic-test-key-with-at-least-32-bytes"), time.Hour)
	if err != nil {
		t.Fatal(err)
	}
	login, err := service.Login(context.Background(), user.Login)
	if err != nil {
		t.Fatal(err)
	}
	store := &testPlans{}
	handler := NewHandler(slog.New(slog.NewJSONHandler(io.Discard, nil)), service, store)
	request := func(method, path, body, media string) *httptest.ResponseRecorder {
		r := httptest.NewRequest(method, path, strings.NewReader(body))
		r.Header.Set("Authorization", "Bearer "+login.AccessToken)
		r.Header.Set("Content-Type", media)
		w := httptest.NewRecorder()
		handler.ServeHTTP(w, r)
		return w
	}
	path := "/tasks/40000000-0000-0000-0000-000000000001"
	for _, tc := range []struct{ method, path, body, media string }{
		{"GET", "/onboarding/plan?intern_id=%zz", "", ""},
		{"GET", "/onboarding/plan?intern_id=bad", "", ""},
		{"GET", "/onboarding/plan?extra=1", "", ""},
		{"PATCH", path, `{"status":"done","version":1}`, "text/plain"},
		{"PATCH", path, `{"status":"done","version":1.2}`, "application/json"},
		{"PATCH", path, `{"status":"done","version":1,"role":"lead"}`, "application/json"},
		{"PATCH", path, strings.Repeat(" ", 4097), "application/json"},
		{"PATCH", path + "?role=lead", `{"status":"done","version":1}`, "application/json"},
	} {
		store.calls = 0
		w := request(tc.method, tc.path, tc.body, tc.media)
		if w.Code != 400 || store.calls != 0 {
			t.Fatalf("invalid request reached store: %d calls=%d", w.Code, store.calls)
		}
	}
	for _, tc := range []struct {
		err    error
		status int
		code   string
	}{
		{nil, 200, ""}, {auth.ErrUnauthorized, 401, "UNAUTHORIZED"},
		{onboarding.ErrInvalidArgument, 400, "INVALID_REQUEST"}, {onboarding.ErrNotFound, 404, "NOT_FOUND"},
		{onboarding.ErrForbidden, 403, "POLICY_DENIED"}, {onboarding.ErrVersionConflict, 409, "VERSION_CONFLICT"},
		{onboarding.ErrPlanInactive, 409, "PLAN_NOT_ACTIVE"}, {errors.New("private-database-details"), 503, "SERVICE_UNAVAILABLE"},
	} {
		store.err = tc.err
		for _, method := range []string{"GET", "PATCH"} {
			endpoint := "/onboarding/plan?intern_id=" + user.ID
			if method == "PATCH" {
				endpoint = path
			}
			w := request(method, endpoint, `{"status":"done","version":1}`, "application/json")
			if w.Code != tc.status || !strings.Contains(w.Body.String(), tc.code) || strings.Contains(w.Body.String(), "private-database-details") {
				t.Fatalf("error mapping: %d %s", w.Code, w.Body.String())
			}
			if w.Header().Get("Cache-Control") != "no-store" || store.actorID != user.ID {
				t.Fatal("actor/cache mismatch")
			}
		}
	}
}
