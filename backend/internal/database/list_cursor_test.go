package database

import (
	"encoding/json"
	"strings"
	"testing"
	"time"
)

func TestListCursorBinding(t *testing.T) {
	s := &Listings{cursorKey: [32]byte{1, 2, 3}}
	scope := listScope{Kind: "actions", Actor: chatAnya, Team: "team", Status: "proposed", Conversation: "conversation"}
	id := "50000000-0000-0000-0000-000000000001"
	cursor := s.encodeCursor(scope, id, time.Now())
	if parsed, err := s.decodeCursor(cursor, scope); err != nil || parsed.ID != id {
		t.Fatal(err)
	}
	for _, change := range []func(*listScope){
		func(s *listScope) { s.Actor = "other" }, func(s *listScope) { s.Team = "other" }, func(s *listScope) { s.Kind = "interns" }, func(s *listScope) { s.Status = "succeeded" }, func(s *listScope) { s.Conversation = "other" },
	} {
		other := scope
		change(&other)
		if _, err := s.decodeCursor(cursor, other); err == nil {
			t.Fatal("cursor used with different scope")
		}
	}
	for _, raw := range []string{"", cursor + "x", "broken", strings.Repeat("a", 2049)} {
		if _, err := s.decodeCursor(raw, scope); err == nil {
			t.Fatal("invalid cursor accepted")
		}
	}
}

func TestActionPublicFields(t *testing.T) {
	details, result, err := actionPublicFields("absences.create_request", json.RawMessage(`{"date":"2026-11-12","type":"отгул","approver":"person","idempotency_key":"secret","token":"secret"}`), json.RawMessage(`{"id":"ABS-0001","status":"pending_approval","trace":"secret"}`))
	if err != nil || strings.Contains(string(details), "secret") || strings.Contains(string(result), "secret") {
		t.Fatalf("unsafe fields %s %s %v", details, result, err)
	}
}
