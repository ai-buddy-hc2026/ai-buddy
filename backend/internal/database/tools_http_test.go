package database

import (
	"context"
	"encoding/json"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/ai-buddy-hc2026/ai-buddy/backend/internal/mcpserver"
)

func TestMCPWithPostgresContext(t *testing.T) {
	store, requestID := toolFixture(t)
	token := "synthetic-mcp-service-token-32-characters"
	handler, err := mcpserver.New(store, token)
	if err != nil {
		t.Fatal(err)
	}
	for _, tc := range []struct {
		args   string
		denied bool
	}{
		{`{}`, false},
		{`{"employee_id":"10000000-0000-0000-0000-000000000004"}`, true},
	} {
		body := `{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"employees.get_manager","arguments":` + tc.args + `}}`
		r := httptest.NewRequest("POST", "http://localhost/internal/mcp", strings.NewReader(body))
		r.Header.Set("Authorization", "Bearer "+token)
		r.Header.Set("X-Request-ID", requestID)
		r.Header.Set("MCP-Protocol-Version", "2025-11-25")
		r.Header.Set("Content-Type", "application/json")
		r.Header.Set("Accept", "application/json, text/event-stream")
		w := httptest.NewRecorder()
		handler.ServeHTTP(w, r)
		var response struct {
			Result struct {
				IsError           bool `json:"isError"`
				StructuredContent struct {
					ID string `json:"id"`
				} `json:"structuredContent"`
			} `json:"result"`
		}
		if err := json.Unmarshal(w.Body.Bytes(), &response); err != nil || w.Code != 200 {
			t.Fatalf("MCP response %d %s err=%v", w.Code, w.Body.String(), err)
		}
		if response.Result.IsError != tc.denied {
			t.Fatal(w.Body.String())
		}
		if !tc.denied && response.Result.StructuredContent.ID != "10000000-0000-0000-0000-000000000003" {
			t.Fatal(w.Body.String())
		}
	}
	var count int
	if err := store.pool.QueryRow(context.Background(), "SELECT count(*) FROM events WHERE event_type='policy_denied'").Scan(&count); err != nil || count != 1 {
		t.Fatalf("policy events=%d err=%v", count, err)
	}
}
