package database

import (
	"context"
	"encoding/json"
	"errors"

	"github.com/ai-buddy-hc2026/ai-buddy/backend/internal/activity"
	"github.com/ai-buddy-hc2026/ai-buddy/backend/internal/chat"
	"github.com/ai-buddy-hc2026/ai-buddy/backend/internal/identifier"
	"github.com/ai-buddy-hc2026/ai-buddy/backend/internal/onboarding"
	"github.com/ai-buddy-hc2026/ai-buddy/backend/internal/policy"
	"github.com/ai-buddy-hc2026/ai-buddy/backend/internal/toolcontract"
	"github.com/ai-buddy-hc2026/ai-buddy/backend/internal/tools"
	"github.com/jackc/pgx/v5"
)

// ExecuteConfirmed предназначен только для доверенного Go-исполнителя, не MCP.
func (s *Tools) ExecuteConfirmed(ctx context.Context, actorID, actionID string) (any, error) {
	return s.executeAction(ctx, actorID, actionID, false)
}

func (s *Tools) executeAction(ctx context.Context, actorID, actionID string, confirm bool) (any, error) {
	if !identifier.ValidUUID(actorID) || !identifier.ValidUUID(actionID) {
		return nil, tools.ErrInvalid
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer rollbackOnboarding(tx)
	actor, err := loadPlanActor(ctx, tx, actorID, true)
	if err != nil {
		return nil, err
	}
	var requestID, kind, status string
	err = tx.QueryRow(ctx, `SELECT request_id::text,action_type,status FROM actions_log WHERE id=$1 AND actor_id=$2 AND team_id=$3 FOR UPDATE`, actionID, actor.id, actor.teamID).Scan(&requestID, &kind, &status)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, denyPolicy(ctx, s.pool, tx, actor, policy.ListActions, "action_unavailable", tools.ErrNotFound)
	}
	if err != nil {
		return nil, err
	}
	if status == "cancelled" {
		return nil, tools.ErrActionNotConfirmable
	}
	if confirm && status == "proposed" {
		if _, err := tx.Exec(ctx, `UPDATE actions_log SET status='confirmed',confirmed_by=actor_id,confirmed_at=now(),updated_at=now() WHERE id=$1`, actionID); err != nil {
			return nil, err
		}
		payload, _ := json.Marshal(map[string]string{"action_type": kind, "status": "confirmed"})
		if _, err := tx.Exec(ctx, `INSERT INTO events(team_id,actor_id,request_id,action_id,event_type,dedup_key,payload) VALUES($1,$2,$3,$4,'action_confirmed',$5,$6)`, actor.teamID, actor.id, requestID, actionID, "action:"+actionID+":confirmed", payload); err != nil {
			return nil, err
		}
	}
	if confirm && (status == "executing" || status == "confirmed") {
		// Подтвержденная строка может принадлежать уже работающему исполнителю.
		if err := tx.Commit(ctx); err != nil {
			return nil, err
		}
		return nil, nil
	}
	return s.execute(ctx, tx, actor, requestID, policy.Operation(kind), actionID)
}

const publicActionColumns = `id::text,request_id::text,proposal_seq,action_type,parameters,status,result,last_error,attempt_count,created_at,updated_at`

func (s *Tools) Confirm(ctx context.Context, actorID, actionID string) (activity.Action, error) {
	_, err := s.executeAction(ctx, actorID, actionID, true)
	if err != nil {
		var executionError *actionExecutionError
		if !errors.As(err, &executionError) {
			return activity.Action{}, err
		}
		saved, readErr := readPublicAction(s.pool.QueryRow(ctx, `SELECT `+publicActionColumns+` FROM actions_log WHERE id=$1 AND actor_id=$2`, actionID, actorID))
		if readErr == nil && saved.Status == "failed" {
			return saved, nil
		}
		return activity.Action{}, err
	}
	return readPublicAction(s.pool.QueryRow(ctx, `SELECT `+publicActionColumns+` FROM actions_log WHERE id=$1 AND actor_id=$2`, actionID, actorID))
}

// ProcessEvent сохраняет предложение перед выдачей action_id в SSE.
func (s *Tools) ProcessEvent(ctx context.Context, requestID string, event chat.Event) (chat.Event, error) {
	if event.Type == "tool_call" {
		var input struct {
			Name      string          `json:"tool_name"`
			Arguments json.RawMessage `json:"arguments"`
		}
		if tools.Decode(event.Data, &input) != nil || toolcontract.Input(input.Name) == "" {
			return event, chat.ErrInvalid
		}
		event.Data, _ = json.Marshal(map[string]any{"tool_name": input.Name, "arguments": map[string]any{}})
		return event, nil
	}
	var input struct {
		ActionType string          `json:"action_type"`
		Details    json.RawMessage `json:"details"`
	}
	if event.Type != "action_proposal" || tools.Decode(event.Data, &input) != nil {
		return event, chat.ErrInvalid
	}
	operation := policy.Operation(input.ActionType)
	if operation != policy.CreateAbsence && operation != policy.UpdateStatus {
		return event, chat.ErrInvalid
	}
	var args any
	if json.Unmarshal(input.Details, &args) != nil || toolcontract.Validate(toolcontract.Input(input.ActionType), args) != nil {
		return event, chat.ErrInvalid
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return event, err
	}
	defer rollbackOnboarding(tx)
	actor, err := s.actor(ctx, tx, requestID, true)
	if err != nil {
		return event, err
	}
	if operation != policy.UpdateStatus {
		if reason := policy.Check(actor.policyActor(), operation, policy.Resource{TeamID: actor.teamID, OwnerID: actor.id}); reason != "" {
			return event, denyPolicy(ctx, s.pool, tx, actor, operation, reason, tools.ErrDenied)
		}
	}
	// Повтор события использует сохраненный снимок, даже если согласующий сменился.
	var existingID, existingType string
	var existingParameters json.RawMessage
	err = tx.QueryRow(ctx, `SELECT id::text,action_type,parameters FROM actions_log WHERE request_id=$1 AND proposal_seq=$2 AND actor_id=$3`, requestID, event.Seq, actor.id).Scan(&existingID, &existingType, &existingParameters)
	if err == nil {
		var saved, incoming map[string]any
		if json.Unmarshal(existingParameters, &saved) != nil || json.Unmarshal(input.Details, &incoming) != nil {
			return event, chat.ErrInvalid
		}
		delete(saved, "approver")
		savedJSON, _ := json.Marshal(saved)
		incomingJSON, _ := json.Marshal(incoming)
		if existingType != input.ActionType || string(savedJSON) != string(incomingJSON) {
			return event, chat.ErrInvalid
		}
		details, _, err := actionPublicFields(existingType, existingParameters, json.RawMessage(`{}`))
		if err != nil {
			return event, err
		}
		event.Data, _ = json.Marshal(map[string]any{"action_type": existingType, "details": details, "action_id": existingID, "status": "proposed"})
		return event, tx.Commit(ctx)
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return event, err
	}
	parameters, err := s.prepareAction(ctx, tx, actor, operation, input.Details)
	if err != nil {
		return event, err
	}
	var actionID string
	err = tx.QueryRow(ctx, `INSERT INTO actions_log(team_id,request_id,proposal_seq,actor_id,action_type,parameters) VALUES($1,$2,$3,$4,$5,$6)
 ON CONFLICT(request_id,proposal_seq) DO NOTHING RETURNING id::text`, actor.teamID, requestID, event.Seq, actor.id, input.ActionType, parameters).Scan(&actionID)
	if errors.Is(err, pgx.ErrNoRows) {
		err = tx.QueryRow(ctx, `SELECT id::text FROM actions_log WHERE request_id=$1 AND proposal_seq=$2 AND actor_id=$3 AND action_type=$4 AND parameters=$5::jsonb`, requestID, event.Seq, actor.id, input.ActionType, parameters).Scan(&actionID)
		if errors.Is(err, pgx.ErrNoRows) {
			return event, chat.ErrInvalid
		}
	} else if err == nil {
		payload, _ := json.Marshal(map[string]any{"action_type": input.ActionType, "proposal_seq": event.Seq})
		_, err = tx.Exec(ctx, `INSERT INTO events(team_id,actor_id,request_id,action_id,event_type,dedup_key,payload) VALUES($1,$2,$3,$4,'action_proposed',$5,$6)`, actor.teamID, actor.id, requestID, actionID, "action:"+actionID+":proposed", payload)
	}
	if err != nil {
		return event, err
	}
	details, _, err := actionPublicFields(input.ActionType, parameters, json.RawMessage(`{}`))
	if err != nil {
		return event, err
	}
	event.Data, _ = json.Marshal(map[string]any{"action_type": input.ActionType, "details": details, "action_id": actionID, "status": "proposed"})
	return event, tx.Commit(ctx)
}

// Только ошибка уже сохраненной попытки позволяет вернуть failed вместо HTTP-ошибки.
type actionExecutionError struct{ error }

func (e *actionExecutionError) Unwrap() error { return e.error }

func actionFailure(err error) activity.ErrorDetail {
	code := "INTERNAL_ERROR"
	switch {
	case errors.Is(err, tools.ErrUnavailable):
		code = "DEPENDENCY_UNAVAILABLE"
	case errors.Is(err, onboarding.ErrVersionConflict):
		code = "VERSION_CONFLICT"
	case errors.Is(err, tools.ErrBusinessConflict), errors.Is(err, onboarding.ErrPlanInactive):
		code = "CONFLICT"
	case errors.Is(err, tools.ErrConflict):
		code = "IDEMPOTENCY_CONFLICT"
	case errors.Is(err, context.DeadlineExceeded):
		code = "TIMEOUT"
	}
	return activity.ErrorDetail{Code: code, Message: "Действие не выполнено: " + code}
}
