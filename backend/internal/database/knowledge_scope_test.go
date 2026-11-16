package database

import (
	"context"
	"testing"
)

func TestKnowledgeScopeRechecksActor(t *testing.T) {
	for _, mutation := range []string{
		"UPDATE users SET role='buddy' WHERE login='intern_anya'",
		"UPDATE users SET active=false WHERE login='intern_anya'",
	} {
		t.Run(mutation, func(t *testing.T) {
			store, requestID := toolFixture(t)
			ctx := context.Background()
			scope, err := store.KnowledgeScope(ctx, requestID)
			if err != nil || scope.ActorID != chatAnya || scope.Role != "intern" {
				t.Fatal(scope, err)
			}
			if _, err := store.pool.Exec(ctx, mutation); err != nil {
				t.Fatal(err)
			}
			if _, err := store.KnowledgeScope(ctx, requestID); err == nil {
				t.Fatal("changed actor retained KB access")
			}
		})
	}
}
