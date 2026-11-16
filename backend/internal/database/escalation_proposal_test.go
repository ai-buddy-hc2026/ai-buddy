package database

import (
	"context"
	"encoding/json"
	"errors"
	"testing"

	"github.com/ai-buddy-hc2026/ai-buddy/backend/internal/chat"
	"github.com/ai-buddy-hc2026/ai-buddy/backend/internal/tools"
)

func escalationEvent(id string, seq int, details map[string]any) chat.Event {
	return chat.NewEvent(id, seq, "action_proposal", map[string]any{"action_type": "escalation.create", "details": details})
}

// S-5: предложение из Python хранит наставника и контекст из Go, а подтверждение создает эскалацию.
func TestEscalationProposalConfirmCreatesEscalation(t *testing.T) {
	s, id := toolFixture(t)
	ctx := context.Background()
	event := escalationEvent(id, 1, map[string]any{"question": "  Как получить доступ к тестовому стенду?  "})
	proposal, err := s.ProcessEvent(ctx, id, event)
	if err != nil {
		t.Fatal(err)
	}
	again, err := s.ProcessEvent(ctx, id, event)
	if err != nil || string(again.Data) != string(proposal.Data) {
		t.Fatalf("proposal retry: %v", err)
	}
	var body struct {
		ActionID string         `json:"action_id"`
		Details  map[string]any `json:"details"`
	}
	if err := json.Unmarshal(proposal.Data, &body); err != nil {
		t.Fatal(err)
	}
	if body.Details["buddy_id"] != confirmTestBuddy || body.Details["question"] != "Как получить доступ к тестовому стенду?" {
		t.Fatalf("unexpected details: %v", body.Details)
	}
	var raw json.RawMessage
	if err := s.pool.QueryRow(ctx, "SELECT parameters FROM actions_log WHERE id=$1", body.ActionID).Scan(&raw); err != nil {
		t.Fatal(err)
	}
	var params tools.EscalationParameters
	if err := json.Unmarshal(raw, &params); err != nil || len(params.ContextSnapshot) != 1 || params.ContextSnapshot[0].Role != "user" {
		t.Fatalf("snapshot: %s %v", raw, err)
	}
	finishChat(t, NewChat(s.pool), id, "В базе знаний ответа нет")
	action, err := s.Confirm(ctx, chatAnya, body.ActionID)
	if err != nil || action.Status != "succeeded" {
		t.Fatalf("confirm: %+v %v", action, err)
	}
	var status, buddy string
	if err := s.pool.QueryRow(ctx, "SELECT status,buddy_id::text FROM escalations WHERE action_id=$1", body.ActionID).Scan(&status, &buddy); err != nil || status != "open" || buddy != confirmTestBuddy {
		t.Fatalf("escalation: %s %s %v", status, buddy, err)
	}
}

func TestEscalationProposalRejectsModelControlledFields(t *testing.T) {
	s, id := toolFixture(t)
	for _, details := range []map[string]any{
		{"question": ""},
		{"question": "Вопрос", "buddy_id": confirmTestBuddy},
		{"question": string(make([]rune, maxEscalationQuestion+1))},
	} {
		if _, err := s.ProcessEvent(context.Background(), id, escalationEvent(id, 1, details)); !errors.Is(err, chat.ErrInvalid) {
			t.Fatalf("details %v: %v", details, err)
		}
	}
}

func TestEscalationProposalDeniedForBuddy(t *testing.T) {
	s, _ := toolFixture(t)
	id := toolRequest(t, s, confirmTestBuddy)
	_, err := s.ProcessEvent(context.Background(), id, escalationEvent(id, 1, map[string]any{"question": "Вопрос"}))
	if !errors.Is(err, tools.ErrDenied) {
		t.Fatal(err)
	}
}

func TestSameProposalComparesEscalationQuestion(t *testing.T) {
	saved := json.RawMessage(`{"buddy_id":"` + confirmTestBuddy + `","question":"Вопрос","context_snapshot":[]}`)
	if !sameProposal("escalation.create", saved, json.RawMessage(`{"question":" Вопрос "}`)) {
		t.Fatal("same question rejected")
	}
	if sameProposal("escalation.create", saved, json.RawMessage(`{"question":"Другой"}`)) {
		t.Fatal("different question accepted")
	}
	if !sameProposal("absences.create_request", json.RawMessage(`{"date":"2026-12-01","type":"day_off","approver":"x"}`), json.RawMessage(`{"date":"2026-12-01","type":"day_off"}`)) {
		t.Fatal("absence replay rejected")
	}
}
