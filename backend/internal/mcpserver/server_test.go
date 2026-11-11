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

func (s *fakeStore) Context(_ context.Context, id string) (tools.Context, error) {
	s.bound = id
	if id != testRequest {
		return tools.Context{}, tools.ErrUnknownRequest
	}
	return tools.Context{Role: "intern"}, nil
}
func (s *fakeStore) Call(_ context.Context, id string, operation policy.Operation, _ json.RawMessage) (any, error) {
	s.called = id
	if s.failure != nil {
		return nil, s.failure
	}
	switch operation {
	case policy.GetPlan:
		return map[string]any{"employee_id": "10000000-0000-0000-0000-000000000001", "team_id": "00000000-0000-0000-0000-000000000001", "stage": "week_1", "progress": map[string]int{"done": 0, "total": 0}, "tasks": []any{}, "next_step": nil}, nil
	case policy.GetManager:
		return map[string]any{"manager": nil}, nil
	case policy.GetAbsencePolicy:
		return tools.PolicyData{NoticePeriodDays: 3, RequiresApproval: true, AllowedTypes: []tools.AbsenceType{{Code: "day_off", Label: "Отгул"}}}, nil
	case policy.UpdateStatus, policy.CreateAbsence:
		return nil, tools.ErrConfirmation
	default:
		return nil, tools.ErrDenied
	}
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
	want := map[string]bool{"checklist.get_plan": true, "checklist.update_status": true, "employees.get_manager": true, "absences.get_policy": true, "absences.create_request": true}
	for _, tool := range list.Tools {
		if !want[tool.Name] {
			t.Fatal("unexpected tool", tool.Name)
		}
		delete(want, tool.Name)
		args := map[string]any{}
		isWrite := tool.Name == "checklist.update_status" || tool.Name == "absences.create_request"
		if tool.Name == "checklist.update_status" {
			args = map[string]any{"task_id": "40000000-0000-0000-0000-000000000001", "status": "done", "version": 1}
		}
		if tool.Name == "absences.create_request" {
			args = map[string]any{"date": "2026-12-20", "type": "day_off"}
		}

		result, err := session.CallTool(ctx, &mcp.CallToolParams{Name: tool.Name, Arguments: args})
		if err != nil || result.IsError != isWrite || store.called != testRequest {
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
	if strings.Contains(string(encoded), "SQL secret") || !strings.Contains(string(encoded), "INTERNAL_ERROR") {
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
		{testToken, "90000000-0000-0000-0000-000000000001", "", 404},
		{testToken, testRequest, "https://example.com", 403},
	} {
		r := httptest.NewRequest("POST", "/mcp", strings.NewReader(`{}`))
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

func TestRPCErrorProfile(t *testing.T) {
	handler, err := New(&fakeStore{}, testToken)
	if err != nil {
		t.Fatal(err)
	}
	for _, tc := range []struct {
		body         string
		status, code int
		name         string
	}{
		{`{`, 400, -32700, "PARSE_ERROR"},
		{`{"jsonrpc":"1.0","id":1,"method":"tools/list"}`, 400, -32600, "INVALID_REQUEST"},
		{`{"jsonrpc":"2.0","id":1,"method":"unknown"}`, 200, -32601, "METHOD_NOT_FOUND"},
		{`{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{"cursor":null}}`, 200, -32602, "INVALID_ARGUMENT"},
		{`{"jsonrpc":"2.0","id":1,"method":"tools/call","params":null}`, 200, -32602, "INVALID_ARGUMENT"},
		{`{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"unknown","arguments":{}}}`, 200, -32602, "UNKNOWN_TOOL"},
		{`{"jsonrpc":"2.0","method":"tools/call","params":null}`, 202, 0, ""},
	} {
		r := httptest.NewRequest("POST", "/mcp", strings.NewReader(tc.body))
		r.Header.Set("Authorization", "Bearer "+testToken)
		r.Header.Set("X-Request-ID", testRequest)
		r.Header.Set("MCP-Protocol-Version", ProtocolVersion)
		r.Header.Set("Content-Type", "application/json")
		r.Header.Set("Accept", "application/json, text/event-stream")
		w := httptest.NewRecorder()
		handler.ServeHTTP(w, r)
		if w.Code != tc.status {
			t.Fatalf("%s: %d %s", tc.body, w.Code, w.Body.String())
		}
		if tc.code == 0 {
			if w.Body.Len() != 0 {
				t.Fatal("notification received response")
			}
			continue
		}
		var response struct {
			Error struct {
				Code int `json:"code"`
				Data struct {
					Code string `json:"code"`
				} `json:"data"`
			} `json:"error"`
		}
		if json.Unmarshal(w.Body.Bytes(), &response) != nil || response.Error.Code != tc.code || response.Error.Data.Code != tc.name {
			t.Fatal(w.Body.String())
		}
	}
}
