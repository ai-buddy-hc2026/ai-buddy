package database

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"math/rand/v2"
	"time"

	"github.com/ai-buddy-hc2026/ai-buddy/backend/internal/identifier"
	"github.com/ai-buddy-hc2026/ai-buddy/backend/internal/onboarding"
	"github.com/ai-buddy-hc2026/ai-buddy/backend/internal/policy"
	"github.com/ai-buddy-hc2026/ai-buddy/backend/internal/tools"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

type Tools struct {
	pool        *pgxpool.Pool
	failureRate float64
	now         func() time.Time
}

func NewTools(pool *pgxpool.Pool, failureRate float64) (*Tools, error) {
	if pool == nil || math.IsNaN(failureRate) || failureRate < 0 || failureRate > 1 {
		return nil, tools.ErrInvalid
	}
	return &Tools{pool: pool, failureRate: failureRate, now: time.Now}, nil
}

// Bind проверяет сохраненный контекст для каждого HTTP-запроса MCP.
func (s *Tools) Bind(ctx context.Context, requestID string) error {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer rollbackOnboarding(tx)
	_, err = s.actor(ctx, tx, requestID, false)
	return err
}

func (s *Tools) actor(ctx context.Context, tx pgx.Tx, requestID string, active bool) (planActor, error) {
	if !identifier.ValidUUID(requestID) {
		return planActor{}, tools.ErrContext
	}
	var userID string
	err := tx.QueryRow(ctx, `SELECT user_id::text FROM chat_requests WHERE id=$1 AND (NOT $2::boolean OR (status='running' AND deadline_at>now())) FOR SHARE`, requestID, active).Scan(&userID)
	if errors.Is(err, pgx.ErrNoRows) {
		return planActor{}, tools.ErrContext
	}
	if err != nil {
		return planActor{}, err
	}
	return loadPlanActor(ctx, tx, userID, true)
}

// Call повторно проверяет контекст, права и подтверждение внутри операции.
func (s *Tools) Call(ctx context.Context, requestID string, operation policy.Operation, raw json.RawMessage) (any, error) {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer rollbackOnboarding(tx)
	actor, err := s.actor(ctx, tx, requestID, operation != policy.CreateAbsence && operation != policy.UpdateStatus)
	if err != nil {
		return nil, err
	}
	resource := policy.Resource{TeamID: actor.teamID, OwnerID: actor.id}
	var result any
	switch operation {
	case policy.GetPlan:
		var input tools.PlanInput
		if err := tools.Decode(raw, &input); err != nil {
			return nil, err
		}
		if input.InternID != "" && !identifier.ValidUUID(input.InternID) {
			return nil, tools.ErrInvalid
		}
		// GetPlan сам загружает актуального пользователя и проверяет область плана.
		if err := tx.Commit(ctx); err != nil {
			return nil, err
		}
		return NewOnboarding(s.pool).GetPlan(ctx, actor.id, input.InternID)
	case policy.GetManager, policy.ListAbsences:
		var input tools.EmployeeInput
		if err := tools.Decode(raw, &input); err != nil {
			return nil, err
		}
		if input.EmployeeID != "" {
			if !identifier.ValidUUID(input.EmployeeID) {
				return nil, tools.ErrInvalid
			}
			resource.OwnerID = input.EmployeeID
		}
		if reason := policy.Check(actor.policyActor(), operation, resource); reason != "" {
			return nil, denyPolicy(ctx, s.pool, tx, actor, operation, reason, tools.ErrDenied)
		}
		if operation == policy.GetManager {
			result, err = manager(ctx, tx, actor)
		} else {
			result, err = s.absences(ctx, tx, actor)
		}
	case policy.GetAbsencePolicy:
		if err := tools.Decode(raw, &tools.EmptyInput{}); err != nil {
			return nil, err
		}
		if reason := policy.Check(actor.policyActor(), operation, resource); reason != "" {
			return nil, denyPolicy(ctx, s.pool, tx, actor, operation, reason, tools.ErrDenied)
		}
		var timezone string
		err = tx.QueryRow(ctx, `SELECT COALESCE(u.timezone,t.timezone) FROM users u JOIN teams t ON t.id=u.team_id WHERE u.id=$1`, actor.id).Scan(&timezone)
		result = tools.AbsencePolicy{Revision: 1, Title: "Тестовая инструкция, не регламент Авито", Types: []string{"отгул", "отпуск"}, MaxAdvanceDays: 365, Timezone: timezone}
	case policy.CreateAbsence, policy.UpdateStatus:
		var input tools.ActionInput
		if err := tools.Decode(raw, &input); err != nil {
			return nil, err
		}
		if !identifier.ValidUUID(input.ActionID) {
			return nil, tools.ErrInvalid
		}
		return s.execute(ctx, tx, actor, requestID, operation, input.ActionID)
	default:
		return nil, denyPolicy(ctx, s.pool, tx, actor, operation, "operation_denied", tools.ErrDenied)
	}
	if err != nil {
		return nil, err
	}
	return result, tx.Commit(ctx)
}

func manager(ctx context.Context, tx pgx.Tx, actor planActor) (tools.Manager, error) {
	var result tools.Manager
	err := tx.QueryRow(ctx, `SELECT m.id::text,m.display_name FROM users u JOIN users m ON m.id=u.manager_id AND m.team_id=u.team_id JOIN teams t ON t.id=m.team_id WHERE u.id=$1 AND m.active AND t.active AND m.role IN ('buddy','lead') FOR SHARE OF m`, actor.id).Scan(&result.ID, &result.Name)
	if errors.Is(err, pgx.ErrNoRows) {
		return result, tools.ErrNoManager
	}
	return result, err
}

func (s *Tools) absences(ctx context.Context, tx pgx.Tx, actor planActor) (any, error) {
	rows, err := tx.Query(ctx, `SELECT 'ABS-' || lpad(id::text, greatest(4,length(id::text)), '0'),absence_date::text,absence_type,status,approver_id::text FROM absence_requests WHERE team_id=$1 AND employee_id=$2 ORDER BY absence_date DESC,id DESC`, actor.teamID, actor.id)
	if err != nil {
		return nil, err
	}
	items, err := pgx.CollectRows(rows, func(row pgx.CollectableRow) (tools.Absence, error) {
		var item tools.Absence
		err := row.Scan(&item.ID, &item.Date, &item.Type, &item.Status, &item.Approver)
		return item, err
	})
	if items == nil {
		items = []tools.Absence{}
	}
	return map[string]any{"items": items}, err
}

type toolAction struct {
	status, key        string
	parameters, result json.RawMessage
}

func (s *Tools) execute(ctx context.Context, tx pgx.Tx, actor planActor, requestID string, operation policy.Operation, actionID string) (any, error) {
	var action toolAction
	var confirmed bool
	err := tx.QueryRow(ctx, `SELECT status,idempotency_key::text,parameters,result,COALESCE(confirmed_by=actor_id AND confirmed_at IS NOT NULL,false) FROM actions_log WHERE id=$1 AND request_id=$2 AND actor_id=$3 AND team_id=$4 AND action_type=$5 FOR UPDATE`, actionID, requestID, actor.id, actor.teamID, string(operation)).Scan(&action.status, &action.key, &action.parameters, &action.result, &confirmed)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, denyPolicy(ctx, s.pool, tx, actor, operation, "action_unavailable", tools.ErrDenied)
	}
	if err != nil {
		return nil, err
	}
	if !confirmed || (action.status != "confirmed" && action.status != "failed" && action.status != "succeeded") {
		return nil, denyPolicy(ctx, s.pool, tx, actor, operation, "confirmation_required", tools.ErrConfirmation)
	}
	var params tools.TaskParameters
	if operation == policy.UpdateStatus {
		if tools.Decode(action.parameters, &params) != nil || !identifier.ValidUUID(params.TaskID) || !onboarding.ValidStatus(params.Status) || params.Version < 1 {
			return nil, tools.ErrInvalid
		}
		if err := s.authorizeTask(ctx, tx, actor, params.TaskID); err != nil {
			return nil, err
		}
	} else if reason := policy.Check(actor.policyActor(), operation, policy.Resource{TeamID: actor.teamID, OwnerID: actor.id}); reason != "" {
		return nil, denyPolicy(ctx, s.pool, tx, actor, operation, reason, tools.ErrDenied)
	}
	if action.status == "succeeded" {
		return action.result, tx.Commit(ctx)
	}
	if _, err := tx.Exec(ctx, `UPDATE actions_log SET status='executing',started_at=now(),finished_at=NULL,attempt_count=attempt_count+1,last_error=NULL,updated_at=now() WHERE id=$1`, actionID); err != nil {
		return nil, err
	}
	var result any
	if operation == policy.UpdateStatus {
		result, err = NewOnboarding(s.pool).updateStatus(ctx, tx, actor, params.TaskID, onboarding.StatusChange{Status: params.Status, Version: params.Version})
	} else {
		result, err = s.createAbsence(ctx, tx, actor, actionID, action)
	}
	if err != nil {
		// Ошибки policy уже откатили транзакцию и записали отказ отдельно.
		if _, saveErr := tx.Exec(ctx, `UPDATE actions_log SET status='failed',finished_at=now(),last_error='{"code":"TOOL_FAILED"}',updated_at=now() WHERE id=$1`, actionID); saveErr != nil {
			if errors.Is(saveErr, pgx.ErrTxClosed) {
				return nil, err
			}
			return nil, saveErr
		}
		if _, saveErr := tx.Exec(ctx, `INSERT INTO events(team_id,actor_id,request_id,action_id,event_type) VALUES($1,$2,$3,$4,'action_failed')`, actor.teamID, actor.id, requestID, actionID); saveErr != nil {
			return nil, saveErr
		}
		if saveErr := tx.Commit(ctx); saveErr != nil {
			return nil, saveErr
		}
		return nil, err
	}
	encoded, err := json.Marshal(result)
	if err != nil {
		return nil, err
	}
	if _, err := tx.Exec(ctx, `UPDATE actions_log SET status='succeeded',finished_at=now(),result=$2,last_error=NULL,updated_at=now() WHERE id=$1`, actionID, encoded); err != nil {
		return nil, err
	}
	return result, tx.Commit(ctx)
}

func (s *Tools) authorizeTask(ctx context.Context, tx pgx.Tx, actor planActor, taskID string) error {
	var owner, assignee string
	var buddy *string
	err := tx.QueryRow(ctx, `SELECT p.intern_id::text,i.buddy_id::text,t.assignee_id::text FROM tasks t JOIN onboarding_plans p ON p.id=t.plan_id AND p.team_id=t.team_id JOIN users i ON i.id=p.intern_id AND i.team_id=p.team_id WHERE t.id=$1 AND t.team_id=$2 AND i.active AND i.role='intern' FOR UPDATE OF t FOR SHARE OF p,i`, taskID, actor.teamID).Scan(&owner, &buddy, &assignee)
	if errors.Is(err, pgx.ErrNoRows) {
		return denyPolicy(ctx, s.pool, tx, actor, policy.UpdateStatus, "resource_unavailable", tools.ErrDenied)
	}
	if err != nil {
		return err
	}
	if reason := policy.Check(actor.policyActor(), policy.UpdateStatus, planResource(actor, owner, buddy, assignee)); reason != "" {
		return denyPolicy(ctx, s.pool, tx, actor, policy.UpdateStatus, reason, tools.ErrDenied)
	}
	return nil
}

func (s *Tools) createAbsence(ctx context.Context, tx pgx.Tx, actor planActor, actionID string, action toolAction) (any, error) {
	var params tools.AbsenceParameters
	if err := tools.Decode(action.parameters, &params); err != nil {
		return nil, err
	}
	var timezone string
	if err := tx.QueryRow(ctx, `SELECT COALESCE(u.timezone,t.timezone) FROM users u JOIN teams t ON t.id=u.team_id WHERE u.id=$1`, actor.id).Scan(&timezone); err != nil {
		return nil, err
	}
	if err := tools.ValidateAbsence(params, s.now(), timezone); err != nil {
		return nil, err
	}
	approver, err := manager(ctx, tx, actor)
	if err != nil {
		return nil, err
	}
	if params.Approver != approver.ID {
		return nil, tools.ErrConflict
	}
	if rand.Float64() < s.failureRate {
		return nil, tools.ErrUnavailable
	}
	var id int64
	err = tx.QueryRow(ctx, `INSERT INTO absence_requests(team_id,employee_id,action_id,idempotency_key,absence_date,absence_type,approver_id) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING id`, actor.teamID, actor.id, actionID, action.key, params.Date, params.Type, approver.ID).Scan(&id)
	if err != nil {
		return nil, err
	}
	return tools.Absence{ID: fmt.Sprintf("ABS-%04d", id), Date: params.Date, Type: params.Type, Status: "pending_approval", Approver: approver.ID}, nil
}
