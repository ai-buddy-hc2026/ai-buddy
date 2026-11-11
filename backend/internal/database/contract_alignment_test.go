package database

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"testing/fstest"
	"time"

	"github.com/ai-buddy-hc2026/ai-buddy/backend/internal/activity"
	"github.com/ai-buddy-hc2026/ai-buddy/backend/internal/auth"
	"github.com/ai-buddy-hc2026/ai-buddy/backend/internal/chat"
	"github.com/ai-buddy-hc2026/ai-buddy/backend/internal/httpapi"
	"github.com/ai-buddy-hc2026/ai-buddy/backend/internal/mcpserver"
	"github.com/ai-buddy-hc2026/ai-buddy/backend/internal/policy"
	"github.com/ai-buddy-hc2026/ai-buddy/backend/internal/toolcontract"
	"github.com/ai-buddy-hc2026/ai-buddy/backend/internal/tools"
)

func rpcRequest(t *testing.T, handler http.Handler, requestID, method string, params any) (int, map[string]any) {
	t.Helper()
	body, _ := json.Marshal(map[string]any{"jsonrpc": "2.0", "id": 1, "method": method, "params": params})
	r := httptest.NewRequest("POST", "http://localhost/mcp", strings.NewReader(string(body)))
	r.Header.Set("Authorization", "Bearer synthetic-mcp-service-token-32-characters")
	r.Header.Set("X-Request-ID", requestID)
	r.Header.Set("MCP-Protocol-Version", mcpserver.ProtocolVersion)
	r.Header.Set("Content-Type", "application/json")
	r.Header.Set("Accept", "application/json, text/event-stream")
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, r)
	var result map[string]any
	if err := json.Unmarshal(w.Body.Bytes(), &result); err != nil {
		t.Fatalf("%d: %s", w.Code, w.Body.String())
	}
	return w.Code, result
}

func TestOriginalMCPProfile(t *testing.T) {
	s, id := toolFixture(t)
	handler, err := mcpserver.New(s, "synthetic-mcp-service-token-32-characters")
	if err != nil {
		t.Fatal(err)
	}
	for _, tc := range []struct {
		actor, request string
		count          int
	}{
		{chatAnya, id, 5}, {"10000000-0000-0000-0000-000000000002", "", 6}, {"10000000-0000-0000-0000-000000000003", "", 6},
	} {
		requestID := tc.request
		if requestID == "" {
			requestID = toolRequest(t, s, tc.actor)
		}
		status, response := rpcRequest(t, handler, requestID, "tools/list", map[string]any{})
		if status != 200 {
			t.Fatal(response)
		}
		toolsList := response["result"].(map[string]any)["tools"].([]any)
		if len(toolsList) != tc.count {
			t.Fatalf("tools=%d expected=%d", len(toolsList), tc.count)
		}
		for _, tool := range toolsList {
			d := tool.(map[string]any)
			if d["inputSchema"] == nil || d["outputSchema"] == nil {
				t.Fatal("missing schema", d["name"])
			}
		}
	}
	for _, tc := range []struct {
		name   string
		args   any
		schema string
	}{
		{"employees.get_manager", map[string]any{}, "GetManagerOutput"}, {"checklist.get_plan", map[string]any{}, "GetPlanOutput"}, {"absences.get_policy", map[string]any{}, "GetPolicyOutput"},
		{"absences.create_request", map[string]any{"date": time.Now().AddDate(0, 0, 30).Format(time.DateOnly), "type": "day_off"}, "Failure"},
		{"absences.list_for_employee", map[string]any{}, "Failure"},
	} {
		_, response := rpcRequest(t, handler, id, "tools/call", map[string]any{"name": tc.name, "arguments": tc.args})
		result, ok := response["result"].(map[string]any)
		if !ok {
			t.Fatal(response)
		}
		if err := toolcontract.Validate(tc.schema, result["structuredContent"]); err != nil {
			t.Fatalf("%s: %v %+v", tc.name, err, result)
		}
	}
	_, response := rpcRequest(t, handler, id, "tools/call", map[string]any{"name": "absences.create_request", "arguments": map[string]any{"date": "2026-02-30", "type": "day_off"}})
	if response["error"].(map[string]any)["code"] != float64(-32602) {
		t.Fatal(response)
	}
	_, response = rpcRequest(t, handler, id, "tools/call", map[string]any{"name": "unknown", "arguments": map[string]any{}})
	if response["error"].(map[string]any)["data"].(map[string]any)["code"] != "UNKNOWN_TOOL" {
		t.Fatal(response)
	}
	status, _ := rpcRequest(t, handler, "90000000-0000-0000-0000-000000000001", "tools/list", map[string]any{})
	if status != 404 {
		t.Fatal(status)
	}
	finishChat(t, NewChat(s.pool), id, "Готово")
	status, _ = rpcRequest(t, handler, id, "tools/list", map[string]any{})
	if status != 410 {
		t.Fatal(status)
	}
}

func TestProposalConfirmationAndHistory(t *testing.T) {
	s, id := toolFixture(t)
	ctx := context.Background()
	raw := map[string]any{"action_type": "absences.create_request", "details": map[string]any{"date": time.Now().AddDate(0, 0, 30).Format(time.DateOnly), "type": "day_off"}}
	event := chat.NewEvent(id, 1, "action_proposal", raw)
	proposal, err := s.ProcessEvent(ctx, id, event)
	if err != nil {
		t.Fatal(err)
	}
	again, err := s.ProcessEvent(ctx, id, event)
	if err != nil || string(again.Data) != string(proposal.Data) {
		t.Fatalf("proposal retry: %v", err)
	}
	var body struct {
		ActionID string `json:"action_id"`
	}
	if err := json.Unmarshal(proposal.Data, &body); err != nil {
		t.Fatal(err)
	}
	var count int
	if err := s.pool.QueryRow(ctx, "SELECT count(*) FROM absence_requests").Scan(&count); err != nil || count != 0 {
		t.Fatal("proposal executed", err)
	}
	empty := ""
	if err := NewChat(s.pool).Finish(ctx, id, chat.NewEvent(id, 2, "done", chat.Done{FullText: &empty, Sources: []json.RawMessage{}})); err != nil {
		t.Fatal(err)
	}
	authService, err := auth.New(NewUsers(s.pool), []byte("synthetic-test-key-of-at-least-32-bytes"), time.Hour)
	if err != nil {
		t.Fatal(err)
	}
	login, err := authService.Login(ctx, "intern_anya")
	if err != nil {
		t.Fatal(err)
	}
	base := httpapi.NewHandler(slog.New(slog.NewJSONHandler(io.Discard, nil)), authService, NewOnboarding(s.pool))
	handler := httpapi.WithConfirmation(base, authService, s)
	if w := onboardingRequest(handler, "POST", "/actions/"+body.ActionID+"/confirm", login.AccessToken, `{}`); w.Code != 400 {
		t.Fatal("confirm accepted body", w.Code)
	}
	var wg sync.WaitGroup
	for range 8 {
		wg.Go(func() {
			w := onboardingRequest(handler, "POST", "/actions/"+body.ActionID+"/confirm", login.AccessToken, "")
			if w.Code != 200 {
				t.Errorf("confirm: %d %s", w.Code, w.Body.String())
			}
		})
	}
	wg.Wait()
	var attempts, proposed, confirmed int
	if err := s.pool.QueryRow(ctx, `SELECT attempt_count,(SELECT count(*) FROM events WHERE event_type='action_proposed'),(SELECT count(*) FROM events WHERE event_type='action_confirmed') FROM actions_log WHERE id=$1`, body.ActionID).Scan(&attempts, &proposed, &confirmed); err != nil || attempts != 1 || proposed != 1 || confirmed != 1 {
		t.Fatalf("attempts=%d events=%d/%d err=%v", attempts, proposed, confirmed, err)
	}
	history, err := NewChat(s.pool).History(ctx, chatAnya, "", "", 50)
	if err != nil || len(history.Items) != 1 || len(history.Items[0].Actions) != 1 {
		t.Fatalf("history missing action: %v", err)
	}
	var action activity.Action
	if err := json.Unmarshal(history.Items[0].Actions[0], &action); err != nil {
		t.Fatal(err)
	}
	if action.Status != "succeeded" {
		t.Fatal(action.Status)
	}
	if err := toolcontract.Validate("CreateAbsenceData", json.RawMessage(action.Result)); err != nil {
		t.Fatal(err)
	}
}

func TestPythonSDKWithGo(t *testing.T) {
	python := os.Getenv("MCP_PYTHON")
	if python == "" {
		t.Skip("MCP_PYTHON is not set")
	}
	s, id := toolFixture(t)
	handler, err := mcpserver.New(s, "synthetic-mcp-service-token-32-characters")
	if err != nil {
		t.Fatal(err)
	}
	server := httptest.NewServer(handler)
	defer server.Close()
	dir := t.TempDir()
	script := fmt.Sprintf(`import asyncio,json
import httpx2
from mcp import ClientSession,types
from mcp.client.streamable_http import streamable_http_client
async def main():
 headers={"Authorization":"Bearer synthetic-mcp-service-token-32-characters","X-Request-ID":%q,"MCP-Protocol-Version":"2025-06-18"}
 async with httpx2.AsyncClient(headers=headers,timeout=10) as http:
  async with streamable_http_client(%q,http_client=http) as (read,write):
   async with ClientSession(read,write) as session:
    init=await session.send_request(types.InitializeRequest(params=types.InitializeRequestParams(protocolVersion="2025-06-18",capabilities=types.ClientCapabilities(),clientInfo=types.Implementation(name="contract-test",version="1"))),types.InitializeResult)
    assert init.protocol_version=="2025-06-18"
    session.adopt(init)
    await session.send_notification(types.InitializedNotification())
    listed=await session.list_tools()
    assert len(listed.tools)==5
    for tool in listed.tools: assert tool.input_schema and tool.output_schema
    for name,args in [("employees.get_manager",{}),("checklist.get_plan",{}),("absences.get_policy",{}),("absences.create_request",{"date":"2030-01-01","type":"day_off"})]:
     result=await session.call_tool(name,args)
     body=result.structured_content
     assert json.loads(result.content[0].text)==body
     if name=="employees.get_manager": assert body["data"]["manager"]["id"]=="10000000-0000-0000-0000-000000000002"
     if name=="checklist.get_plan": assert len(body["data"]["tasks"])==15
     if name=="absences.get_policy": assert body["data"]["notice_period_days"]==3
     if name=="absences.create_request": assert result.is_error and body["error"]["code"]=="CONFIRMATION_REQUIRED"
 print("Python MCP SDK 2.3.0: initialize/list/read/write-denial OK")
asyncio.run(main())
`, id, server.URL)
	scriptPath := filepath.Join(dir, "check.py")
	if err := os.WriteFile(scriptPath, []byte(script), 0600); err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()
	output, err := exec.CommandContext(ctx, python, scriptPath).CombinedOutput()
	if err != nil {
		t.Fatalf("Python compatibility: %v\n%s", err, output)
	}
	t.Log(string(output))
}

func TestLegacyContractMigration(t *testing.T) {
	pool := testPool(t)
	ctx := context.Background()
	old := fstest.MapFS{}
	if err := fs.WalkDir(scripts, ".", func(path string, d fs.DirEntry, err error) error {
		if err != nil || d.IsDir() || path == "migrations/0007_contract_alignment.sql" {
			return err
		}
		data, err := fs.ReadFile(scripts, path)
		old[path] = &fstest.MapFile{Data: data}
		return err
	}); err != nil {
		t.Fatal(err)
	}
	tx, err := pool.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer rollbackOnboarding(tx)
	if err := migrate(ctx, tx, old); err != nil {
		t.Fatal(err)
	}
	seed, _ := fs.ReadFile(scripts, "seeds/users.sql")
	if _, err := tx.Exec(ctx, string(seed)); err != nil {
		t.Fatal(err)
	}
	if err := seedChecklist(ctx, tx, checklistFixture(t)); err != nil {
		t.Fatal(err)
	}
	if err := tx.Commit(ctx); err != nil {
		t.Fatal(err)
	}
	s, err := NewTools(pool, 0)
	if err != nil {
		t.Fatal(err)
	}
	id := toolRequest(t, s, chatAnya)
	params := absenceParams()
	params.Type = "отгул"
	actionID := toolActionFixture(t, s, id, policy.CreateAbsence, params, true)
	if _, err := pool.Exec(ctx, `INSERT INTO absence_requests(team_id,employee_id,action_id,idempotency_key,absence_date,absence_type,approver_id) SELECT team_id,actor_id,id,idempotency_key,$2,'отгул',$3 FROM actions_log WHERE id=$1`, actionID, params.Date, params.Approver); err != nil {
		t.Fatal(err)
	}
	if _, err := pool.Exec(ctx, `UPDATE actions_log SET status='succeeded',attempt_count=1,started_at=now(),finished_at=now(),result=jsonb_build_object('id','ABS-0001','status','pending_approval','approver',$2::text) WHERE id=$1`, actionID, params.Approver); err != nil {
		t.Fatal(err)
	}
	var key string
	if err := pool.QueryRow(ctx, "SELECT idempotency_key::text FROM actions_log WHERE id=$1", actionID).Scan(&key); err != nil {
		t.Fatal(err)
	}
	var taskID string
	var version int
	if err := pool.QueryRow(ctx, "SELECT id::text,version FROM tasks WHERE assignee_id=$1 ORDER BY id LIMIT 1", chatAnya).Scan(&taskID, &version); err != nil {
		t.Fatal(err)
	}
	taskAction := toolActionFixture(t, s, id, policy.UpdateStatus, tools.TaskParameters{TaskID: taskID, Status: "todo", Version: version}, true)
	if _, err := pool.Exec(ctx, `UPDATE actions_log SET status='succeeded',attempt_count=1,started_at=now(),finished_at=now(),result=(SELECT to_jsonb(t) FROM tasks t WHERE t.id=$2) WHERE id=$1`, taskAction, taskID); err != nil {
		t.Fatal(err)
	}
	if err := Prepare(ctx, pool, "../../../seed/checklist.json"); err != nil {
		t.Fatal(err)
	}
	var stable bool
	var result json.RawMessage
	if err := pool.QueryRow(ctx, `SELECT idempotency_key::text=$2 AND status='succeeded' AND attempt_count=1 AND parameters->>'type'='day_off',result FROM actions_log WHERE id=$1`, actionID, key).Scan(&stable, &result); err != nil || !stable {
		t.Fatalf("migration changed identity/state: %v", err)
	}
	if err := toolcontract.Validate("CreateAbsenceData", result); err != nil {
		t.Fatal(err)
	}
	if err := pool.QueryRow(ctx, "SELECT result FROM actions_log WHERE id=$1", taskAction).Scan(&result); err != nil {
		t.Fatal(err)
	}
	if err := toolcontract.Validate("UpdateStatusData", result); err != nil {
		t.Fatal(err)
	}
	if _, err := pool.Exec(ctx, "UPDATE actions_log SET parameters='{}' WHERE id=$1", actionID); err == nil {
		t.Fatal("immutable trigger disabled")
	}
}

func TestConfirmationFailureDoesNotBypassPolicy(t *testing.T) {
	s, id := toolFixture(t)
	ctx := context.Background()
	actionID := toolActionFixture(t, s, id, policy.CreateAbsence, absenceParams(), false)
	s.failureRate = 1
	failed, err := s.Confirm(ctx, chatAnya, actionID)
	if err != nil || failed.Status != "failed" || failed.LastError.Code != "DEPENDENCY_UNAVAILABLE" {
		t.Fatalf("failed action: %+v %v", failed, err)
	}
	if _, err := s.pool.Exec(ctx, "UPDATE users SET active=false WHERE id=$1", chatAnya); err != nil {
		t.Fatal(err)
	}
	if _, err := s.Confirm(ctx, chatAnya, actionID); !errors.Is(err, auth.ErrUnauthorized) {
		t.Fatalf("failed state bypassed policy: %v", err)
	}
}

func TestAbsenceListScopeAndCursor(t *testing.T) {
	s, id := toolFixture(t)
	ctx := context.Background()
	for range 2 {
		actionID := toolActionFixture(t, s, id, policy.CreateAbsence, absenceParams(), false)
		if _, err := s.Confirm(ctx, chatAnya, actionID); err != nil {
			t.Fatal(err)
		}
	}
	buddy := toolRequest(t, s, "10000000-0000-0000-0000-000000000002")
	lead := toolRequest(t, s, "10000000-0000-0000-0000-000000000003")
	value, err := s.Call(ctx, buddy, policy.ListAbsences, json.RawMessage(`{"limit":1}`))
	if err != nil {
		t.Fatal(err)
	}
	raw, _ := json.Marshal(value)
	if err := toolcontract.Validate("ListAbsencesData", json.RawMessage(raw)); err != nil {
		t.Fatal(err)
	}
	var page struct {
		Items  []tools.Absence `json:"items"`
		Cursor *string         `json:"next_cursor"`
	}
	if err := json.Unmarshal(raw, &page); err != nil || len(page.Items) != 1 || page.Cursor == nil {
		t.Fatal(string(raw), err)
	}
	cursorArgs, _ := json.Marshal(map[string]any{"cursor": *page.Cursor, "limit": 1})
	if _, err := s.Call(ctx, lead, policy.ListAbsences, cursorArgs); !errors.Is(err, tools.ErrInvalid) {
		t.Fatal("cursor crossed actor/role", err)
	}
	next, err := s.Call(ctx, buddy, policy.ListAbsences, cursorArgs)
	if err != nil {
		t.Fatal(err)
	}
	encoded, _ := json.Marshal(next)
	var second struct {
		Items []tools.Absence `json:"items"`
	}
	if json.Unmarshal(encoded, &second) != nil || len(second.Items) != 1 || second.Items[0].ID == page.Items[0].ID {
		t.Fatal("unstable pagination")
	}
	if _, err := s.pool.Exec(ctx, "UPDATE users SET buddy_id=NULL WHERE id=$1", chatAnya); err != nil {
		t.Fatal(err)
	}
	value, err = s.Call(ctx, buddy, policy.ListAbsences, json.RawMessage(`{}`))
	if err != nil {
		t.Fatal(err)
	}
	raw, _ = json.Marshal(value)
	if json.Unmarshal(raw, &second) != nil || len(second.Items) != 0 {
		t.Fatal("revoked assignment still visible")
	}
	value, err = s.Call(ctx, lead, policy.ListAbsences, json.RawMessage(`{}`))
	if err != nil {
		t.Fatal(err)
	}
	raw, _ = json.Marshal(value)
	if json.Unmarshal(raw, &second) != nil || len(second.Items) != 2 {
		t.Fatal("lead lost team scope")
	}
}
