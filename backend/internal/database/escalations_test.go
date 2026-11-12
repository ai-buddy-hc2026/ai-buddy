package database

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/ai-buddy-hc2026/ai-buddy/backend/internal/escalation"
	"github.com/ai-buddy-hc2026/ai-buddy/backend/internal/policy"
	"github.com/ai-buddy-hc2026/ai-buddy/backend/internal/tools"
)

func escalationParams(t *testing.T, s *Tools, requestID string) tools.EscalationParameters {
	t.Helper()
	message := tools.ContextMessage{Sources: []json.RawMessage{}}
	if err := s.pool.QueryRow(context.Background(), `SELECT id::text,role,content FROM chat_messages WHERE request_id=$1 AND role='user'`, requestID).Scan(&message.MessageID, &message.Role, &message.Content); err != nil {
		t.Fatal(err)
	}
	return tools.EscalationParameters{BuddyID: "4a59a828-3b1a-55e4-bf9b-81db5ad6183a", Question: "Нужна помощь с задачей", ContextSnapshot: []tools.ContextMessage{message}}
}

func TestAnswerEscalationPublishesAndReplays(t *testing.T) {
	s, requestID := toolFixture(t)
	params := escalationParams(t, s, requestID)
	actionID := toolActionFixture(t, s, requestID, policy.CreateEscalation, params, true)
	if _, err := callAction(s, requestID, policy.CreateEscalation, actionID); err != nil {
		t.Fatal(err)
	}
	var escalationID string
	var version time.Time
	if err := s.pool.QueryRow(context.Background(), `SELECT id::text,updated_at FROM escalations WHERE action_id=$1`, actionID).Scan(&escalationID, &version); err != nil {
		t.Fatal(err)
	}
	store, err := NewEscalations(s.pool, []byte("synthetic-test-key-with-at-least-32-bytes"))
	if err != nil {
		t.Fatal(err)
	}
	request := escalation.AnswerRequest{AnswerText: "Проверьте порядок релиза в тестовой инструкции.", AddToKB: true, Version: escalationVersion(version)}
	staleVersion := request.Version
	result, err := store.Answer(context.Background(), params.BuddyID, escalationID, request)
	if err != nil {
		t.Fatal(err)
	}
	if result.Status != "answered" || !result.AddToKB || result.KBStatus != "ready" || result.KBDocumentID == nil || result.AnswerText != request.AnswerText {
		t.Fatalf("unexpected answer: %+v", result)
	}
	var docStatus, indexStatus, content string
	var revision, indexedRevision int
	if err := s.pool.QueryRow(context.Background(), `SELECT status,index_status,content,revision,indexed_revision FROM kb_documents WHERE source_escalation_id=$1`, escalationID).Scan(&docStatus, &indexStatus, &content, &revision, &indexedRevision); err != nil {
		t.Fatal(err)
	}
	if docStatus != "published" || indexStatus != "ready" || indexedRevision != revision || !strings.Contains(content, "Тестовая инструкция, не регламент Авито") {
		t.Fatalf("document is not ready and marked: %s %s %d/%d %s", docStatus, indexStatus, indexedRevision, revision, content)
	}
	search, err := NewKnowledge(s.pool).Search(context.Background(), chatAnya, "тестовой инструкции")
	if err != nil || len(search.Items) != 1 || search.Items[0].Source.DocumentID != *result.KBDocumentID || search.Items[0].Source.Revision != 1 {
		t.Fatalf("published answer was not searchable with its source: %+v %v", search, err)
	}
	page, err := store.List(context.Background(), params.BuddyID, escalation.ListQuery{Limit: 50, Status: "answered"})
	if err != nil || len(page.Items) != 1 || page.Items[0].Version != result.Version || page.Items[0].Publication == nil {
		t.Fatalf("mentor list did not expose current answer version: %+v %v", page, err)
	}
	request.Version = result.Version
	replay, err := store.Answer(context.Background(), params.BuddyID, escalationID, request)
	if err != nil || replay.KBDocumentID == nil || *replay.KBDocumentID != *result.KBDocumentID {
		t.Fatalf("replay created a different result: %+v %v", replay, err)
	}
	request.AnswerText = "измененный ответ"
	request.Version = staleVersion
	if _, err := store.Answer(context.Background(), params.BuddyID, escalationID, request); !errors.Is(err, escalation.ErrConflict) {
		t.Fatalf("stale version accepted: %v", err)
	}
	var documents int
	if err := s.pool.QueryRow(context.Background(), "SELECT count(*) FROM kb_documents WHERE source_escalation_id=$1", escalationID).Scan(&documents); err != nil || documents != 1 {
		t.Fatalf("documents=%d err=%v", documents, err)
	}
}

func TestAnswerEscalationRequiresAssignedBuddy(t *testing.T) {
	s, requestID := toolFixture(t)
	params := escalationParams(t, s, requestID)
	actionID := toolActionFixture(t, s, requestID, policy.CreateEscalation, params, true)
	if _, err := callAction(s, requestID, policy.CreateEscalation, actionID); err != nil {
		t.Fatal(err)
	}
	var escalationID string
	var version time.Time
	if err := s.pool.QueryRow(context.Background(), `SELECT id::text,updated_at FROM escalations WHERE action_id=$1`, actionID).Scan(&escalationID, &version); err != nil {
		t.Fatal(err)
	}
	request := escalation.AnswerRequest{AnswerText: "Ответ", Version: escalationVersion(version)}
	store, err := NewEscalations(s.pool, []byte("synthetic-test-key-with-at-least-32-bytes"))
	if err != nil {
		t.Fatal(err)
	}
	if _, err := store.Answer(context.Background(), chatAnya, escalationID, request); !errors.Is(err, escalation.ErrDenied) {
		t.Fatalf("intern answered escalation: %v", err)
	}
	if _, err := s.pool.Exec(context.Background(), `UPDATE users SET buddy_id=NULL WHERE id=$1`, chatAnya); err != nil {
		t.Fatal(err)
	}
	if _, err := store.Answer(context.Background(), params.BuddyID, escalationID, request); !errors.Is(err, escalation.ErrNotFound) {
		t.Fatalf("former buddy answered after assignment changed: %v", err)
	}
	var answerText string
	if err := s.pool.QueryRow(context.Background(), `SELECT COALESCE(answer_text,'') FROM escalations WHERE id=$1`, escalationID).Scan(&answerText); err != nil || answerText != "" {
		t.Fatalf("denied answer was stored: %q %v", answerText, err)
	}
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
	foreignRequest := toolRequest(t, s, "2db7cc77-4114-52d8-a833-f670ab60e4e0")
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
		{"foreign buddy", func(p *tools.EscalationParameters) { p.BuddyID = "0f8153be-1c96-5e0f-aa4c-55b7ed7bf47a" }, tools.ErrDenied},
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
