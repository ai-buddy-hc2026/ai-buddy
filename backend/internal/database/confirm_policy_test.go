package database

import (
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"testing"
	"time"

	"github.com/ai-buddy-hc2026/ai-buddy/backend/internal/auth"
	"github.com/ai-buddy-hc2026/ai-buddy/backend/internal/httpapi"
	"github.com/ai-buddy-hc2026/ai-buddy/backend/internal/policy"
	"github.com/ai-buddy-hc2026/ai-buddy/backend/internal/tools"
)

const confirmTestBuddy = "4a59a828-3b1a-55e4-bf9b-81db5ad6183a"

func confirmHandler(t *testing.T, store *Tools, login string) (http.Handler, string) {
	t.Helper()
	ctx := context.Background()
	service, err := auth.New(NewUsers(store.pool), []byte("synthetic-test-key-of-at-least-32-bytes"), time.Hour)
	if err != nil {
		t.Fatal(err)
	}
	result, err := service.Login(ctx, login)
	if err != nil {
		t.Fatal(err)
	}
	base := httpapi.NewHandler(slog.New(slog.NewJSONHandler(io.Discard, nil)), service, NewOnboarding(store.pool))
	return httpapi.WithConfirmation(base, service, store), result.AccessToken
}

func assertConfirmDenied(t *testing.T, store *Tools, actionID, taskID, operation, reason string, beforeHistory int) {
	t.Helper()
	var status string
	var attempts int
	var confirmationMissing bool
	var confirmedEvents int
	err := store.pool.QueryRow(context.Background(), `SELECT status,attempt_count,confirmed_at IS NULL,
		(SELECT count(*) FROM events WHERE action_id=$1 AND event_type='action_confirmed')
		FROM actions_log WHERE id=$1`, actionID).Scan(&status, &attempts, &confirmationMissing, &confirmedEvents)
	if err != nil || status != "proposed" || attempts != 0 || !confirmationMissing || confirmedEvents != 0 {
		t.Fatalf("denied action changed state: status=%q attempts=%d confirmationMissing=%v events=%d err=%v", status, attempts, confirmationMissing, confirmedEvents, err)
	}
	var taskStatus string
	var version int
	var history int
	if err := store.pool.QueryRow(context.Background(), `SELECT status,version,
		(SELECT count(*) FROM task_status_history WHERE task_id=$1) FROM tasks WHERE id=$1`, taskID).
		Scan(&taskStatus, &version, &history); err != nil {
		t.Fatal(err)
	}
	if taskStatus != "todo" || version != 1 || history != beforeHistory {
		t.Fatalf("denied confirmation changed task: status=%q version=%d history=%d wantHistory=%d", taskStatus, version, history, beforeHistory)
	}
	var auditedOperation, auditedReason string
	if err := store.pool.QueryRow(context.Background(), `SELECT payload->>'operation',payload->>'reason'
		FROM events WHERE event_type='policy_denied' ORDER BY created_at DESC LIMIT 1`).
		Scan(&auditedOperation, &auditedReason); err != nil {
		t.Fatal(err)
	}
	if auditedOperation != operation || auditedReason != reason {
		t.Fatalf("unexpected denial audit: operation=%q reason=%q", auditedOperation, auditedReason)
	}
}

func TestConfirmRechecksTaskAssignee(t *testing.T) {
	store, requestID := toolFixture(t)
	ctx := context.Background()
	plan, err := NewOnboarding(store.pool).GetPlan(ctx, chatAnya, "")
	if err != nil {
		t.Fatal(err)
	}
	var taskID string
	var version int
	if err := store.pool.QueryRow(ctx, `SELECT id::text,version FROM tasks
		WHERE plan_id=$1 AND assignee_id=$2 AND status='todo' ORDER BY position LIMIT 1`, plan.ID, chatAnya).
		Scan(&taskID, &version); err != nil {
		t.Fatal(err)
	}
	beforeHistory := taskHistoryCount(t, store, taskID)
	actionID := toolActionFixture(t, store, requestID, policy.UpdateStatus,
		tools.TaskParameters{TaskID: taskID, Status: "done", Version: version}, false)
	handler, token := confirmHandler(t, store, "intern_anya")
	if _, err := store.pool.Exec(ctx, "UPDATE tasks SET assignee_id=$2 WHERE id=$1", taskID, confirmTestBuddy); err != nil {
		t.Fatal(err)
	}
	response := onboardingRequest(handler, "POST", "/actions/"+actionID+"/confirm", token, "")
	var body struct {
		Error struct {
			Code string `json:"code"`
		} `json:"error"`
	}
	if err := json.Unmarshal(response.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	if response.Code != 403 || body.Error.Code != "POLICY_DENIED" {
		t.Fatalf("confirm after reassignment: status=%d body=%s", response.Code, response.Body.String())
	}
	assertConfirmDenied(t, store, actionID, taskID, string(policy.UpdateStatus), "assignee_denied", beforeHistory)
}

func TestConfirmRechecksBuddyAssignment(t *testing.T) {
	store, _ := toolFixture(t)
	ctx := context.Background()
	requestID := toolRequest(t, store, confirmTestBuddy)
	plan, err := NewOnboarding(store.pool).GetPlan(ctx, chatAnya, "")
	if err != nil {
		t.Fatal(err)
	}
	var taskID string
	var version int
	if err := store.pool.QueryRow(ctx, `SELECT id::text,version FROM tasks
		WHERE plan_id=$1 AND assignee_id=$2 AND status='todo' ORDER BY position LIMIT 1`, plan.ID, confirmTestBuddy).
		Scan(&taskID, &version); err != nil {
		t.Fatal(err)
	}
	beforeHistory := taskHistoryCount(t, store, taskID)
	actionID := toolActionFixture(t, store, requestID, policy.UpdateStatus,
		tools.TaskParameters{TaskID: taskID, Status: "done", Version: version}, false)
	handler, token := confirmHandler(t, store, "buddy_ilya")
	if _, err := store.pool.Exec(ctx, "UPDATE users SET buddy_id=NULL WHERE id=$1", chatAnya); err != nil {
		t.Fatal(err)
	}
	response := onboardingRequest(handler, "POST", "/actions/"+actionID+"/confirm", token, "")
	var body struct {
		Error struct {
			Code string `json:"code"`
		} `json:"error"`
	}
	if err := json.Unmarshal(response.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	if response.Code != 404 || body.Error.Code != "NOT_FOUND" {
		t.Fatalf("confirm after assignment revocation: status=%d body=%s", response.Code, response.Body.String())
	}
	assertConfirmDenied(t, store, actionID, taskID, string(policy.UpdateStatus), "owner_or_assignment_denied", beforeHistory)
}

func taskHistoryCount(t *testing.T, store *Tools, taskID string) int {
	t.Helper()
	var count int
	if err := store.pool.QueryRow(context.Background(), "SELECT count(*) FROM task_status_history WHERE task_id=$1", taskID).Scan(&count); err != nil {
		t.Fatal(err)
	}
	return count
}
