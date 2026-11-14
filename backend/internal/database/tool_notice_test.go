package database

import (
	"context"
	"encoding/json"
	"errors"
	"testing"

	"github.com/ai-buddy-hc2026/ai-buddy/backend/internal/chat"
)

func TestToolNoticeAcceptsPythonKnowledgeAndScrubsArguments(t *testing.T) {
	store := &Tools{}
	for _, name := range []string{"knowledge.search", "checklist.get_plan", "employees.get_manager"} {
		t.Run(name, func(t *testing.T) {
			event := chat.NewEvent("20000000-0000-0000-0000-000000000001", 1, "tool_call", map[string]any{
				"tool_name": name,
				"arguments": map[string]string{"query": "private search text"},
			})
			got, err := store.ProcessEvent(context.Background(), event.RequestID, event)
			if err != nil {
				t.Fatal(err)
			}
			var notice struct {
				Name      string         `json:"tool_name"`
				Arguments map[string]any `json:"arguments"`
			}
			if json.Unmarshal(got.Data, &notice) != nil || notice.Name != name || notice.Arguments == nil || len(notice.Arguments) != 0 {
				t.Fatalf("unexpected public notice: %s", got.Data)
			}
			if got.RequestID != event.RequestID || got.Seq != event.Seq || got.Type != event.Type {
				t.Fatal("event identity changed")
			}
		})
	}
}

func TestToolNoticeRejectsUnknownNamesAndModelAliases(t *testing.T) {
	store := &Tools{}
	for _, name := range []string{"knowledge_search", "checklist_get_plan", "unknown.tool", ""} {
		event := chat.NewEvent("20000000-0000-0000-0000-000000000001", 1, "tool_call", map[string]any{
			"tool_name": name, "arguments": map[string]any{},
		})
		if _, err := store.ProcessEvent(context.Background(), event.RequestID, event); !errors.Is(err, chat.ErrInvalid) {
			t.Fatalf("unexpected error for %q: %v", name, err)
		}
	}
}
