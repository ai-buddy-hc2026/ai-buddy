package database

import (
	"context"
	"encoding/json"

	"github.com/ai-buddy-hc2026/ai-buddy/backend/internal/mocks"
	"github.com/ai-buddy-hc2026/ai-buddy/backend/internal/policy"
	"github.com/ai-buddy-hc2026/ai-buddy/backend/internal/tools"
	"github.com/jackc/pgx/v5"
)

// MCP-инструменты моков корпоративных систем (WP-B). Права проверены в Call.

type listSlotsInput struct {
	EmployeeCode string `json:"employee_code,omitempty"`
}
type bookSlotInput struct {
	SlotID string `json:"slot_id"`
	Topic  string `json:"topic,omitempty"`
}
type findOwnerInput struct {
	Topic string `json:"topic"`
}
type requestAccessInput struct {
	System string `json:"system"`
}
type findPlaceInput struct {
	Query string `json:"query"`
}

func (s *Tools) corpRead(ctx context.Context, tx pgx.Tx, actor planActor, operation policy.Operation, raw json.RawMessage) (any, error) {
	switch operation {
	case policy.ListSlots:
		var input listSlotsInput
		if tools.Decode(raw, &input) != nil {
			return nil, tools.ErrInvalid
		}
		return s.listSlots(ctx, tx, actor, input.EmployeeCode)
	case policy.FindOwner:
		var input findOwnerInput
		if tools.Decode(raw, &input) != nil {
			return nil, tools.ErrInvalid
		}
		return findOwner(ctx, tx, actor, input.Topic)
	case policy.FindPlace:
		var input findPlaceInput
		if tools.Decode(raw, &input) != nil {
			return nil, tools.ErrInvalid
		}
		return findPlace(ctx, tx, input.Query)
	}
	return nil, tools.ErrDenied
}

func (s *Tools) listSlots(ctx context.Context, tx pgx.Tx, actor planActor, code string) (any, error) {
	if code == "" {
		mentor, err := mocks.MentorCode(ctx, tx, actor.id)
		if err != nil {
			return nil, err
		}
		if mentor == "" {
			return nil, tools.ErrNotFound
		}
		code = mentor
	}
	host, slots, err := mocks.FreeSlots(ctx, tx, actor.teamID, code, s.now())
	if err != nil {
		return nil, err
	}
	items := make([]map[string]any, 0, len(slots))
	for _, slot := range slots {
		items = append(items, map[string]any{"slot_id": slot.ID, "starts_at": slot.StartsAt, "minutes": slot.Minutes})
	}
	return map[string]any{"host": map[string]any{"code": host.Code, "name": host.Name, "title": host.Title}, "slots": items}, nil
}

func findOwner(ctx context.Context, tx pgx.Tx, actor planActor, topic string) (any, error) {
	team, err := mocks.TeamEmployees(ctx, tx, actor.teamID)
	if err != nil {
		return nil, err
	}
	mentor, err := mocks.MentorCode(ctx, tx, actor.id)
	if err != nil {
		return nil, err
	}
	match := mocks.MatchOwner(topic, team, mentor)
	var owner any
	if match.Owner != nil {
		owner = map[string]any{"code": match.Owner.Code, "name": match.Owner.Name, "title": match.Owner.Title, "ask_about": match.Owner.AskAbout}
	}
	return map[string]any{"owner": owner, "matched_tag": match.MatchedTag, "fallback": match.Fallback}, nil
}

func findPlace(ctx context.Context, tx pgx.Tx, query string) (any, error) {
	places, err := mocks.Places(ctx, tx)
	if err != nil {
		return nil, err
	}
	match, similar := mocks.FindPlace(query, places)
	view := func(p mocks.Place) map[string]any {
		return map[string]any{"id": p.ID, "name": p.Name, "kind": p.Kind, "floor": p.Floor, "node_id": p.NodeID, "employee_code": p.EmployeeCode}
	}
	var matched any
	if match != nil {
		matched = view(*match)
	}
	items := make([]map[string]any, 0, len(similar))
	for _, place := range similar {
		items = append(items, view(place))
	}
	return map[string]any{"match": matched, "similar": items}, nil
}

// prepareCorpAction проверяет запись до показа карточки подтверждения.
// В actions_log сохраняются только аргументы модели: повтор события сравнивает их.
func (s *Tools) prepareCorpAction(ctx context.Context, tx pgx.Tx, actor planActor, operation policy.Operation, raw json.RawMessage) (json.RawMessage, error) {
	switch operation {
	case policy.BookSlot:
		var p bookSlotInput
		if tools.Decode(raw, &p) != nil {
			return nil, tools.ErrInvalid
		}
		if _, err := mocks.CheckSlot(ctx, tx, actor.teamID, p.SlotID, s.now()); err != nil {
			return nil, err
		}
		return json.Marshal(p)
	case policy.RequestAccess:
		var p requestAccessInput
		if tools.Decode(raw, &p) != nil {
			return nil, tools.ErrInvalid
		}
		if err := mocks.CheckAccess(ctx, tx, actor.id, actor.role, p.System); err != nil {
			return nil, err
		}
		return json.Marshal(p)
	}
	return nil, tools.ErrDenied
}

// executeCorpAction выполняет подтвержденную запись; action_id - ключ идемпотентности.
func (s *Tools) executeCorpAction(ctx context.Context, tx pgx.Tx, actor planActor, operation policy.Operation, actionID string, action toolAction) (any, error) {
	switch operation {
	case policy.BookSlot:
		var p bookSlotInput
		if err := tools.Decode(action.parameters, &p); err != nil {
			return nil, err
		}
		booking, err := mocks.Book(ctx, tx, actor.teamID, p.SlotID, actor.id, p.Topic, &actionID, s.now())
		if err != nil {
			return nil, err
		}
		return map[string]any{"action_id": actionID, "booking_id": booking.ID, "slot_id": booking.SlotID, "host_code": booking.HostCode, "starts_at": booking.StartsAt}, nil
	case policy.RequestAccess:
		var p requestAccessInput
		if err := tools.Decode(action.parameters, &p); err != nil {
			return nil, err
		}
		item, err := mocks.RequestAccess(ctx, tx, actor.id, actor.role, p.System, &actionID, s.now())
		if err != nil {
			return nil, err
		}
		return map[string]any{"action_id": actionID, "request_id": item.RequestID, "system": item.System, "status": item.Status, "ready_at": item.ReadyAt}, nil
	}
	return nil, tools.ErrDenied
}
