package httpapi

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/ai-buddy-hc2026/ai-buddy/backend/internal/auth"
	"github.com/ai-buddy-hc2026/ai-buddy/backend/internal/features"
)

const featureActionID = "50000000-0000-0000-0000-000000000001"

type actionTypeStub struct {
	actionType string
	err        error
}

func (s actionTypeStub) ActionType(_ context.Context, _, _ string) (string, error) {
	return s.actionType, s.err
}

func featureFixture(t *testing.T, disabled string, store ActionTypeStore) (http.Handler, string, *bool) {
	t.Helper()
	users := &authStore{u: auth.User{ID: "a24a3478-cf42-51b1-b05b-9833260247a5", Login: "intern_anya", Role: "intern", Team: auth.Team{ID: "00000000-0000-0000-0000-000000000001"}}}
	service, err := auth.New(users, []byte("synthetic-test-key-with-at-least-32-bytes"), time.Hour)
	if err != nil {
		t.Fatal(err)
	}
	login, err := service.Login(context.Background(), users.u.Login)
	if err != nil {
		t.Fatal(err)
	}
	flags, err := features.Parse(disabled)
	if err != nil {
		t.Fatal(err)
	}
	reached := new(bool)
	base := http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		*reached = true
		w.WriteHeader(http.StatusTeapot)
	})
	return WithFeatures(base, service, flags, store), login.AccessToken, reached
}

func featureRequest(handler http.Handler, method, path, token, body string) *httptest.ResponseRecorder {
	request := httptest.NewRequest(method, path, strings.NewReader(body))
	if token != "" {
		request.Header.Set("Authorization", "Bearer "+token)
	}
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, request)
	return w
}

func TestFeaturesEndpointReportsFlags(t *testing.T) {
	handler, token, _ := featureFixture(t, "absences", nil)
	if w := featureRequest(handler, "GET", "/features", "", ""); w.Code != 401 {
		t.Fatal(w.Code)
	}
	w := featureRequest(handler, "GET", "/features", token, "")
	var body map[string]bool
	if w.Code != 200 || json.Unmarshal(w.Body.Bytes(), &body) != nil || body["absences"] || !body["chat"] || len(body) != len(features.Keys) {
		t.Fatalf("%d %s", w.Code, w.Body.String())
	}
}

func TestFeaturesGateScenarios(t *testing.T) {
	confirm := "/actions/" + featureActionID + "/confirm"
	answer := "/buddy/escalations/" + featureActionID + "/answer"
	tests := []struct {
		name     string
		disabled string
		store    ActionTypeStore
		method   string
		path     string
		body     string
		status   int
	}{
		{"chat off", "chat", nil, "POST", "/chat/messages", `{}`, 503},
		{"chat on", "", nil, "POST", "/chat/messages", `{}`, http.StatusTeapot},
		{"absence confirm off", "absences", actionTypeStub{actionType: "absences.create_request"}, "POST", confirm, "", 409},
		{"task confirm stays", "absences,escalations", actionTypeStub{actionType: "checklist.update_status"}, "POST", confirm, "", http.StatusTeapot},
		{"escalation confirm off", "escalations", actionTypeStub{actionType: "escalation.create"}, "POST", confirm, "", 409},
		{"lookup failure", "absences", actionTypeStub{err: errors.New("db down")}, "POST", confirm, "", 503},
		{"kb publish off", "kb_publish", nil, "POST", answer, `{"answer_text":"x","add_to_kb":true,"version":"v"}`, 409},
		{"answer without kb", "kb_publish,escalations", nil, "POST", answer, `{"answer_text":"x","add_to_kb":false,"version":"v"}`, http.StatusTeapot},
		{"other route", "chat,absences,escalations,kb_publish", nil, "GET", "/onboarding/plan", "", http.StatusTeapot},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			handler, token, reached := featureFixture(t, tt.disabled, tt.store)
			w := featureRequest(handler, tt.method, tt.path, token, tt.body)
			if w.Code != tt.status {
				t.Fatalf("status %d: %s", w.Code, w.Body.String())
			}
			if (tt.status == http.StatusTeapot) != *reached {
				t.Fatalf("base reached=%v", *reached)
			}
			disabledByFlag := tt.status == 409 || tt.name == "chat off"
			if disabledByFlag && !strings.Contains(w.Body.String(), "FEATURE_DISABLED") {
				t.Fatal(w.Body.String())
			}
		})
	}
}
