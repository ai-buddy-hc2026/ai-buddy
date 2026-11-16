package httpapi

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/ai-buddy-hc2026/ai-buddy/backend/internal/auth"
)

const aiTestServiceToken = "synthetic-ai-service-token"

type questionsStub struct {
	user  auth.User
	days  int
	items []AIQuestion
	err   error
}

func (s *questionsStub) UnansweredQuestions(_ context.Context, u auth.User, days int) ([]AIQuestion, error) {
	s.user, s.days = u, days
	return s.items, s.err
}

type upstreamRecord struct {
	calls int
	auth  string
	path  string
	body  map[string]any
}

func newUpstream(t *testing.T, status int, response string) (*httptest.Server, *upstreamRecord) {
	t.Helper()
	record := &upstreamRecord{}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		record.calls++
		record.auth = r.Header.Get("Authorization")
		record.path = r.URL.Path
		raw, _ := io.ReadAll(r.Body)
		_ = json.Unmarshal(raw, &record.body)
		w.WriteHeader(status)
		_, _ = w.Write([]byte(response))
	}))
	t.Cleanup(server.Close)
	return server, record
}

func aiTestLogin(t *testing.T, role string) (*auth.Service, string, auth.User) {
	t.Helper()
	user := auth.User{ID: "10000000-0000-0000-0000-000000000002", Login: "user_" + role, Role: role, Team: auth.Team{ID: "00000000-0000-0000-0000-000000000001"}}
	service, err := auth.New(&authStore{u: user}, []byte("synthetic-test-key-with-at-least-32-bytes"), time.Hour)
	if err != nil {
		t.Fatal(err)
	}
	login, err := service.Login(context.Background(), user.Login)
	if err != nil {
		t.Fatal(err)
	}
	return service, login.AccessToken, user
}

func doAIRequest(handler http.Handler, path, token, body string) *httptest.ResponseRecorder {
	request := httptest.NewRequest(http.MethodPost, path, strings.NewReader(body))
	if token != "" {
		request.Header.Set("Authorization", "Bearer "+token)
	}
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, request)
	return w
}

func errorCode(t *testing.T, w *httptest.ResponseRecorder) string {
	t.Helper()
	var body struct {
		Error struct {
			Code string `json:"code"`
		} `json:"error"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &body); err != nil {
		t.Fatalf("error envelope: %s", w.Body.String())
	}
	return body.Error.Code
}

func TestMeetingSummaryProxy(t *testing.T) {
	service, token, _ := aiTestLogin(t, "intern")
	okResponse := `{"agreements":["Релиз в пятницу"],"action_items":[{"title":"Написать тесты","owner":"Стажёр","due":null}]}`
	tests := []struct {
		name     string
		token    string
		body     string
		status   int
		upstream int
		code     string
		calls    int
	}{
		{"ok", token, `{"text":"Обсудили релиз"}`, 200, 200, "", 1},
		{"no token", "", `{"text":"x"}`, 401, 200, "UNAUTHORIZED", 0},
		{"empty text", token, `{"text":"   "}`, 400, 200, "INVALID_REQUEST", 0},
		{"unknown field", token, `{"text":"x","user_id":"1"}`, 400, 200, "INVALID_REQUEST", 0},
		{"too long text", token, `{"text":"` + strings.Repeat("я", meetingTextLimit+1) + `"}`, 400, 200, "INVALID_REQUEST", 0},
		{"body limit", token, `{"text":"` + strings.Repeat("a", aiProxyBodyLimit) + `"}`, 413, 200, "INVALID_REQUEST", 0},
		{"upstream bad gateway", token, `{"text":"x"}`, 503, 502, "SERVICE_UNAVAILABLE", 1},
		{"upstream garbage", token, `{"text":"x"}`, 503, 200, "SERVICE_UNAVAILABLE", 1},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			response := okResponse
			if tt.name == "upstream garbage" {
				response = "not json"
			}
			upstream, record := newUpstream(t, tt.upstream, response)
			client := &AIClient{URL: upstream.URL, Token: aiTestServiceToken}
			handler := WithAIProxy(NewHandler(slog.Default(), service, nil), service, client, &questionsStub{})
			w := doAIRequest(handler, "/meetings/summary", tt.token, tt.body)
			if w.Code != tt.status {
				t.Fatalf("status %d: %s", w.Code, w.Body.String())
			}
			if record.calls != tt.calls {
				t.Fatalf("upstream calls %d", record.calls)
			}
			if tt.code != "" {
				if got := errorCode(t, w); got != tt.code {
					t.Fatalf("code %s", got)
				}
				return
			}
			if record.auth != "Bearer "+aiTestServiceToken || strings.Contains(record.auth, token) || record.path != "/meetings/summary" {
				t.Fatalf("upstream auth %q path %q", record.auth, record.path)
			}
			var body meetingSummary
			if err := json.Unmarshal(w.Body.Bytes(), &body); err != nil || len(body.Agreements) != 1 || len(body.ActionItems) != 1 {
				t.Fatalf("body %s", w.Body.String())
			}
		})
	}
}

func TestMeetingSummaryWithoutAIService(t *testing.T) {
	service, token, _ := aiTestLogin(t, "intern")
	handler := WithAIProxy(NewHandler(slog.Default(), service, nil), service, NewAIClient(false, "", ""), &questionsStub{})
	w := doAIRequest(handler, "/meetings/summary", token, `{"text":"x"}`)
	if w.Code != 503 || errorCode(t, w) != "SERVICE_UNAVAILABLE" {
		t.Fatalf("status %d: %s", w.Code, w.Body.String())
	}
}

func TestQuestionClustersProxy(t *testing.T) {
	questions := []AIQuestion{{ID: "q1", Text: "Как получить доступ к VPN?"}, {ID: "q2", Text: "Где взять VPN?"}}
	okResponse := `{"clusters":[{"label":"VPN","size":2,"questions":[{"id":"q1","text":"Как получить доступ к VPN?"},{"id":"q2","text":"Где взять VPN?"}]}]}`
	tests := []struct {
		name   string
		role   string
		token  bool
		body   string
		items  []AIQuestion
		err    error
		status int
		code   string
		calls  int
		days   int
	}{
		{"buddy ok", "buddy", true, "", questions, nil, 200, "", 1, clustersDefaultDays},
		{"lead with days", "lead", true, `{"days":7}`, questions, nil, 200, "", 1, 7},
		{"no token", "buddy", false, "", questions, nil, 401, "UNAUTHORIZED", 0, 0},
		{"intern denied", "intern", true, "", questions, nil, 403, "POLICY_DENIED", 0, 0},
		{"store denied", "buddy", true, "", nil, ErrQuestionsDenied, 403, "POLICY_DENIED", 0, clustersDefaultDays},
		{"store down", "buddy", true, "", nil, errors.New("db down"), 503, "SERVICE_UNAVAILABLE", 0, clustersDefaultDays},
		{"days out of range", "buddy", true, `{"days":365}`, questions, nil, 400, "INVALID_REQUEST", 0, 0},
		{"questions in body rejected", "buddy", true, `{"questions":[{"text":"x"}]}`, questions, nil, 400, "INVALID_REQUEST", 0, 0},
		{"body limit", "buddy", true, `{"days":` + strings.Repeat(" ", aiProxyBodyLimit) + `1}`, questions, nil, 413, "INVALID_REQUEST", 0, 0},
		{"nothing to cluster", "buddy", true, "", []AIQuestion{}, nil, 200, "", 0, clustersDefaultDays},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			service, token, user := aiTestLogin(t, tt.role)
			if !tt.token {
				token = ""
			}
			upstream, record := newUpstream(t, 200, okResponse)
			store := &questionsStub{items: tt.items, err: tt.err}
			handler := WithAIProxy(NewHandler(slog.Default(), service, nil), service, &AIClient{URL: upstream.URL, Token: aiTestServiceToken}, store)
			w := doAIRequest(handler, "/questions/clusters", token, tt.body)
			if w.Code != tt.status {
				t.Fatalf("status %d: %s", w.Code, w.Body.String())
			}
			if record.calls != tt.calls || store.days != tt.days {
				t.Fatalf("upstream calls %d days %d", record.calls, store.days)
			}
			if tt.code != "" {
				if got := errorCode(t, w); got != tt.code {
					t.Fatalf("code %s", got)
				}
				return
			}
			if store.user.ID != user.ID || store.user.Team.ID != user.Team.ID {
				t.Fatalf("questions must be scoped to caller team, got %+v", store.user)
			}
			var body clusterResponse
			if err := json.Unmarshal(w.Body.Bytes(), &body); err != nil || body.Clusters == nil {
				t.Fatalf("body %s", w.Body.String())
			}
			if tt.calls == 0 {
				return
			}
			sent, _ := record.body["questions"].([]any)
			if record.auth != "Bearer "+aiTestServiceToken || len(sent) != 2 || len(body.Clusters) != 1 || body.Clusters[0].Size != 2 {
				t.Fatalf("upstream auth %q sent %v body %s", record.auth, record.body, w.Body.String())
			}
		})
	}
}

func TestNewAIClient(t *testing.T) {
	if NewAIClient(true, "", "t") != nil || NewAIClient(false, "http://ai", "t") != nil {
		t.Fatal("client must be nil when ai-service is not configured")
	}
	if c := NewAIClient(true, "http://ai", "t"); c == nil || c.URL != "http://ai" {
		t.Fatal("client expected")
	}
}
