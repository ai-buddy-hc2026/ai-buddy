package httpapi

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/ai-buddy-hc2026/ai-buddy/backend/internal/auth"
	"github.com/ai-buddy-hc2026/ai-buddy/backend/internal/escalation"
)

type answerStoreStub struct {
	actorID, escalationID string
	request               escalation.AnswerRequest
	err                   error
}

func (s *answerStoreStub) List(_ context.Context, _ string, _ escalation.ListQuery) (escalation.Page, error) {
	return escalation.Page{Items: []escalation.Record{}}, s.err
}

func (s *answerStoreStub) Answer(_ context.Context, actorID, escalationID string, request escalation.AnswerRequest) (escalation.Answer, error) {
	s.actorID, s.escalationID, s.request = actorID, escalationID, request
	if s.err != nil {
		return escalation.Answer{}, s.err
	}
	return escalation.Answer{ID: escalationID, Status: "answered", AnswerText: request.AnswerText, AnsweredBy: actorID, AnsweredAt: time.Date(2026, 11, 12, 0, 0, 0, 0, time.UTC), AddToKB: request.AddToKB, KBStatus: "ready", Version: "2026-11-12T00:00:00Z"}, nil
}

func TestAnswerEscalationEndpoint(t *testing.T) {
	store := &answerStoreStub{}
	users := &authStore{u: auth.User{ID: "10000000-0000-0000-0000-000000000002", Login: "buddy_ilya", Role: "buddy", Team: auth.Team{ID: "00000000-0000-0000-0000-000000000001"}}}
	service, err := auth.New(users, []byte("synthetic-test-key-with-at-least-32-bytes"), time.Hour)
	if err != nil {
		t.Fatal(err)
	}
	login, err := service.Login(context.Background(), users.u.Login)
	if err != nil {
		t.Fatal(err)
	}
	handler := WithEscalations(NewHandler(slog.Default(), service, nil), service, store)
	path := "/buddy/escalations/20000000-0000-0000-0000-000000000001/answer"
	listRequest := httptest.NewRequest(http.MethodGet, "/buddy/escalations?status=open&limit=10", nil)
	listRequest.Header.Set("Authorization", "Bearer "+login.AccessToken)
	listResponse := httptest.NewRecorder()
	handler.ServeHTTP(listResponse, listRequest)
	if listResponse.Code != http.StatusOK {
		t.Fatalf("list status=%d body=%s", listResponse.Code, listResponse.Body.String())
	}
	badList := httptest.NewRequest(http.MethodGet, "/buddy/escalations?status=bogus", nil)
	badList.Header.Set("Authorization", "Bearer "+login.AccessToken)
	badListResponse := httptest.NewRecorder()
	handler.ServeHTTP(badListResponse, badList)
	if badListResponse.Code != http.StatusBadRequest {
		t.Fatalf("bad list status=%d body=%s", badListResponse.Code, badListResponse.Body.String())
	}
	for _, tc := range []struct {
		name, body string
		status     int
	}{
		{"ok", `{"answer_text":"Проверь инструкцию.","add_to_kb":true,"version":"2026-11-12T00:00:00Z"}`, 200},
		{"missing_flag", `{"answer_text":"Ответ","version":"v1"}`, 400},
		{"unknown_field", `{"answer_text":"Ответ","add_to_kb":false,"version":"v1","publish_to_kb":false}`, 400},
		{"empty_answer", `{"answer_text":" ","add_to_kb":false,"version":"v1"}`, 400},
		{"bad_json", `{`, 400},
	} {
		t.Run(tc.name, func(t *testing.T) {
			req := httptest.NewRequest(http.MethodPost, path, strings.NewReader(tc.body))
			req.Header.Set("Content-Type", "application/json")
			req.Header.Set("Authorization", "Bearer "+login.AccessToken)
			response := httptest.NewRecorder()
			handler.ServeHTTP(response, req)
			if response.Code != tc.status {
				t.Fatalf("status=%d want=%d body=%s", response.Code, tc.status, response.Body.String())
			}
		})
	}
	if store.actorID != users.u.ID || store.escalationID != "20000000-0000-0000-0000-000000000001" || store.request.AnswerText != "Проверь инструкцию." || !store.request.AddToKB {
		t.Fatalf("request was not passed to store: %+v", store)
	}
	store.err = escalation.ErrDenied
	req := httptest.NewRequest(http.MethodPost, path, strings.NewReader(`{"answer_text":"Ответ","add_to_kb":false,"version":"v1"}`))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+login.AccessToken)
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, req)
	if response.Code != http.StatusForbidden {
		t.Fatalf("denied status=%d body=%s", response.Code, response.Body.String())
	}
	store.err = errors.New("database unavailable")
	req = httptest.NewRequest(http.MethodPost, path, strings.NewReader(`{"answer_text":"Ответ","add_to_kb":false,"version":"v1"}`))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+login.AccessToken)
	response = httptest.NewRecorder()
	handler.ServeHTTP(response, req)
	if response.Code != http.StatusServiceUnavailable {
		t.Fatalf("failure status=%d body=%s", response.Code, response.Body.String())
	}
}
