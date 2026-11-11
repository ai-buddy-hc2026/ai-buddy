package database

import (
	"context"
	"encoding/json"
	"errors"
	"sync"
	"testing"

	"github.com/ai-buddy-hc2026/ai-buddy/backend/internal/policy"
	"github.com/ai-buddy-hc2026/ai-buddy/backend/internal/tools"
)

func escalationParams(t *testing.T, s *Tools, requestID string) tools.EscalationParameters {
	t.Helper()
	message := tools.ContextMessage{Sources: []json.RawMessage{}}
	if err := s.pool.QueryRow(context.Background(), `SELECT id::text,role,content FROM chat_messages WHERE request_id=$1 AND role='user'`, requestID).Scan(&message.MessageID, &message.Role, &message.Content); err != nil {
		t.Fatal(err)
	}
	return tools.EscalationParameters{BuddyID: "10000000-0000-0000-0000-000000000002", Question: "Нужна помощь с задачей", ContextSnapshot: []tools.ContextMessage{message}}
}

func TestEscalationConcurrentReplay(t *testing.T) {
	s, requestID := toolFixture(t)
	ctx := context.Background()
	params := escalationParams(t, s, requestID)
	actionID := toolActionFixture(t, s, requestID, policy.CreateEscalation, params, true)
	finishChat(t, NewChat(s.pool), requestID, "Вопрос готов к передаче")
	var wg sync.WaitGroup
	results := make(chan string, 8)
	for range 8 {
		wg.Go(func() {
			result, err := callAction(s, requestID, policy.CreateEscalation, actionID)
			if err != nil {
				t.Error(err)
				return
			}
			raw, err := canonicalToolResult(result)
			if err != nil {
				t.Error(err)
				return
			}
			results <- raw
		})
	}
	wg.Wait()
	close(results)
	want := ""
	for result := range results {
		if want == "" {
			want = result
		}
		if result != want {
			t.Fatal("different replay result")
		}
	}
	if want == "" {
		t.Fatal("no successful result")
	}
	var rows, events, attempts int
	if err := s.pool.QueryRow(ctx, `SELECT (SELECT count(*) FROM escalations),(SELECT count(*) FROM events WHERE event_type='escalation_created'),attempt_count FROM actions_log WHERE id=$1`, actionID).Scan(&rows, &events, &attempts); err != nil || rows != 1 || events != 1 || attempts != 1 {
		t.Fatalf("rows=%d events=%d attempts=%d err=%v", rows, events, attempts, err)
	}
	var snapshot []byte
	if err := s.pool.QueryRow(ctx, `SELECT context_snapshot FROM escalations WHERE action_id=$1`, actionID).Scan(&snapshot); err != nil {
		t.Fatal(err)
	}
	var messages []tools.ContextMessage
	if err := json.Unmarshal(snapshot, &messages); err != nil || len(messages) != 1 || messages[0].MessageID != params.ContextSnapshot[0].MessageID {
		t.Fatalf("wrong snapshot: %s %v", snapshot, err)
	}
	restarted, err := NewTools(s.pool, 0)
	if err != nil {
		t.Fatal(err)
	}
	result, err := callAction(restarted, requestID, policy.CreateEscalation, actionID)
	if err != nil {
		t.Fatal(err)
	}
	raw, _ := canonicalToolResult(result)
	if raw != want {
		t.Fatal("restart lost result")
	}
}

func TestEscalationConfirmationAndScope(t *testing.T) {
	s, requestID := toolFixture(t)
	ctx := context.Background()
	params := escalationParams(t, s, requestID)
	unconfirmed := toolActionFixture(t, s, requestID, policy.CreateEscalation, params, false)
	if _, err := callAction(s, requestID, policy.CreateEscalation, unconfirmed); !errors.Is(err, tools.ErrConfirmation) {
		t.Fatal(err)
	}
	foreignRequest := toolRequest(t, s, "10000000-0000-0000-0000-000000000004")
	foreign := escalationParams(t, s, foreignRequest)
	for _, tc := range []struct {
		name   string
		change func(*tools.EscalationParameters)
		want   error
	}{
		{"tampered content", func(p *tools.EscalationParameters) {
			p.ContextSnapshot[0].Content = "Подмененный текст"
		}, tools.ErrDenied},
		{"foreign message", func(p *tools.EscalationParameters) { p.ContextSnapshot = foreign.ContextSnapshot }, tools.ErrDenied},
		{"foreign buddy", func(p *tools.EscalationParameters) { p.BuddyID = "10000000-0000-0000-0000-000000000005" }, tools.ErrDenied},
		{"too many messages", func(p *tools.EscalationParameters) { p.ContextSnapshot = make([]tools.ContextMessage, 11) }, tools.ErrInvalid},
		{"duplicate message", func(p *tools.EscalationParameters) {
			p.ContextSnapshot = append(p.ContextSnapshot, p.ContextSnapshot[0])
		}, tools.ErrInvalid},
		{"unverified source", func(p *tools.EscalationParameters) {
			p.ContextSnapshot[0].Sources = []json.RawMessage{json.RawMessage(`{"document_id":"40000000-0000-0000-0000-000000000001"}`)}
		}, tools.ErrDenied},
	} {
		t.Run(tc.name, func(t *testing.T) {
			p := escalationParams(t, s, requestID)
			tc.change(&p)
			id := toolActionFixture(t, s, requestID, policy.CreateEscalation, p, true)
			if _, err := callAction(s, requestID, policy.CreateEscalation, id); !errors.Is(err, tc.want) {
				t.Fatalf("err=%v want=%v", err, tc.want)
			}
		})
	}
	// Свое сообщение из более поздней генерации не входит в выбранный контекст.
	finishChat(t, NewChat(s.pool), requestID, "Синтетический ответ")
	laterRequest := toolRequest(t, s, chatAnya)
	later := escalationParams(t, s, laterRequest)
	laterID := toolActionFixture(t, s, requestID, policy.CreateEscalation, later, true)
	if _, err := callAction(s, requestID, policy.CreateEscalation, laterID); !errors.Is(err, tools.ErrDenied) {
		t.Fatal("later context accepted", err)
	}
	actionID := toolActionFixture(t, s, requestID, policy.CreateEscalation, params, true)
	if _, err := callAction(s, foreignRequest, policy.CreateEscalation, actionID); !errors.Is(err, tools.ErrNotFound) {
		t.Fatal("foreign action allowed", err)
	}
	if _, err := s.pool.Exec(ctx, `UPDATE users SET buddy_id=NULL WHERE id=$1`, chatAnya); err != nil {
		t.Fatal(err)
	}
	if _, err := callAction(s, requestID, policy.CreateEscalation, actionID); !errors.Is(err, tools.ErrDenied) {
		t.Fatal("outdated assignment allowed", err)
	}
	leadRequest := toolRequest(t, s, "10000000-0000-0000-0000-000000000003")
	leadID := toolActionFixture(t, s, leadRequest, policy.CreateEscalation, params, true)
	if _, err := callAction(s, leadRequest, policy.CreateEscalation, leadID); !errors.Is(err, tools.ErrDenied) {
		t.Fatal("lead escalation allowed", err)
	}
	var count int
	if err := s.pool.QueryRow(ctx, "SELECT count(*) FROM escalations").Scan(&count); err != nil || count != 0 {
		t.Fatalf("denied escalation saved: %d %v", count, err)
	}
}

func TestEscalationAtomicRollback(t *testing.T) {
	s, requestID := toolFixture(t)
	ctx := context.Background()
	actionID := toolActionFixture(t, s, requestID, policy.CreateEscalation, escalationParams(t, s, requestID), true)
	if _, err := s.pool.Exec(ctx, `ALTER TABLE actions_log ADD CONSTRAINT reject_escalation_success CHECK (status<>'succeeded') NOT VALID`); err != nil {
		t.Fatal(err)
	}
	if _, err := callAction(s, requestID, policy.CreateEscalation, actionID); err == nil {
		t.Fatal("result failure ignored")
	}
	var rows, events int
	if err := s.pool.QueryRow(ctx, `SELECT (SELECT count(*) FROM escalations),(SELECT count(*) FROM events WHERE event_type='escalation_created')`).Scan(&rows, &events); err != nil || rows != 0 || events != 0 {
		t.Fatalf("partial result: %d %d %v", rows, events, err)
	}
	if _, err := s.pool.Exec(ctx, `ALTER TABLE actions_log DROP CONSTRAINT reject_escalation_success`); err != nil {
		t.Fatal(err)
	}
	if _, err := callAction(s, requestID, policy.CreateEscalation, actionID); err != nil {
		t.Fatal(err)
	}
}
