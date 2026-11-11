package database

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/ai-buddy-hc2026/ai-buddy/backend/internal/auth"
	"github.com/ai-buddy-hc2026/ai-buddy/backend/internal/identifier"
	"github.com/ai-buddy-hc2026/ai-buddy/backend/internal/onboarding"
	"github.com/ai-buddy-hc2026/ai-buddy/backend/internal/policy"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

type Onboarding struct{ pool *pgxpool.Pool }

func NewOnboarding(pool *pgxpool.Pool) *Onboarding { return &Onboarding{pool: pool} }

type planActor struct{ id, teamID, role string }

func loadPlanActor(ctx context.Context, tx pgx.Tx, id string, lock bool) (planActor, error) {
	var actor planActor
	query := `SELECT u.id::text,u.team_id::text,u.role FROM users u JOIN teams t ON t.id=u.team_id WHERE u.id=$1 AND u.active AND t.active`
	if lock {
		query += " FOR SHARE OF u,t"
	}
	err := tx.QueryRow(ctx, query, id).Scan(&actor.id, &actor.teamID, &actor.role)
	if errors.Is(err, pgx.ErrNoRows) {
		return actor, auth.ErrUnauthorized
	}
	return actor, err
}

func rollbackOnboarding(tx pgx.Tx) {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	_ = tx.Rollback(ctx)
}

const taskColumns = `t.id::text,t.plan_id::text,t.assignee_id::text,t.stage,t.title,t.description,t.position,t.due_date::text,t.status,t.version,t.updated_at`

func scanTask(row pgx.Row, task *onboarding.Task, extra ...any) error {
	dest := []any{&task.ID, &task.PlanID, &task.AssigneeID, &task.Stage, &task.Title, &task.Description, &task.Position, &task.DueDate, &task.Status, &task.Version, &task.UpdatedAt}
	task.Materials = []onboarding.Material{} // Реальные KB-связи еще не загружены.
	err := row.Scan(append(dest, extra...)...)
	task.UpdatedAt = task.UpdatedAt.UTC()
	return err
}

func (s *Onboarding) GetPlan(ctx context.Context, actorID, internID string) (onboarding.Plan, error) {
	var plan onboarding.Plan
	if !identifier.ValidUUID(actorID) || (internID != "" && !identifier.ValidUUID(internID)) {
		return plan, onboarding.ErrInvalidArgument
	}
	tx, err := s.pool.BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.RepeatableRead, AccessMode: pgx.ReadOnly})
	if err != nil {
		return plan, err
	}
	defer rollbackOnboarding(tx)
	actor, err := loadPlanActor(ctx, tx, actorID, false)
	if err != nil {
		return plan, err
	}
	if internID == "" {
		if actor.role != "intern" {
			return plan, onboarding.ErrInvalidArgument
		}
		internID = actor.id
	}
	var buddyID *string
	err = tx.QueryRow(ctx, `SELECT p.id::text,p.intern_id::text,p.title,p.start_date::text,p.current_stage,p.status,i.buddy_id::text
		FROM onboarding_plans p JOIN users i ON i.id=p.intern_id AND i.team_id=p.team_id
		WHERE p.intern_id=$1 AND p.team_id=$2 AND p.status='active' AND i.active AND i.role='intern'`, internID, actor.teamID).
		Scan(&plan.ID, &plan.InternID, &plan.Title, &plan.StartDate, &plan.CurrentStage, &plan.Status, &buddyID)
	if errors.Is(err, pgx.ErrNoRows) {
		return onboarding.Plan{}, denyPolicy(ctx, s.pool, tx, actor, policy.GetPlan, "resource_unavailable", onboarding.ErrNotFound)
	}
	if err != nil {
		return plan, err
	}
	if reason := policy.Check(actor.policyActor(), policy.GetPlan, planResource(actor, plan.InternID, buddyID, "")); reason != "" {
		return onboarding.Plan{}, denyPolicy(ctx, s.pool, tx, actor, policy.GetPlan, reason, onboarding.ErrNotFound)
	}
	rows, err := tx.Query(ctx, `SELECT `+taskColumns+` FROM tasks t WHERE t.plan_id=$1 AND t.team_id=$2
		ORDER BY CASE t.stage WHEN 'week_1' THEN 1 WHEN 'week_2' THEN 2 ELSE 3 END,t.position,t.id`, plan.ID, actor.teamID)
	if err != nil {
		return plan, err
	}
	tasks, err := pgx.CollectRows(rows, func(row pgx.CollectableRow) (onboarding.Task, error) {
		var task onboarding.Task
		err := scanTask(row, &task)
		return task, err
	})
	if err != nil {
		return plan, err
	}
	plan.FillTasks(tasks)
	if err := tx.Commit(ctx); err != nil {
		return onboarding.Plan{}, err
	}
	return plan, nil
}

func (s *Onboarding) UpdateStatus(ctx context.Context, actorID, taskID string, change onboarding.StatusChange) (onboarding.Task, error) {
	var task onboarding.Task
	if !identifier.ValidUUID(actorID) || !identifier.ValidUUID(taskID) || !onboarding.ValidStatus(change.Status) || change.Version < 1 {
		return task, onboarding.ErrInvalidArgument
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return task, err
	}
	defer rollbackOnboarding(tx)
	actor, err := loadPlanActor(ctx, tx, actorID, true)
	if err != nil {
		return task, err
	}
	task, err = s.updateStatus(ctx, tx, actor, taskID, change)
	if err != nil {
		return onboarding.Task{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return onboarding.Task{}, err
	}
	return task, nil
}

// updateStatus сохраняет задачу, историю и событие в транзакции вызывающего кода.
func (s *Onboarding) updateStatus(ctx context.Context, tx pgx.Tx, actor planActor, taskID string, change onboarding.StatusChange) (onboarding.Task, error) {
	var task onboarding.Task
	var internID, planStatus string
	var buddyID *string
	err := scanTask(tx.QueryRow(ctx, `SELECT `+taskColumns+`,p.intern_id::text,i.buddy_id::text,p.status
		FROM tasks t JOIN onboarding_plans p ON p.id=t.plan_id AND p.team_id=t.team_id
		JOIN users i ON i.id=p.intern_id AND i.team_id=p.team_id
		WHERE t.id=$1 AND t.team_id=$2 AND i.active AND i.role='intern' FOR UPDATE OF t FOR SHARE OF p,i`, taskID, actor.teamID), &task, &internID, &buddyID, &planStatus)
	if errors.Is(err, pgx.ErrNoRows) {
		return onboarding.Task{}, denyPolicy(ctx, s.pool, tx, actor, policy.UpdateStatus, "resource_unavailable", onboarding.ErrNotFound)
	}
	if err != nil {
		return task, err
	}
	if reason := policy.Check(actor.policyActor(), policy.UpdateStatus, planResource(actor, internID, buddyID, task.AssigneeID)); reason != "" {
		denied := onboarding.ErrNotFound
		if reason == "assignee_denied" {
			denied = onboarding.ErrForbidden
		}
		return onboarding.Task{}, denyPolicy(ctx, s.pool, tx, actor, policy.UpdateStatus, reason, denied)
	}
	if planStatus != "active" {
		return onboarding.Task{}, onboarding.ErrPlanInactive
	}
	if task.Version != change.Version {
		return onboarding.Task{}, onboarding.ErrVersionConflict
	}
	if task.Status == change.Status {
		return task, nil
	}
	previous := task.Status
	err = tx.QueryRow(ctx, `UPDATE tasks SET status=$2,version=version+1,updated_at=now() WHERE id=$1 RETURNING status,version,updated_at`, task.ID, change.Status).
		Scan(&task.Status, &task.Version, &task.UpdatedAt)
	if err != nil {
		return onboarding.Task{}, err
	}
	task.UpdatedAt = task.UpdatedAt.UTC()
	if _, err := tx.Exec(ctx, `INSERT INTO task_status_history (task_id,version,from_status,to_status,changed_by)
		VALUES ($1,$2,$3,$4,$5)`, task.ID, task.Version, previous, task.Status, actor.id); err != nil {
		return onboarding.Task{}, err
	}
	payload, err := json.Marshal(map[string]any{"from_status": previous, "to_status": task.Status, "version": task.Version})
	if err != nil {
		return onboarding.Task{}, err
	}
	key := fmt.Sprintf("task:%s:version:%d:status_changed", task.ID, task.Version)
	if _, err := tx.Exec(ctx, `INSERT INTO events (team_id,actor_id,task_id,event_type,dedup_key,payload)
		VALUES ($1,$2,$3,'task_status_changed',$4,$5)`, actor.teamID, actor.id, task.ID, key, payload); err != nil {
		return onboarding.Task{}, err
	}
	return task, nil
}
