package mcpserver

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/ai-buddy-hc2026/ai-buddy/backend/internal/policy"
	"github.com/ai-buddy-hc2026/ai-buddy/backend/internal/tools"
	"github.com/modelcontextprotocol/go-sdk/mcp"
)

const testToken = "synthetic-mcp-service-token-32-characters"
const testRequest = "20000000-0000-0000-0000-000000000001"

type fakeStore struct {
	bound, called string
	failure       error
}

func (s *fakeStore) Bind(_ context.Context, id string) error {
	s.bound = id
	if id != testRequest {
		return tools.ErrContext
	}
	return nil
}
func (s *fakeStore) Call(_ context.Context, id string, operation policy.Operation, _ json.RawMessage) (any, error) {
	s.called = id
	return map[string]any{"operation": string(operation)}, s.failure
}

type headersTransport struct{ base http.RoundTripper }

func (h headersTransport) RoundTrip(r *http.Request) (*http.Response, error) {
	r = r.Clone(r.Context())
	r.Header.Set("Authorization", "Bearer "+testToken)
	r.Header.Set("X-Request-ID", testRequest)
	return h.base.RoundTrip(r)
}

func TestMCPListAndCall(t *testing.T) {
	store := &fakeStore{}
	handler, err := New(store, testToken)
	if err != nil {
		t.Fatal(err)
	}
	server := httptest.NewServer(handler)
	defer server.Close()
	client := mcp.NewClient(&mcp.Implementation{Name: "test", Version: "1"}, nil)
	ctx := context.Background()
	session, err := client.Connect(ctx, &mcp.StreamableClientTransport{Endpoint: server.URL, HTTPClient: &http.Client{Transport: headersTransport{base: http.DefaultTransport}}}, nil)
	if err != nil {
		t.Fatal(err)
	}
	defer func() {
		if err := session.Close(); err != nil {
			t.Error(err)
		}
	}()
	list, err := session.ListTools(ctx, &mcp.ListToolsParams{})
	if err != nil {
		t.Fatal(err)
	}
	want := map[string]bool{"checklist.get_plan": true, "checklist.update_status": true, "employees.get_manager": true, "absences.get_policy": true, "absences.create_request": true, "absences.list_for_employee": true, "escalation.create": true}
	for _, tool := range list.Tools {
		if !want[tool.Name] {
			t.Fatal("unexpected tool", tool.Name)
		}
		delete(want, tool.Name)
		args := map[string]any{}
		if tool.Name == "checklist.update_status" || tool.Name == "absences.create_request" || tool.Name == "escalation.create" {
			args["action_id"] = "50000000-0000-0000-0000-000000000001"
		}
		result, err := session.CallTool(ctx, &mcp.CallToolParams{Name: tool.Name, Arguments: args})
		if err != nil || result.IsError || store.called != testRequest {
			t.Fatalf("call %s: %v %+v bound=%s", tool.Name, err, result, store.called)
		}
	}
	if len(want) != 0 || store.bound != testRequest {
		t.Fatalf("missing tools %v", want)
	}
	store.failure = errors.New("synthetic SQL secret")
	result, err := session.CallTool(ctx, &mcp.CallToolParams{Name: "employees.get_manager", Arguments: map[string]any{}})
	if err != nil || !result.IsError {
		t.Fatalf("tool error: %v %+v", err, result)
	}
	encoded, _ := json.Marshal(result)
	if strings.Contains(string(encoded), "SQL secret") || !strings.Contains(string(encoded), "TOOL_UNAVAILABLE") {
		t.Fatalf("unsafe error %s", encoded)
	}
}

func TestMCPAuthentication(t *testing.T) {
	store := &fakeStore{}
	handler, err := New(store, testToken)
	if err != nil {
		t.Fatal(err)
	}
	for _, tc := range []struct {
		token, id, origin string
		status            int
	}{
		{"", testRequest, "", 401},
		{"wrong", testRequest, "", 401},
		{testToken, "", "", 400},
		{testToken, "other", "", 403},
		{testToken, testRequest, "https://example.com", 403},
	} {
		r := httptest.NewRequest("POST", "/internal/mcp", strings.NewReader(`{}`))
		if tc.token != "" {
			r.Header.Set("Authorization", "Bearer "+tc.token)
		}
		if tc.id != "" {
			r.Header.Set("X-Request-ID", tc.id)
		}
		if tc.origin != "" {
			r.Header.Set("Origin", tc.origin)
		}
		w := httptest.NewRecorder()
		handler.ServeHTTP(w, r)
		if w.Code != tc.status {
			t.Fatalf("status=%d want=%d", w.Code, tc.status)
		}
	}
}
