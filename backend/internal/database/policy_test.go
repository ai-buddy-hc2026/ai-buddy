package database

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"testing"

	"github.com/ai-buddy-hc2026/ai-buddy/backend/internal/chat"
	"github.com/ai-buddy-hc2026/ai-buddy/backend/internal/onboarding"
	"github.com/ai-buddy-hc2026/ai-buddy/backend/internal/policy"
)

func TestPolicyEventCatalogValues(t *testing.T) {
	operations := []policy.Operation{
		policy.GetPlan, policy.UpdateStatus, policy.CreateChat, policy.ReadChat,
		policy.GetManager, policy.GetAbsencePolicy, policy.ListAbsences,
		policy.CreateAbsence, policy.CreateEscalation, policy.AnswerEscalation,
		policy.SearchKnowledge, policy.ListBuddyInterns, policy.ListActions,
	}
	for _, operation := range operations {
		if !validPolicyEventOperation(operation) {
			t.Errorf("operation %q is missing from events catalog", operation)
		}
	}
	if validPolicyEventOperation("unknown.operation") {
		t.Fatal("unknown operation accepted")
	}

	reasons := []string{
		"invalid_actor", "role_denied", "team_denied", "owner_or_assignment_denied",
		"assignee_denied", "owner_denied", "assignment_denied", "operation_denied",
		"resource_unavailable", "action_unavailable", "confirmation_required",
		"buddy_unavailable", "source_unavailable", "context_unavailable",
		"assignment_changed", "conversation_unavailable",
	}
	for _, reason := range reasons {
		if !validPolicyEventReason(reason) {
			t.Errorf("reason %q is missing from events catalog", reason)
		}
	}
	if validPolicyEventReason("unknown_reason") {
		t.Fatal("unknown reason accepted")
	}
}

func TestPolicyDenialsPersistWithoutForeignData(t *testing.T) {
	store, handler, tokens := onboardingHandler(t)
	ctx := context.Background()
	plan, err := store.GetPlan(ctx, chatAnya, "")
	if err != nil {
		t.Fatal(err)
	}
	task := plan.Stages[0].Tasks[0]
	foreign := "2db7cc77-4114-52d8-a833-f670ab60e4e0"
	for _, tc := range []struct {
		method, path, body string
		code               int
	}{
		{"PATCH", "/tasks/" + task.ID, `{"status":"done","version":1}`, 403},
		{"GET", "/onboarding/plan?intern_id=" + foreign, "", 404},
	} {
		w := onboardingRequest(handler, tc.method, tc.path, tokens["intern_anya"], tc.body)
		if w.Code != tc.code {
			t.Fatalf("denial: %d %s", w.Code, w.Body.String())
		}
	}
	chatStore := NewChat(store.pool)
	record, _ := createChat(t, chatStore, chat.Input{Message: "Синтетический вопрос"})
	if _, err := chatStore.Get(ctx, foreign, record.RequestID); !errors.Is(err, chat.ErrNotFound) {
		t.Fatal(err)
	}
	if _, err := chatStore.History(ctx, foreign, record.ConversationID, "", 50); !errors.Is(err, chat.ErrNotFound) {
		t.Fatal(err)
	}
	if _, _, err := chatStore.Create(ctx, foreign, "50000000-0000-0000-0000-000000000001", chat.Input{Message: "Вопрос", ConversationID: record.ConversationID}); !errors.Is(err, chat.ErrNotFound) {
		t.Fatal(err)
	}
	// Назначение проверяется заново даже при ранее выданном JWT.
	if _, err := store.pool.Exec(ctx, "UPDATE users SET buddy_id=NULL WHERE id=$1", chatAnya); err != nil {
		t.Fatal(err)
	}
	w := onboardingRequest(handler, "GET", "/onboarding/plan?intern_id="+chatAnya, tokens["buddy_ilya"], "")
	if w.Code != 404 {
		t.Fatalf("stale assignment accepted: %d", w.Code)
	}
	// Роль в старом JWT также не дает прежних прав.
	if _, err := store.pool.Exec(ctx, "UPDATE users SET role='buddy' WHERE login='lead_maria'"); err != nil {
		t.Fatal(err)
	}
	w = onboardingRequest(handler, "GET", "/onboarding/plan?intern_id="+chatAnya, tokens["lead_maria"], "")
	if w.Code != 404 {
		t.Fatalf("stale role accepted: %d", w.Code)
	}
	rows, err := store.pool.Query(ctx, `SELECT e.payload,e.task_id IS NULL AND e.request_id IS NULL AND e.action_id IS NULL AND e.team_id=u.team_id FROM events e JOIN users u ON u.id=e.actor_id WHERE event_type='policy_denied'`)
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()
	count := 0
	for rows.Next() {
		var raw []byte
		var safe bool
		if err := rows.Scan(&raw, &safe); err != nil {
			t.Fatal(err)
		}
		var payload map[string]string
		if err := json.Unmarshal(raw, &payload); err != nil {
			t.Fatal(err)
		}
		if !safe || len(payload) != 2 || payload["operation"] == "" || payload["reason"] == "" || strings.Contains(string(raw), record.RequestID) || strings.Contains(string(raw), foreign) {
			t.Fatalf("unsafe event: %s", raw)
		}
		count++
	}
	if err := rows.Err(); err != nil {
		t.Fatal(err)
	}
	if count != 7 {
		t.Fatalf("denials=%d want 7", count)
	}
	var version, history int
	var status string
	if err := store.pool.QueryRow(ctx, "SELECT status,version,(SELECT count(*) FROM task_status_history WHERE task_id=t.id) FROM tasks t WHERE id=$1", task.ID).Scan(&status, &version, &history); err != nil {
		t.Fatal(err)
	}
	if status != "todo" || version != 1 || history != 1 {
		t.Fatalf("denied action changed task: %s %d %d", status, version, history)
	}
	if _, err := store.UpdateStatus(ctx, chatAnya, task.ID, onboarding.StatusChange{Status: "done", Version: 1}); !errors.Is(err, onboarding.ErrForbidden) {
		t.Fatal(err)
	}
}

func TestPolicyAuditCancellationAndFailure(t *testing.T) {
	store := chatStore(t)
	ctx := context.Background()
	tx, err := store.pool.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	actor, err := loadPlanActor(ctx, tx, chatAnya, true)
	if err != nil {
		t.Fatal(err)
	}
	cancelled, cancel := context.WithCancel(ctx)
	cancel()
	if err := denyPolicy(cancelled, store.pool, tx, actor, policy.ReadChat, "owner_denied", chat.ErrNotFound); !errors.Is(err, chat.ErrNotFound) {
		t.Fatal(err)
	}
	var count int
	if err := store.pool.QueryRow(ctx, "SELECT count(*) FROM events WHERE event_type='policy_denied'").Scan(&count); err != nil || count != 1 {
		t.Fatalf("cancelled audit count=%d err=%v", count, err)
	}
	if _, err := store.pool.Exec(ctx, "ALTER TABLE events ADD CONSTRAINT reject_policy_test CHECK (event_type <> 'policy_denied') NOT VALID"); err != nil {
		t.Fatal(err)
	}
	// Ошибка записи события не превращает отказ в успех или обычный 404.
	_, err = store.Get(ctx, actor.id, "50000000-0000-0000-0000-000000000001")
	if err == nil || errors.Is(err, chat.ErrNotFound) || !strings.Contains(err.Error(), "record policy denial") {
		t.Fatalf("audit failure ignored: %v", err)
	}
}
