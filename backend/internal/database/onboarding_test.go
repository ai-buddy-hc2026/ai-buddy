package database

import (
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/ai-buddy-hc2026/ai-buddy/backend/internal/auth"
	"github.com/ai-buddy-hc2026/ai-buddy/backend/internal/httpapi"
	"github.com/ai-buddy-hc2026/ai-buddy/backend/internal/onboarding"
)

func onboardingHandler(t *testing.T) (*Onboarding, http.Handler, map[string]string) {
	t.Helper()
	pool := testPool(t)
	if err := Prepare(context.Background(), pool, "../../../seed/checklist.json"); err != nil {
		t.Fatal(err)
	}
	service, err := auth.New(NewUsers(pool), []byte("synthetic-test-key-of-at-least-32-bytes"), time.Hour)
	if err != nil {
		t.Fatal(err)
	}
	store := NewOnboarding(pool)
	handler := httpapi.NewHandler(slog.New(slog.NewJSONHandler(io.Discard, nil)), service, store)
	tokens := make(map[string]string)
	for _, login := range []string{"intern_anya", "intern_petr", "buddy_ilya", "buddy_olga", "lead_maria", "lead_alexey"} {
		result, err := service.Login(context.Background(), login)
		if err != nil {
			t.Fatal(err)
		}
		tokens[login] = result.AccessToken
	}
	return store, handler, tokens
}

func onboardingRequest(handler http.Handler, method, path, token, body string) *httptest.ResponseRecorder {
	r := httptest.NewRequest(method, path, strings.NewReader(body))
	if token != "" {
		r.Header.Set("Authorization", "Bearer "+token)
	}
	r.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, r)
	return w
}

func TestOnboardingHTTPAccessAndPersistence(t *testing.T) {
	store, handler, tokens := onboardingHandler(t)
	ctx := context.Background()
	anya := "10000000-0000-0000-0000-000000000001"
	petr := "10000000-0000-0000-0000-000000000004"
	for _, tc := range []struct {
		login, path string
		want        int
	}{
		{"intern_anya", "/onboarding/plan", 200},
		{"intern_anya", "/onboarding/plan?intern_id=" + anya, 200},
		{"intern_anya", "/onboarding/plan?intern_id=" + petr, 404},
		{"buddy_ilya", "/onboarding/plan?intern_id=" + anya, 200},
		{"buddy_olga", "/onboarding/plan?intern_id=" + anya, 404},
		{"lead_maria", "/onboarding/plan?intern_id=" + anya, 200},
		{"lead_maria", "/onboarding/plan?intern_id=" + petr, 404},
		{"buddy_ilya", "/onboarding/plan", 400},
		{"lead_maria", "/onboarding/plan", 400},
		{"intern_anya", "/onboarding/plan?intern_id=intern_anya", 400},
		{"intern_anya", "/onboarding/plan?intern_id=", 400},
		{"intern_anya", "/onboarding/plan?intern_id=" + anya + "&intern_id=" + anya, 400},
		{"intern_anya", "/onboarding/plan?role=lead", 400},
		{"", "/onboarding/plan", 401},
	} {
		w := onboardingRequest(handler, "GET", tc.path, tokens[tc.login], "")
		if w.Code != tc.want {
			t.Fatalf("%s %s: %d %s", tc.login, tc.path, w.Code, w.Body.String())
		}
	}
	w := onboardingRequest(handler, "GET", "/onboarding/plan", tokens["intern_anya"], "")
	var plan onboarding.Plan
	if err := json.Unmarshal(w.Body.Bytes(), &plan); err != nil {
		t.Fatal(err)
	}
	if plan.Progress.Total != 15 || plan.Progress.Done != 0 || len(plan.Stages) != 3 || len(plan.Stages[0].Tasks) != 5 || plan.NextTaskID == nil {
		t.Fatalf("invalid plan: %+v", plan)
	}
	buddyTask := plan.Stages[0].Tasks[0]
	internTask := plan.Stages[0].Tasks[1]
	if *plan.NextTaskID != buddyTask.ID || buddyTask.Materials == nil {
		t.Fatal("next step or materials mismatch")
	}
	for _, tc := range []struct {
		login, id, body string
		want            int
	}{
		{"intern_anya", buddyTask.ID, `{"status":"done","version":1}`, 403},
		{"buddy_ilya", internTask.ID, `{"status":"done","version":1}`, 403},
		{"lead_maria", internTask.ID, `{"status":"done","version":1}`, 403},
		{"intern_petr", internTask.ID, `{"status":"done","version":1}`, 404},
		{"buddy_olga", internTask.ID, `{"status":"done","version":1}`, 404},
		{"intern_anya", internTask.ID, `{"status":"done","version":0}`, 400},
		{"intern_anya", internTask.ID, `{"status":"done"}`, 400},
		{"intern_anya", internTask.ID, `{"status":"invalid","version":1}`, 400},
		{"intern_anya", internTask.ID, `{"status":"done","version":1,"assignee_id":"x"}`, 400},
		{"intern_anya", internTask.ID, `null`, 400},
		{"intern_anya", internTask.ID, `{"status":"done","version":1} {}`, 400},
		{"intern_anya", "00000000-0000-0000-0000-000000000000", `{"status":"done","version":1}`, 400},
		{"", internTask.ID, `{"status":"done","version":1}`, 401},
	} {
		w := onboardingRequest(handler, "PATCH", "/tasks/"+tc.id, tokens[tc.login], tc.body)
		if w.Code != tc.want {
			t.Fatalf("PATCH %s: %d, want %d: %s", tc.login, w.Code, tc.want, w.Body.String())
		}
	}
	w = onboardingRequest(handler, "PATCH", "/tasks/"+internTask.ID, tokens["intern_anya"], `{"status":"done","version":1}`)
	var changed onboarding.Task
	if err := json.Unmarshal(w.Body.Bytes(), &changed); err != nil || w.Code != 200 || changed.Status != "done" || changed.Version != 2 {
		t.Fatalf("update %d %s err=%v", w.Code, w.Body.String(), err)
	}
	w = onboardingRequest(handler, "PATCH", "/tasks/"+internTask.ID, tokens["intern_anya"], `{"status":"done","version":2}`)
	if w.Code != 200 {
		t.Fatal(w.Body.String())
	}
	w = onboardingRequest(handler, "PATCH", "/tasks/"+internTask.ID, tokens["intern_anya"], `{"status":"done","version":1}`)
	if w.Code != 409 || !strings.Contains(w.Body.String(), "VERSION_CONFLICT") {
		t.Fatal("stale version accepted")
	}
	var histories, events int
	if err := store.pool.QueryRow(ctx, "SELECT (SELECT count(*) FROM task_status_history WHERE task_id=$1),(SELECT count(*) FROM events WHERE task_id=$1)", internTask.ID).Scan(&histories, &events); err != nil || histories != 2 || events != 1 {
		t.Fatalf("history=%d events=%d err=%v", histories, events, err)
	}
	plan, err := store.GetPlan(ctx, anya, "")
	if err != nil || plan.Progress.Done != 1 || plan.CurrentStage != "week_1" {
		t.Fatal("saved progress not loaded", err)
	}
	w = onboardingRequest(handler, "PATCH", "/tasks/"+buddyTask.ID, tokens["buddy_ilya"], `{"status":"done","version":1}`)
	if w.Code != 200 {
		t.Fatalf("buddy own task: %s", w.Body.String())
	}
	// Совпадение команды без назначения не разрешает просмотр наставнику.
	if _, err := store.pool.Exec(ctx, "UPDATE users SET buddy_id=NULL WHERE id=$1", anya); err != nil {
		t.Fatal(err)
	}
	if got := onboardingRequest(handler, "GET", "/onboarding/plan?intern_id="+anya, tokens["buddy_ilya"], "").Code; got != 404 {
		t.Fatalf("unassigned buddy: %d", got)
	}
	if _, err := store.pool.Exec(ctx, "UPDATE onboarding_plans SET status='archived' WHERE id=$1", plan.ID); err != nil {
		t.Fatal(err)
	}
	if got := onboardingRequest(handler, "PATCH", "/tasks/"+internTask.ID, tokens["intern_anya"], `{"status":"todo","version":2}`).Code; got != 409 {
		t.Fatalf("archived plan: %d", got)
	}
	if got := onboardingRequest(handler, "GET", "/onboarding/plan", tokens["intern_anya"], "").Code; got != 404 {
		t.Fatalf("missing active plan: %d", got)
	}
	store.pool.Close()
	if _, err := store.GetPlan(ctx, anya, ""); err == nil {
		t.Fatal("unavailable database accepted")
	}
}

func TestTaskConcurrentUpdateAndAtomicEvent(t *testing.T) {
	store, handler, tokens := onboardingHandler(t)
	ctx := context.Background()
	plan, err := store.GetPlan(ctx, "10000000-0000-0000-0000-000000000001", "")
	if err != nil {
		t.Fatal(err)
	}
	task := plan.Stages[0].Tasks[1]
	codes := make(chan int, 2)
	var wg sync.WaitGroup
	for range 2 {
		wg.Go(func() {
			codes <- onboardingRequest(handler, "PATCH", "/tasks/"+task.ID, tokens["intern_anya"], `{"status":"done","version":1}`).Code
		})
	}
	wg.Wait()
	close(codes)
	counts := map[int]int{}
	for code := range codes {
		counts[code]++
	}
	if counts[200] != 1 || counts[409] != 1 {
		t.Fatalf("concurrent results %v", counts)
	}
	if _, err := store.pool.Exec(ctx, `ALTER TABLE events ADD CONSTRAINT reject_test_event CHECK (event_type <> 'task_status_changed') NOT VALID`); err != nil {
		t.Fatal(err)
	}
	w := onboardingRequest(handler, "PATCH", "/tasks/"+task.ID, tokens["intern_anya"], `{"status":"blocked","version":2}`)
	if w.Code != 503 || strings.Contains(w.Body.String(), "reject_test_event") {
		t.Fatalf("unsafe event failure: %d %s", w.Code, w.Body.String())
	}
	var status string
	var version, histories, events int
	if err := store.pool.QueryRow(ctx, `SELECT status,version,(SELECT count(*) FROM task_status_history WHERE task_id=$1),(SELECT count(*) FROM events WHERE task_id=$1) FROM tasks WHERE id=$1`, task.ID).Scan(&status, &version, &histories, &events); err != nil || status != "done" || version != 2 || histories != 2 || events != 1 {
		t.Fatalf("partial transaction: %s v%d history=%d events=%d err=%v", status, version, histories, events, err)
	}
}
