package mcpserver

import (
	"context"
	"crypto/subtle"
	"encoding/json"
	"net/http"
	"time"

	"github.com/ai-buddy-hc2026/ai-buddy/backend/internal/identifier"
	"github.com/ai-buddy-hc2026/ai-buddy/backend/internal/tools"
)

type KnowledgeScopeStore interface {
	KnowledgeScope(context.Context, string) (tools.Context, error)
}

// KnowledgeScope возвращает разрешённую Go область для внутреннего RAG-поиска.
func KnowledgeScope(store KnowledgeScopeStore, token string) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Cache-Control", "no-store")
		if len(r.Header.Values("Authorization")) != 1 || token == "" || subtle.ConstantTimeCompare([]byte(r.Header.Get("Authorization")), []byte("Bearer "+token)) != 1 {
			writeError(w, 401, "UNAUTHORIZED")
			return
		}
		if r.Method != http.MethodPost || r.Header.Get("Origin") != "" || r.URL.RawQuery != "" || len(r.Header.Values("X-Request-ID")) != 1 || !identifier.ValidUUID(r.Header.Get("X-Request-ID")) {
			writeError(w, 400, "INVALID_REQUEST")
			return
		}
		ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
		defer cancel()
		scope, err := store.KnowledgeScope(ctx, r.Header.Get("X-Request-ID"))
		if err != nil {
			writeError(w, 403, "POLICY_DENIED")
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]string{"user_id": scope.ActorID, "team_id": scope.TeamID, "role": scope.Role})
	})
}
