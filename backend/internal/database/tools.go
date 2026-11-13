package database

import (
	"context"
	cryptorand "crypto/rand"
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
	cursorKey   [32]byte
}

func NewTools(pool *pgxpool.Pool, failureRate float64) (*Tools, error) {
	if pool == nil || math.IsNaN(failureRate) || failureRate < 0 || failureRate > 1 {
		return nil, tools.ErrInvalid
	}
	// Ключ курсора живет в рамках процесса; он не является разрешением доступа.
	store := &Tools{pool: pool, failureRate: failureRate, now: time.Now}
	if _, err := cryptorand.Read(store.cursorKey[:]); err != nil {
		return nil, err
	}
	return store, nil
}

// Context связывает MCP только с активной сохраненной генерацией.
func (s *Tools) Context(ctx context.Context, requestID string) (tools.Context, error) {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return tools.Context{}, err
	}
	defer rollbackOnboarding(tx)
	actor, err := s.actor(ctx, tx, requestID, true)
	return tools.Context{ActorID: actor.id, TeamID: actor.teamID, Role: actor.role}, err
}

// KnowledgeScope проверяет актуальные права перед каждым поиском Python.
func (s *Tools) KnowledgeScope(ctx context.Context, requestID string) (tools.Context, error) {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return tools.Context{}, err
	}
	defer rollbackOnboarding(tx)
	actor, err := s.actor(ctx, tx, requestID, true)
	if err != nil {
		return tools.Context{}, err
	}
	var teamID string
	if err := tx.QueryRow(ctx, "SELECT team_id::text FROM chat_requests WHERE id=$1", requestID).Scan(&teamID); err != nil {
		return tools.Context{}, err
	}
	if reason := policy.Check(actor.policyActor(), policy.SearchKnowledge, policy.Resource{TeamID: teamID}); reason != "" {
		return tools.Context{}, denyPolicy(ctx, s.pool, tx, actor, policy.SearchKnowledge, reason, tools.ErrDenied)
	}
	return tools.Context{ActorID: actor.id, TeamID: actor.teamID, Role: actor.role}, tx.Commit(ctx)
}

func (s *Tools) actor(ctx context.Context, tx pgx.Tx, requestID string, active bool) (planActor, error) {
	if !identifier.ValidUUID(requestID) {
		return planActor{}, tools.ErrContext
	}
	var userID, status string
	var inTime bool
	err := tx.QueryRow(ctx, `SELECT user_id::text,status,deadline_at>now() FROM chat_requests WHERE id=$1 FOR SHARE`, requestID).Scan(&userID, &status, &inTime)
	if errors.Is(err, pgx.ErrNoRows) {
		return planActor{}, tools.ErrUnknownRequest
	}
	if err != nil {
		return planActor{}, err
	}
	if active && (status != "running" || !inTime) {
		return planActor{}, tools.ErrClosed
	}
	return loadPlanActor(ctx, tx, userID, true)
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
	switch operation {
	case policy.UpdateStatus:
		var oldStatus string
		if err := tx.QueryRow(ctx, `SELECT status FROM tasks WHERE id=$1`, params.TaskID).Scan(&oldStatus); err != nil {
			return nil, err
		}
		var task onboarding.Task
		task, err = NewOnboarding(s.pool).updateStatus(ctx, tx, actor, params.TaskID, onboarding.StatusChange{Status: params.Status, Version: params.Version})
		result = tools.StatusResult{TaskID: task.ID, OldStatus: oldStatus, Status: task.Status, Version: task.Version, UpdatedAt: task.UpdatedAt}
	case policy.CreateEscalation:
		result, err = s.createEscalation(ctx, tx, actor, requestID, actionID, action)
	case policy.CreateAbsence:
		result, err = s.createAbsence(ctx, tx, actor, actionID, action)
	}
	if err != nil {
		// Ошибки policy уже откатили транзакцию и записали отказ отдельно.
		detail, _ := json.Marshal(actionFailure(err))
		if _, saveErr := tx.Exec(ctx, `UPDATE actions_log SET status='failed',finished_at=now(),last_error=$2,updated_at=now() WHERE id=$1`, actionID, detail); saveErr != nil {
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
		return nil, &actionExecutionError{err}
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
		return denyPolicy(ctx, s.pool, tx, actor, policy.UpdateStatus, "resource_unavailable", tools.ErrNotFound)
	}
	if err != nil {
		return err
	}
	if reason := policy.Check(actor.policyActor(), policy.UpdateStatus, planResource(actor, owner, buddy, assignee)); reason != "" {
		denied := tools.ErrNotFound
		if reason == "assignee_denied" {
			denied = tools.ErrDenied
		}
		return denyPolicy(ctx, s.pool, tx, actor, policy.UpdateStatus, reason, denied)
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
	configuration, err := absencePolicy(ctx, tx, actor)
	if err != nil {
		return nil, err
	}
	if err := tools.ValidateAbsence(params, s.now(), timezone, configuration); err != nil {
		return nil, err
	}
	approver, err := manager(ctx, tx, actor)
	if err != nil {
		return nil, err
	}
	if approver == nil || params.Approver != approver.ID {
		return nil, tools.ErrBusinessConflict
	}
	if rand.Float64() < s.failureRate {
		return nil, tools.ErrUnavailable
	}
	var id int64
	err = tx.QueryRow(ctx, `INSERT INTO absence_requests(team_id,employee_id,action_id,idempotency_key,absence_date,absence_type,approver_id) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING id`, actor.teamID, actor.id, actionID, action.key, params.Date, params.Type, approver.ID).Scan(&id)
	if err != nil {
		return nil, err
	}
	return tools.CreateAbsenceResult{ActionID: actionID, ExternalID: fmt.Sprintf("ABS-%04d", id), Status: "pending_approval", Approver: approver.ID}, nil
}
