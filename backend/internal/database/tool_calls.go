package database

import (
	"context"
	"encoding/json"
	"errors"
	"time"

	"github.com/ai-buddy-hc2026/ai-buddy/backend/internal/onboarding"
	"github.com/ai-buddy-hc2026/ai-buddy/backend/internal/policy"
	"github.com/ai-buddy-hc2026/ai-buddy/backend/internal/toolcontract"
	"github.com/ai-buddy-hc2026/ai-buddy/backend/internal/tools"
	"github.com/jackc/pgx/v5"
)

// Call никогда не исполняет запись из Python, включая уже подтвержденный action_id.
func (s *Tools) Call(ctx context.Context, requestID string, operation policy.Operation, raw json.RawMessage) (any, error) {
	var input any
	if json.Unmarshal(raw, &input) != nil || toolcontract.Input(string(operation)) == "" || toolcontract.Validate(toolcontract.Input(string(operation)), input) != nil {
		return nil, tools.ErrInvalid
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer rollbackOnboarding(tx)
	actor, err := s.actor(ctx, tx, requestID, true)
	if err != nil {
		return nil, err
	}
	resource := policy.Resource{TeamID: actor.teamID, OwnerID: actor.id, BuddyID: actor.id}
	if operation != policy.UpdateStatus {
		if reason := policy.Check(actor.policyActor(), operation, resource); reason != "" {
			return nil, denyPolicy(ctx, s.pool, tx, actor, operation, reason, tools.ErrDenied)
		}
	}
	var result any
	switch operation {
	case policy.GetPlan:
		var input tools.PlanInput
		if tools.Decode(raw, &input) != nil {
			return nil, tools.ErrInvalid
		}
		if input.InternID == "" && actor.role != "intern" {
			return nil, tools.ErrInvalid
		}
		if err := tx.Commit(ctx); err != nil {
			return nil, err
		}
		plan, err := NewOnboarding(s.pool).GetPlan(ctx, actor.id, input.InternID)
		if err != nil {
			return nil, err
		}
		return planData(plan, actor.teamID), nil
	case policy.GetManager:
		var managerData *tools.Manager
		managerData, err = manager(ctx, tx, actor)
		result = map[string]any{"manager": managerData}
	case policy.GetAbsencePolicy:
		result, err = absencePolicy(ctx, tx, actor)
	case policy.ListAbsences:
		var input tools.ListAbsencesInput
		if tools.Decode(raw, &input) != nil {
			return nil, tools.ErrInvalid
		}
		result, err = s.absences(ctx, tx, actor, input)
	case policy.UpdateStatus, policy.CreateAbsence:
		_, err = s.prepareAction(ctx, tx, actor, operation, raw)
		if err == nil {
			err = tools.ErrConfirmation
		}
	default:
		return nil, tools.ErrDenied
	}
	if err != nil {
		return nil, err
	}
	return result, tx.Commit(ctx)
}

func planData(plan onboarding.Plan, teamID string) any {
	tasks := []any{}
	var next any
	for _, stage := range plan.Stages {
		for _, task := range stage.Tasks {
			tasks = append(tasks, map[string]any{"id": task.ID, "stage": task.Stage, "position": task.Position, "title": task.Title, "description": task.Description, "status": task.Status, "due_date": task.DueDate, "assignee_id": task.AssigneeID, "version": task.Version})
			if plan.NextTaskID != nil && task.ID == *plan.NextTaskID {
				next = map[string]any{"task_id": task.ID, "title": task.Title, "due_date": task.DueDate}
			}
		}
	}
	return map[string]any{"employee_id": plan.InternID, "team_id": teamID, "stage": plan.CurrentStage, "progress": map[string]int{"done": plan.Progress.Done, "total": plan.Progress.Total}, "tasks": tasks, "next_step": next}
}

func manager(ctx context.Context, tx pgx.Tx, actor planActor) (*tools.Manager, error) {
	var m tools.Manager
	err := tx.QueryRow(ctx, `SELECT m.id::text,m.display_name,m.role FROM users u JOIN users m ON m.team_id=u.team_id
 AND ((m.id=u.buddy_id AND m.role='buddy') OR (m.id=u.manager_id AND m.role IN ('buddy','lead')))
 WHERE u.id=$1 AND m.active AND m.id<>u.id ORDER BY (m.id=u.buddy_id) DESC NULLS LAST,m.id LIMIT 1 FOR SHARE OF m`, actor.id).Scan(&m.ID, &m.Name, &m.Role)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	return &m, err
}

func absencePolicy(ctx context.Context, tx pgx.Tx, actor planActor) (tools.PolicyData, error) {
	var p tools.PolicyData
	var types []byte
	p.RequiresApproval = true
	err := tx.QueryRow(ctx, `SELECT notice_period_days,allowed_types FROM absence_policies WHERE team_id=$1 FOR SHARE`, actor.teamID).Scan(&p.NoticePeriodDays, &types)
	if errors.Is(err, pgx.ErrNoRows) {
		return p, tools.ErrUnavailable
	}
	if err != nil {
		return p, err
	}
	if json.Unmarshal(types, &p.AllowedTypes) != nil || toolcontract.Validate("GetPolicyData", p) != nil {
		return p, tools.ErrUnavailable
	}
	seen := make(map[string]bool)
	for _, kind := range p.AllowedTypes {
		if seen[kind.Code] {
			return p, tools.ErrUnavailable
		}
		seen[kind.Code] = true
	}
	return p, nil
}

func (s *Tools) prepareAction(ctx context.Context, tx pgx.Tx, actor planActor, operation policy.Operation, raw json.RawMessage) (json.RawMessage, error) {
	switch operation {
	case policy.UpdateStatus:
		var p tools.TaskParameters
		if tools.Decode(raw, &p) != nil {
			return nil, tools.ErrInvalid
		}
		if err := s.authorizeTask(ctx, tx, actor, p.TaskID); err != nil {
			return nil, err
		}
		return json.Marshal(p)
	case policy.CreateAbsence:
		var p tools.CreateAbsenceInput
		if tools.Decode(raw, &p) != nil {
			return nil, tools.ErrInvalid
		}
		var timezone string
		if err := tx.QueryRow(ctx, `SELECT COALESCE(u.timezone,t.timezone) FROM users u JOIN teams t ON t.id=u.team_id WHERE u.id=$1`, actor.id).Scan(&timezone); err != nil {
			return nil, err
		}
		configuration, err := absencePolicy(ctx, tx, actor)
		if err != nil {
			return nil, err
		}
		params := tools.AbsenceParameters{Date: p.Date, Type: p.Type}
		if err := tools.ValidateAbsence(params, s.now(), timezone, configuration); err != nil {
			return nil, err
		}
		m, err := manager(ctx, tx, actor)
		if err != nil {
			return nil, err
		}
		if m == nil {
			return nil, tools.ErrBusinessConflict
		}
		params.Approver = m.ID
		return json.Marshal(params)
	default:
		return nil, tools.ErrDenied
	}
}

func (s *Tools) absences(ctx context.Context, tx pgx.Tx, actor planActor, input tools.ListAbsencesInput) (any, error) {
	if input.Limit == 0 {
		input.Limit = 50
	}
	scope := listScope{Kind: "absences", Actor: actor.id, Team: actor.teamID, Role: actor.role}
	var before *time.Time
	var id string
	if input.Cursor != "" {
		cursor, err := (&Listings{cursorKey: s.cursorKey}).decodeCursor(input.Cursor, scope)
		if err != nil {
			return nil, tools.ErrInvalid
		}
		before = &cursor.CreatedAt
		id = cursor.ID
	}
	rows, err := tx.Query(ctx, `SELECT a.action_id::text,a.created_at,'ABS-'||lpad(a.id::text,greatest(4,length(a.id::text)),'0'),a.employee_id::text,a.absence_date::text,a.absence_type,a.status,a.approver_id::text
 FROM absence_requests a JOIN users u ON u.id=a.employee_id AND u.team_id=a.team_id
 WHERE a.team_id=$1 AND ($2='lead' OR (u.buddy_id=$3 AND u.role='intern' AND u.active))
 AND ($4::timestamptz IS NULL OR (a.created_at,a.action_id)<($4,$5::uuid)) ORDER BY a.created_at DESC,a.action_id DESC LIMIT $6`, actor.teamID, actor.role, actor.id, before, optionalID(id), input.Limit+1)
	if err != nil {
		return nil, err
	}
	type item struct {
		ID      string
		Created time.Time
		Absence tools.Absence
	}
	items, err := pgx.CollectRows(rows, func(row pgx.CollectableRow) (item, error) {
		var x item
		err := row.Scan(&x.ID, &x.Created, &x.Absence.ID, &x.Absence.EmployeeID, &x.Absence.Date, &x.Absence.Type, &x.Absence.Status, &x.Absence.Approver)
		return x, err
	})
	if err != nil {
		return nil, err
	}
	var next *string
	if len(items) > input.Limit {
		x := items[input.Limit-1]
		cursor := (&Listings{cursorKey: s.cursorKey}).encodeCursor(scope, x.ID, x.Created)
		next = &cursor
		items = items[:input.Limit]
	}
	result := []tools.Absence{}
	for _, x := range items {
		result = append(result, x.Absence)
	}
	return map[string]any{"items": result, "next_cursor": next}, nil
}
