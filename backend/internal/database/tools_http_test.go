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
		{`{"employee_id":"2db7cc77-4114-52d8-a833-f670ab60e4e0"}`, true},
	} {
		body := `{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"employees.get_manager","arguments":` + tc.args + `}}`
		r := httptest.NewRequest("POST", "http://localhost/mcp", strings.NewReader(body))
		r.Header.Set("Authorization", "Bearer "+token)
		r.Header.Set("X-Request-ID", requestID)
		r.Header.Set("MCP-Protocol-Version", "2025-06-18")
		r.Header.Set("Content-Type", "application/json")
		r.Header.Set("Accept", "application/json, text/event-stream")
		w := httptest.NewRecorder()
		handler.ServeHTTP(w, r)
		var response struct {
			Error *struct {
				Code int `json:"code"`
			} `json:"error"`
			Result struct {
				IsError           bool `json:"isError"`
				StructuredContent struct {
					Data struct {
						Manager struct {
							ID string `json:"id"`
						} `json:"manager"`
					} `json:"data"`
				} `json:"structuredContent"`
			} `json:"result"`
		}
		if err := json.Unmarshal(w.Body.Bytes(), &response); err != nil || w.Code != 200 {
			t.Fatalf("MCP response %d %s err=%v", w.Code, w.Body.String(), err)
		}
		if tc.denied && (response.Error == nil || response.Error.Code != -32602) {
			t.Fatal(w.Body.String())
		}
		if !tc.denied && response.Result.IsError {
			t.Fatal(w.Body.String())
		}
		if !tc.denied && response.Result.StructuredContent.Data.Manager.ID != "4a59a828-3b1a-55e4-bf9b-81db5ad6183a" {
			t.Fatal(w.Body.String())
		}
	}
	var count int
	if err := store.pool.QueryRow(context.Background(), "SELECT count(*) FROM events WHERE event_type='policy_denied'").Scan(&count); err != nil || count != 0 {
		t.Fatalf("policy events=%d err=%v", count, err)
	}
}
