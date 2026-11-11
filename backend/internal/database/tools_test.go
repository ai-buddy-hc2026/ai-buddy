package database

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"sync"
	"testing"
	"time"

	"github.com/ai-buddy-hc2026/ai-buddy/backend/internal/auth"
	"github.com/ai-buddy-hc2026/ai-buddy/backend/internal/chat"
	"github.com/ai-buddy-hc2026/ai-buddy/backend/internal/identifier"
	"github.com/ai-buddy-hc2026/ai-buddy/backend/internal/onboarding"
	"github.com/ai-buddy-hc2026/ai-buddy/backend/internal/policy"
	"github.com/ai-buddy-hc2026/ai-buddy/backend/internal/tools"
)

func toolFixture(t *testing.T) (*Tools, string) {
	t.Helper()
	chatStore := chatStore(t)
	s, err := NewTools(chatStore.pool, 0)
	if err != nil {
		t.Fatal(err)
	}
	return s, toolRequest(t, s, chatAnya)
}

func toolRequest(t *testing.T, s *Tools, actorID string) string {
	t.Helper()
	id, err := identifier.NewUUID()
	if err != nil {
		t.Fatal(err)
	}
	_, _, err = NewChat(s.pool).Create(context.Background(), actorID, id, chat.Input{Message: "Синтетический вызов инструмента"})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := s.pool.Exec(context.Background(), "UPDATE chat_requests SET deadline_at=now()+interval '1 hour' WHERE id=$1", id); err != nil {
		t.Fatal(err)
	}
	return id
}

// Подтверждение создается только фикстурой доверенного UI, не MCP-вызовом.
func toolActionFixture(t *testing.T, s *Tools, requestID string, operation policy.Operation, params any, confirmed bool) string {
	t.Helper()
	raw, err := json.Marshal(params)
	if err != nil {
		t.Fatal(err)
	}
	var id string
	err = s.pool.QueryRow(context.Background(), `INSERT INTO actions_log(team_id,request_id,proposal_seq,actor_id,action_type,parameters)
 SELECT team_id,id,(SELECT COALESCE(max(proposal_seq),0)+1 FROM actions_log WHERE request_id=$1),user_id,$2,$3 FROM chat_requests WHERE id=$1 RETURNING id::text`, requestID, string(operation), raw).Scan(&id)
	if err != nil {
		t.Fatal(err)
	}
	if confirmed {
		if _, err := s.pool.Exec(context.Background(), `UPDATE actions_log SET status='confirmed',confirmed_by=actor_id,confirmed_at=now() WHERE id=$1`, id); err != nil {
			t.Fatal(err)
		}
	}
	return id
}

func callAction(s *Tools, requestID string, operation policy.Operation, actionID string) (any, error) {
	raw, _ := json.Marshal(tools.ActionInput{ActionID: actionID})
	return s.Call(context.Background(), requestID, operation, raw)
}

func absenceParams() tools.AbsenceParameters {
	return tools.AbsenceParameters{Date: time.Now().AddDate(0, 0, 2).Format(time.DateOnly), Type: "отгул", Approver: "10000000-0000-0000-0000-000000000003"}
}

func canonicalToolResult(result any) (string, error) {
	raw, err := json.Marshal(result)
	if err != nil {
		return "", err
	}
	var value any
	if err := json.Unmarshal(raw, &value); err != nil {
		return "", err
	}
	raw, err = json.Marshal(value)
	return string(raw), err
}

func TestToolReadContextAndScope(t *testing.T) {
	s, requestID := toolFixture(t)
	ctx := context.Background()
	for _, op := range []policy.Operation{policy.GetPlan, policy.GetManager, policy.GetAbsencePolicy, policy.ListAbsences} {
		if _, err := s.Call(ctx, requestID, op, json.RawMessage(`{}`)); err != nil {
			t.Fatalf("%s: %v", op, err)
		}
	}
	for _, op := range []policy.Operation{policy.GetManager, policy.ListAbsences} {
		for _, employee := range []string{"10000000-0000-0000-0000-000000000002", "10000000-0000-0000-0000-000000000004"} {
			raw := json.RawMessage(fmt.Sprintf(`{"employee_id":%q}`, employee))
			if _, err := s.Call(ctx, requestID, op, raw); !errors.Is(err, tools.ErrDenied) {
				t.Fatalf("foreign employee allowed: %v", err)
			}
		}
	}
	leadRequest := toolRequest(t, s, "10000000-0000-0000-0000-000000000003")
	if _, err := s.Call(ctx, leadRequest, policy.ListAbsences, json.RawMessage(`{}`)); err != nil {
		t.Fatal(err)
	}
	if _, err := s.Call(ctx, leadRequest, policy.ListAbsences, json.RawMessage(`{"employee_id":"10000000-0000-0000-0000-000000000001"}`)); !errors.Is(err, tools.ErrDenied) {
		t.Fatal("lead saw foreign absences", err)
	}
	for _, raw := range []string{`{"role":"lead"}`, `{"team_id":"other"}`, `{"request_id":"other"}`} {
		if _, err := s.Call(ctx, requestID, policy.GetManager, json.RawMessage(raw)); !errors.Is(err, tools.ErrInvalid) {
			t.Fatalf("context override accepted: %v", err)
		}
	}
	if _, err := s.Call(ctx, requestID, "unknown", json.RawMessage(`{}`)); !errors.Is(err, tools.ErrDenied) {
		t.Fatal(err)
	}
	if _, err := s.pool.Exec(ctx, `UPDATE chat_requests SET created_at=now()-interval '2 hours',deadline_at=now()-interval '1 hour' WHERE id=$1`, requestID); err != nil {
		t.Fatal(err)
	}
	if _, err := s.Call(ctx, requestID, policy.GetManager, json.RawMessage(`{}`)); !errors.Is(err, tools.ErrContext) {
		t.Fatal("expired context accepted", err)
	}
}

func TestAbsenceConcurrentReplayAndRestart(t *testing.T) {
	s, requestID := toolFixture(t)
	ctx := context.Background()
	actionID := toolActionFixture(t, s, requestID, policy.CreateAbsence, absenceParams(), true)
	var wg sync.WaitGroup
	results := make(chan string, 8)
	for range 8 {
		wg.Go(func() {
			result, err := callAction(s, requestID, policy.CreateAbsence, actionID)
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
	var want string
	for result := range results {
		if want == "" {
			want = result
		}
		if result != want {
			t.Fatal("different replay result", result, want)
		}
	}
	if want == "" {
		t.Fatal("no successful result")
	}
	restarted, err := NewTools(s.pool, 1)
	if err != nil {
		t.Fatal(err)
	}
	// Подтверждение и повтор могут прийти уже после завершения генерации.
	if _, err := s.pool.Exec(ctx, `UPDATE chat_requests SET status='done',last_seq=1,terminal_seq=1,finished_at=now() WHERE id=$1`, requestID); err != nil {
		t.Fatal(err)
	}
	result, err := callAction(restarted, requestID, policy.CreateAbsence, actionID)
	if err != nil {
		t.Fatal(err)
	}
	raw, err := canonicalToolResult(result)
	if err != nil || raw != want {
		t.Fatal("restart lost result")
	}
	var count, attempts int
	if err := s.pool.QueryRow(ctx, `SELECT (SELECT count(*) FROM absence_requests),attempt_count FROM actions_log WHERE id=$1`, actionID).Scan(&count, &attempts); err != nil || count != 1 || attempts != 1 {
		t.Fatalf("rows=%d attempts=%d err=%v", count, attempts, err)
	}
	if _, err := s.pool.Exec(ctx, `UPDATE actions_log SET parameters='{}' WHERE id=$1`, actionID); err == nil {
		t.Fatal("confirmed parameters replaced")
	}
	if _, err := s.pool.Exec(ctx, `UPDATE actions_log SET idempotency_key=gen_random_uuid() WHERE id=$1`, actionID); err == nil {
		t.Fatal("confirmed key replaced")
	}
	if _, err := s.pool.Exec(ctx, `INSERT INTO actions_log(team_id,request_id,proposal_seq,actor_id,action_type,parameters,idempotency_key) SELECT team_id,request_id,proposal_seq+100,actor_id,action_type,'{}',idempotency_key FROM actions_log WHERE id=$1`, actionID); err == nil {
		t.Fatal("same key assigned to different parameters")
	}
	if _, err := s.pool.Exec(ctx, `UPDATE users SET active=false WHERE id=$1`, chatAnya); err != nil {
		t.Fatal(err)
	}
	if _, err := callAction(s, requestID, policy.CreateAbsence, actionID); !errors.Is(err, auth.ErrUnauthorized) {
		t.Fatal("inactive actor replay accepted", err)
	}
}

func TestAbsenceResultFailureRollsBackCreation(t *testing.T) {
	s, requestID := toolFixture(t)
	ctx := context.Background()
	actionID := toolActionFixture(t, s, requestID, policy.CreateAbsence, absenceParams(), true)
	if _, err := s.pool.Exec(ctx, `ALTER TABLE actions_log ADD CONSTRAINT reject_absence_success CHECK (status<>'succeeded') NOT VALID`); err != nil {
		t.Fatal(err)
	}
	if _, err := callAction(s, requestID, policy.CreateAbsence, actionID); err == nil {
		t.Fatal("result error ignored")
	}
	var count int
	if err := s.pool.QueryRow(ctx, "SELECT count(*) FROM absence_requests").Scan(&count); err != nil || count != 0 {
		t.Fatalf("partial absence saved: %d %v", count, err)
	}
	if _, err := s.pool.Exec(ctx, `ALTER TABLE actions_log DROP CONSTRAINT reject_absence_success`); err != nil {
		t.Fatal(err)
	}
	if _, err := callAction(s, requestID, policy.CreateAbsence, actionID); err != nil {
		t.Fatal(err)
	}
	if err := s.pool.QueryRow(ctx, "SELECT count(*) FROM absence_requests").Scan(&count); err != nil || count != 1 {
		t.Fatalf("retry rows=%d err=%v", count, err)
	}
}

func TestAbsenceConfirmationFailureAndRetry(t *testing.T) {
	s, requestID := toolFixture(t)
	ctx := context.Background()
	actionID := toolActionFixture(t, s, requestID, policy.CreateAbsence, absenceParams(), false)
	if _, err := callAction(s, requestID, policy.CreateAbsence, actionID); !errors.Is(err, tools.ErrConfirmation) {
		t.Fatal(err)
	}
	if _, err := s.Call(ctx, requestID, policy.CreateAbsence, json.RawMessage(fmt.Sprintf(`{"action_id":%q,"confirmed":true}`, actionID))); !errors.Is(err, tools.ErrInvalid) {
		t.Fatal("agent confirmed action", err)
	}
	otherRequest := toolRequest(t, s, "10000000-0000-0000-0000-000000000004")
	if _, err := callAction(s, otherRequest, policy.CreateAbsence, actionID); !errors.Is(err, tools.ErrDenied) {
		t.Fatal("foreign action accepted", err)
	}
	if _, err := s.pool.Exec(ctx, `UPDATE actions_log SET status='confirmed',confirmed_by=actor_id,confirmed_at=now() WHERE id=$1`, actionID); err != nil {
		t.Fatal(err)
	}
	s.failureRate = 1
	if _, err := callAction(s, requestID, policy.CreateAbsence, actionID); !errors.Is(err, tools.ErrUnavailable) {
		t.Fatal(err)
	}
	var status, key string
	var count, attempts int
	if err := s.pool.QueryRow(ctx, `SELECT status,idempotency_key::text,attempt_count,(SELECT count(*) FROM absence_requests) FROM actions_log WHERE id=$1`, actionID).Scan(&status, &key, &attempts, &count); err != nil || status != "failed" || attempts != 1 || count != 0 {
		t.Fatalf("failure state %s attempts=%d rows=%d err=%v", status, attempts, count, err)
	}
	s.failureRate = 0
	if _, err := callAction(s, requestID, policy.CreateAbsence, actionID); err != nil {
		t.Fatal(err)
	}
	var savedKey string
	if err := s.pool.QueryRow(ctx, `SELECT idempotency_key::text,attempt_count FROM actions_log WHERE id=$1`, actionID).Scan(&savedKey, &attempts); err != nil || key != savedKey || attempts != 2 {
		t.Fatalf("retry changed key or attempts: %v", err)
	}
	invalid := absenceParams()
	invalid.Date = "2020-01-01"
	badID := toolActionFixture(t, s, requestID, policy.CreateAbsence, invalid, true)
	if _, err := callAction(s, requestID, policy.CreateAbsence, badID); !errors.Is(err, tools.ErrInvalid) {
		t.Fatal("past date accepted", err)
	}
	invalid = absenceParams()
	invalid.Approver = "10000000-0000-0000-0000-000000000002"
	badID = toolActionFixture(t, s, requestID, policy.CreateAbsence, invalid, true)
	if _, err := callAction(s, requestID, policy.CreateAbsence, badID); !errors.Is(err, tools.ErrConflict) {
		t.Fatal("substituted approver accepted", err)
	}
}

func TestChecklistConfirmedActionIsAtomic(t *testing.T) {
	s, requestID := toolFixture(t)
	ctx := context.Background()
	plan, err := NewOnboarding(s.pool).GetPlan(ctx, chatAnya, "")
	if err != nil {
		t.Fatal(err)
	}
	task := plan.Stages[0].Tasks[1]
	params := tools.TaskParameters{TaskID: task.ID, Status: "done", Version: 1}
	actionID := toolActionFixture(t, s, requestID, policy.UpdateStatus, params, false)
	if _, err := callAction(s, requestID, policy.UpdateStatus, actionID); !errors.Is(err, tools.ErrConfirmation) {
		t.Fatal(err)
	}
	if _, err := s.pool.Exec(ctx, `UPDATE actions_log SET status='confirmed',confirmed_by=actor_id,confirmed_at=now() WHERE id=$1`, actionID); err != nil {
		t.Fatal(err)
	}
	for range 2 {
		if _, err := callAction(s, requestID, policy.UpdateStatus, actionID); err != nil {
			t.Fatal(err)
		}
	}
	var version, history, events int
	if err := s.pool.QueryRow(ctx, `SELECT version,(SELECT count(*) FROM task_status_history WHERE task_id=$1),(SELECT count(*) FROM events WHERE task_id=$1 AND event_type='task_status_changed') FROM tasks WHERE id=$1`, task.ID).Scan(&version, &history, &events); err != nil || version != 2 || history != 2 || events != 1 {
		t.Fatalf("v=%d history=%d events=%d err=%v", version, history, events, err)
	}
	// Ошибка записи результата действия должна откатить и изменение задачи.
	params = tools.TaskParameters{TaskID: task.ID, Status: "blocked", Version: 2}
	rollbackID := toolActionFixture(t, s, requestID, policy.UpdateStatus, params, true)
	if _, err := s.pool.Exec(ctx, `ALTER TABLE actions_log ADD CONSTRAINT reject_success_test CHECK (status<>'succeeded') NOT VALID`); err != nil {
		t.Fatal(err)
	}
	if _, err := callAction(s, requestID, policy.UpdateStatus, rollbackID); err == nil {
		t.Fatal("result failure ignored")
	}
	loaded, err := NewOnboarding(s.pool).GetPlan(ctx, chatAnya, "")
	if err != nil {
		t.Fatal(err)
	}
	var saved onboarding.Task
	for _, stage := range loaded.Stages {
		for _, item := range stage.Tasks {
			if item.ID == task.ID {
				saved = item
			}
		}
	}
	if saved.Version != 2 || saved.Status != "done" {
		t.Fatal("partial task mutation", saved)
	}
}
