package mcpserver

import (
	"context"
	"errors"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/ai-buddy-hc2026/ai-buddy/backend/internal/tools"
)

type scopeStore struct {
	err   error
	calls int
}

func (s *scopeStore) KnowledgeScope(context.Context, string) (tools.Context, error) {
	s.calls++
	return tools.Context{ActorID: "actor", TeamID: "team", Role: "intern"}, s.err
}

func TestKnowledgeScopeRequiresServiceAndCurrentAuthorization(t *testing.T) {
	store := &scopeStore{}
	token := strings.Repeat("x", 32)
	handler := KnowledgeScope(store, token)
	for _, authorized := range []bool{false, true} {
		req := httptest.NewRequest("POST", "/mcp/knowledge-scope", nil)
		req.Header.Set("X-Request-ID", "20000000-0000-0000-0000-000000000001")
		if authorized {
			req.Header.Set("Authorization", "Bearer "+token)
		}
		w := httptest.NewRecorder()
		handler.ServeHTTP(w, req)
		if !authorized && (w.Code != 401 || store.calls != 0) {
			t.Fatal("unauthorized service reached scope store")
		}
		if authorized && (w.Code != 200 || !strings.Contains(w.Body.String(), `"team_id":"team"`)) {
			t.Fatal(w.Code, w.Body.String())
		}
	}
	store.err = errors.New("private database details")
	request := httptest.NewRequest("POST", "/mcp/knowledge-scope", nil)
	request.Header.Set("Authorization", "Bearer "+token)
	request.Header.Set("X-Request-ID", "20000000-0000-0000-0000-000000000001")
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, request)
	if w.Code != 403 || strings.Contains(w.Body.String(), "private") {
		t.Fatal("scope failure leaked data", w.Code, w.Body.String())
	}
}
