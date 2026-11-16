package database

import (
	"context"
	"encoding/json"
	"errors"
	"testing"

	"github.com/ai-buddy-hc2026/ai-buddy/backend/internal/chat"
	"github.com/ai-buddy-hc2026/ai-buddy/backend/internal/policy"
	"github.com/ai-buddy-hc2026/ai-buddy/backend/internal/toolcontract"
	"github.com/ai-buddy-hc2026/ai-buddy/backend/internal/tools"
)

const petrID = "2db7cc77-4114-52d8-a833-f670ab60e4e0"

func TestCorporateReadTools(t *testing.T) {
	s, id := toolFixture(t)
	ctx := context.Background()
	for _, tc := range []struct {
		operation policy.Operation
		args      string
		schema    string
		check     func(map[string]any) bool
	}{
		{policy.FindOwner, `{"topic":"Как получить доступы к Grafana?"}`, "FindOwnerOutput", func(d map[string]any) bool {
			return d["owner"].(map[string]any)["code"] == "oleg" && d["fallback"] == false
		}},
		{policy.FindOwner, `{"topic":"где взять пропуск"}`, "FindOwnerOutput", func(d map[string]any) bool {
			return d["owner"].(map[string]any)["code"] == "ilya" && d["fallback"] == true
		}},
		{policy.FindPlace, `{"query":"где байкал?"}`, "FindPlaceOutput", func(d map[string]any) bool {
			return d["match"].(map[string]any)["id"] == "room-baikal"
		}},
		{policy.ListSlots, `{}`, "ListSlotsOutput", func(d map[string]any) bool {
			return d["host"].(map[string]any)["code"] == "ilya" && len(d["slots"].([]any)) > 0
		}},
	} {
		t.Run(string(tc.operation), func(t *testing.T) {
			result, err := s.Call(ctx, id, tc.operation, json.RawMessage(tc.args))
			if err != nil {
				t.Fatal(err)
			}
			var data map[string]any
			raw, _ := json.Marshal(result)
			if err := json.Unmarshal(raw, &data); err != nil {
				t.Fatal(err)
			}
			if err := toolcontract.Validate(tc.schema, map[string]any{"ok": true, "data": data}); err != nil {
				t.Fatalf("schema: %v %s", err, raw)
			}
			if !tc.check(data) {
				t.Fatalf("unexpected %s", raw)
			}
		})
	}
	foreign := toolRequest(t, s, petrID)
	if _, err := s.Call(ctx, foreign, policy.ListSlots, json.RawMessage(`{"employee_code":"ilya"}`)); !errors.Is(err, tools.ErrNotFound) {
		t.Fatalf("foreign team slots: %v", err)
	}
}

func proposeCorp(t *testing.T, s *Tools, requestID string, actionType string, details any) (string, error) {
	t.Helper()
	event := chat.NewEvent(requestID, 1, "action_proposal", map[string]any{"action_type": actionType, "details": details})
	proposal, err := s.ProcessEvent(context.Background(), requestID, event)
	if err != nil {
		return "", err
	}
	var body struct {
		ActionID string `json:"action_id"`
	}
	if err := json.Unmarshal(proposal.Data, &body); err != nil {
		t.Fatal(err)
	}
	return body.ActionID, nil
}

func TestCorporateWriteToolsNeedConfirmation(t *testing.T) {
	s, _ := toolFixture(t)
	ctx := context.Background()
	var slotID string
	if err := s.pool.QueryRow(ctx, `SELECT id::text FROM calendar_slots WHERE host_code='ilya' AND starts_at>now() ORDER BY starts_at LIMIT 1`).Scan(&slotID); err != nil {
		t.Fatal(err)
	}
	for _, tc := range []struct {
		name, actionType, check string
		details                 map[string]any
	}{
		{"book slot", "calendar.book_slot", `SELECT count(*) FROM calendar_bookings WHERE slot_id=$1`, map[string]any{"slot_id": slotID, "topic": "1:1"}},
		{"request access", "access.request_access", `SELECT count(*) FROM access_requests WHERE system_code=$1`, map[string]any{"system": "gitlab"}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			raw, _ := json.Marshal(tc.details)
			if _, err := s.pool.Exec(ctx, `UPDATE chat_requests SET status='done',last_seq=1,terminal_seq=1,finished_at=now() WHERE status NOT IN ('done','failed','cancelled')`); err != nil {
				t.Fatal(err)
			}
			direct := toolRequest(t, s, chatAnya)
			if _, err := s.Call(ctx, direct, policy.Operation(tc.actionType), raw); !errors.Is(err, tools.ErrConfirmation) {
				t.Fatalf("direct write: %v", err)
			}
			key := tc.details["slot_id"]
			if key == nil {
				key = tc.details["system"]
			}
			var count int
			if err := s.pool.QueryRow(ctx, tc.check, key).Scan(&count); err != nil || count != 0 {
				t.Fatalf("executed before confirm: %d %v", count, err)
			}
			if _, err := s.pool.Exec(ctx, `UPDATE chat_requests SET status='done',last_seq=1,terminal_seq=1,finished_at=now() WHERE status NOT IN ('done','failed','cancelled')`); err != nil {
				t.Fatal(err)
			}
			request := toolRequest(t, s, chatAnya)
			actionID, err := proposeCorp(t, s, request, tc.actionType, tc.details)
			if err != nil {
				t.Fatal(err)
			}
			action, err := s.Confirm(ctx, chatAnya, actionID)
			if err != nil || action.Status != "succeeded" {
				t.Fatalf("confirm: %+v %v", action, err)
			}
			if err := s.pool.QueryRow(ctx, tc.check, key).Scan(&count); err != nil || count != 1 {
				t.Fatalf("not executed: %d %v", count, err)
			}
			if _, err := s.pool.Exec(ctx, `UPDATE chat_requests SET status='done',last_seq=1,terminal_seq=1,finished_at=now() WHERE id=$1`, request); err != nil {
				t.Fatal(err)
			}
			// Повтор после успеха: слот занят, доступ уже запрошен.
			if _, err := proposeCorp(t, s, toolRequest(t, s, chatAnya), tc.actionType, tc.details); !errors.Is(err, tools.ErrBusinessConflict) {
				t.Fatalf("second proposal: %v", err)
			}
		})
	}
}
