package database

import (
	"context"
	"encoding/json"
	"testing"
)

func TestActionTypeOnlyForOwner(t *testing.T) {
	s, id := toolFixture(t)
	ctx := context.Background()
	proposal, err := s.ProcessEvent(ctx, id, escalationEvent(id, 1, map[string]any{"question": "Вопрос"}))
	if err != nil {
		t.Fatal(err)
	}
	var body struct {
		ActionID string `json:"action_id"`
	}
	if err := json.Unmarshal(proposal.Data, &body); err != nil {
		t.Fatal(err)
	}
	if got, err := s.ActionType(ctx, chatAnya, body.ActionID); err != nil || got != "escalation.create" {
		t.Fatalf("owner: %q %v", got, err)
	}
	if got, err := s.ActionType(ctx, confirmTestBuddy, body.ActionID); err != nil || got != "" {
		t.Fatalf("other user: %q %v", got, err)
	}
}
