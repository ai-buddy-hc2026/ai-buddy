package database

import (
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/ai-buddy-hc2026/ai-buddy/backend/internal/activity"
	"github.com/ai-buddy-hc2026/ai-buddy/backend/internal/auth"
	"github.com/ai-buddy-hc2026/ai-buddy/backend/internal/httpapi"
	"github.com/ai-buddy-hc2026/ai-buddy/backend/internal/policy"
)

func listingFixture(t *testing.T) (*Tools, string, http.Handler, map[string]string) {
	t.Helper()
	s, requestID := toolFixture(t)
	key := []byte("synthetic-test-key-of-at-least-32-bytes")
	service, err := auth.New(NewUsers(s.pool), key, time.Hour)
	if err != nil {
		t.Fatal(err)
	}
	listings, err := NewListings(s.pool, key)
	if err != nil {
		t.Fatal(err)
	}
	base := httpapi.NewHandler(slog.New(slog.NewJSONHandler(io.Discard, nil)), service, NewOnboarding(s.pool))
	handler := httpapi.WithListings(base, service, listings)
	tokens := make(map[string]string)
	for _, login := range []string{"intern_anya", "intern_petr", "buddy_ilya", "buddy_olga", "lead_maria"} {
		result, err := service.Login(context.Background(), login)
		if err != nil {
			t.Fatal(err)
		}
		tokens[login] = result.AccessToken
	}
	return s, requestID, handler, tokens
}

func TestBuddyInternsHTTPAndPagination(t *testing.T) {
	s, _, handler, tokens := listingFixture(t)
	ctx := context.Background()
	if _, err := s.pool.Exec(ctx, `INSERT INTO users(id,team_id,login,display_name,role,buddy_id,manager_id) VALUES
 ('10000000-0000-0000-0000-000000000010','4496e76d-35da-5cf7-a3d5-c9a89d88c5a2','intern_test_1','Test 1','intern','4a59a828-3b1a-55e4-bf9b-81db5ad6183a','10000000-0000-0000-0000-000000000003'),
 ('10000000-0000-0000-0000-000000000011','4496e76d-35da-5cf7-a3d5-c9a89d88c5a2','intern_test_2','Test 2','intern','4a59a828-3b1a-55e4-bf9b-81db5ad6183a','10000000-0000-0000-0000-000000000003')`); err != nil {
		t.Fatal(err)
	}
	cursor := ""
	seen := make(map[string]bool)
	for range 3 {
		path := "/buddy/interns?limit=1"
		if cursor != "" {
			path += "&cursor=" + cursor
		}
		w := onboardingRequest(handler, "GET", path, tokens["buddy_ilya"], "")
		var page activity.InternPage
		if w.Code != 200 || json.Unmarshal(w.Body.Bytes(), &page) != nil || len(page.Items) != 1 {
			t.Fatalf("%d %s", w.Code, w.Body.String())
		}
		if page.Items[0].Team.ID != "4496e76d-35da-5cf7-a3d5-c9a89d88c5a2" || seen[page.Items[0].ID] {
			t.Fatal("wrong intern page")
		}
		seen[page.Items[0].ID] = true
		if w.Header().Get("Cache-Control") != "no-store" {
			t.Fatal("list can be cached")
		}
		if page.NextCursor == nil {
			cursor = ""
		} else {
			cursor = *page.NextCursor
		}
	}
	if cursor != "" || len(seen) != 3 {
		t.Fatal("invalid pagination")
	}
	first := onboardingRequest(handler, "GET", "/buddy/interns?limit=1", tokens["buddy_ilya"], "")
	var page activity.InternPage
	if err := json.Unmarshal(first.Body.Bytes(), &page); err != nil {
		t.Fatal(err)
	}
	cursor = *page.NextCursor
	for _, tc := range []struct {
		path, login string
		status      int
	}{
		{"/buddy/interns", "", 401}, {"/buddy/interns", "intern_anya", 403}, {"/buddy/interns", "lead_maria", 403},
		{"/buddy/interns?cursor=" + cursor, "buddy_olga", 400}, {"/buddy/interns?cursor=" + cursor + "x", "buddy_ilya", 400},
		{"/actions?cursor=" + cursor, "buddy_ilya", 400}, {"/buddy/interns?team_id=other", "buddy_ilya", 400},
	} {
		w := onboardingRequest(handler, "GET", tc.path, tokens[tc.login], "")
		if w.Code != tc.status {
			t.Fatalf("%s %s: %d %s", tc.login, tc.path, w.Code, w.Body.String())
		}
	}
	if _, err := s.pool.Exec(ctx, `UPDATE users SET buddy_id=NULL WHERE login IN ('intern_test_1','intern_anya'); UPDATE users SET active=false WHERE login='intern_test_2'`); err != nil {
		t.Fatal(err)
	}
	w := onboardingRequest(handler, "GET", "/buddy/interns?cursor="+cursor, tokens["buddy_ilya"], "")
	if w.Code != 200 || json.Unmarshal(w.Body.Bytes(), &page) != nil || len(page.Items) != 0 {
		t.Fatal("revoked interns visible", w.Body.String())
	}
	if _, err := s.pool.Exec(ctx, `UPDATE users SET role='lead' WHERE login='buddy_ilya'`); err != nil {
		t.Fatal(err)
	}
	if got := onboardingRequest(handler, "GET", "/buddy/interns", tokens["buddy_ilya"], "").Code; got != 403 {
		t.Fatal("old JWT retained buddy rights", got)
	}
}

func TestActionsHTTPFiltersAndIsolation(t *testing.T) {
	s, requestID, handler, tokens := listingFixture(t)
	ctx := context.Background()
	for _, kind := range []policy.Operation{policy.CreateAbsence, policy.UpdateStatus, policy.CreateEscalation} {
		toolActionFixture(t, s, requestID, kind, map[string]any{"question": "Тест", "date": "2026-11-12", "internal_token": "synthetic-secret"}, false)
	}
	failedID := toolActionFixture(t, s, requestID, policy.CreateAbsence, absenceParams(), true)
	s.failureRate = 1
	if _, err := callAction(s, requestID, policy.CreateAbsence, failedID); err == nil {
		t.Fatal("failure mode ignored")
	}
	if _, err := s.pool.Exec(ctx, `UPDATE actions_log SET last_error='{"code":"INTERNAL","message":"synthetic-secret"}' WHERE id=$1`, failedID); err != nil {
		t.Fatal(err)
	}
	if _, err := s.pool.Exec(ctx, `UPDATE actions_log SET created_at='2026-11-11T00:00:00Z'`); err != nil {
		t.Fatal(err)
	}
	var conversationID string
	if err := s.pool.QueryRow(ctx, `SELECT conversation_id::text FROM chat_requests WHERE id=$1`, requestID).Scan(&conversationID); err != nil {
		t.Fatal(err)
	}
	cursor := ""
	seen := make(map[string]bool)
	for range 2 {
		path := "/actions?limit=2&conversation_id=" + conversationID
		if cursor != "" {
			path += "&cursor=" + cursor
		}
		w := onboardingRequest(handler, "GET", path, tokens["intern_anya"], "")
		var page activity.ActionPage
		if w.Code != 200 || json.Unmarshal(w.Body.Bytes(), &page) != nil || len(page.Items) != 2 {
			t.Fatalf("%d %s", w.Code, w.Body.String())
		}
		if strings.Contains(w.Body.String(), "synthetic-secret") || strings.Contains(w.Body.String(), "idempotency_key") {
			t.Fatal("private action fields leaked", w.Body.String())
		}
		for _, a := range page.Items {
			if seen[a.ID] {
				t.Fatal("duplicate page item")
			}
			seen[a.ID] = true
		}
		if page.NextCursor == nil {
			cursor = ""
		} else {
			cursor = *page.NextCursor
		}
	}
	if len(seen) != 4 || cursor != "" {
		t.Fatal("incorrect action pages")
	}
	for _, tc := range []struct {
		path, login   string
		status, count int
	}{
		{"/actions?status=proposed", "intern_anya", 200, 3}, {"/actions?status=failed", "intern_anya", 200, 1},
		{"/actions", "buddy_ilya", 200, 0}, {"/actions", "lead_maria", 200, 0}, {"/actions", "", 401, 0},
		{"/actions?conversation_id=" + conversationID, "intern_petr", 404, 0},
		{"/actions?conversation_id=90000000-0000-0000-0000-000000000001", "intern_petr", 404, 0},
		{"/actions?status=bad", "intern_anya", 400, 0}, {"/actions?actor_id=" + chatAnya, "buddy_ilya", 400, 0},
	} {
		w := onboardingRequest(handler, "GET", tc.path, tokens[tc.login], "")
		if w.Code != tc.status {
			t.Fatalf("%s %s: %d %s", tc.login, tc.path, w.Code, w.Body.String())
		}
		if tc.status == 200 {
			var page activity.ActionPage
			if err := json.Unmarshal(w.Body.Bytes(), &page); err != nil || len(page.Items) != tc.count {
				t.Fatalf("%s: %s %v", tc.path, w.Body.String(), err)
			}
		}
	}
	w := onboardingRequest(handler, "GET", "/actions?limit=1&status=proposed", tokens["intern_anya"], "")
	var page activity.ActionPage
	if err := json.Unmarshal(w.Body.Bytes(), &page); err != nil || page.NextCursor == nil {
		t.Fatalf("no cursor: %s %v", w.Body.String(), err)
	}
	for _, tc := range []struct{ path, login string }{
		{"/actions?status=failed&cursor=" + *page.NextCursor, "intern_anya"},
		{"/actions?status=proposed&cursor=" + *page.NextCursor, "buddy_ilya"},
		{"/actions?status=proposed&conversation_id=" + conversationID + "&cursor=" + *page.NextCursor, "intern_anya"},
	} {
		if got := onboardingRequest(handler, "GET", tc.path, tokens[tc.login], "").Code; got != 400 {
			t.Fatalf("cursor scope bypassed: %d", got)
		}
	}
}
