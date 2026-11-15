package database

import (
	"context"
	"errors"

	"github.com/ai-buddy-hc2026/ai-buddy/backend/internal/activity"
	"github.com/ai-buddy-hc2026/ai-buddy/backend/internal/employees"
	"github.com/ai-buddy-hc2026/ai-buddy/backend/internal/identifier"
	"github.com/ai-buddy-hc2026/ai-buddy/backend/internal/policy"
	"github.com/jackc/pgx/v5"
)

const employeeFields = `e.id::text,e.team_id::text,t.name,e.user_id::text,e.display_name,e.short_name,
 e.job_title,e.kind,e.tags,e.ask_about,e.contact_handle,e.is_key_contact,e.sort_order`

func readEmployee(row pgx.CollectableRow) (employees.Employee, error) {
	var e employees.Employee
	err := row.Scan(&e.ID, &e.TeamID, &e.TeamName, &e.UserID, &e.DisplayName, &e.ShortName, &e.JobTitle,
		&e.Kind, &e.Tags, &e.AskAbout, &e.ContactHandle, &e.IsKeyContact, &e.SortOrder)
	return e, err
}

// ListEmployees читает только публичные карточки команды актуального пользователя.
func (s *Listings) ListEmployees(ctx context.Context, actorID string, q employees.Query) (employees.Page, error) {
	page := employees.Page{Items: []employees.Employee{}}
	if !identifier.ValidUUID(actorID) || !employees.ValidQuery(q) {
		return page, employees.ErrInvalid
	}
	q.Search = employees.NormalizeSearch(q.Search)
	tx, err := s.pool.BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.RepeatableRead})
	if err != nil {
		return page, err
	}
	defer rollbackOnboarding(tx)
	actor, err := loadPlanActor(ctx, tx, actorID, false)
	if err != nil {
		return page, err
	}
	if reason := policy.Check(actor.policyActor(), policy.ReadEmployees, policy.Resource{TeamID: actor.teamID}); reason != "" {
		return page, denyPolicy(ctx, s.pool, tx, actor, policy.ReadEmployees, reason, activity.ErrDenied)
	}
	scope := listScope{Kind: "employees", Actor: actor.id, Team: actor.teamID, Search: q.Search, Limit: q.Limit}
	afterID, afterOrder := "00000000-0000-0000-0000-000000000000", -1
	if q.Cursor != "" {
		cursor, err := s.decodeCursor(q.Cursor, scope)
		if err != nil || cursor.SortOrder < 0 {
			return page, employees.ErrInvalid
		}
		afterID, afterOrder = cursor.ID, cursor.SortOrder
	}
	// strpos выполняет буквальный поиск: пользовательские % и _ не становятся шаблоном SQL.
	rows, err := tx.Query(ctx, `SELECT `+employeeFields+` FROM employees e JOIN teams t ON t.id=e.team_id
 WHERE e.team_id=$1 AND e.active AND t.active
 AND (e.user_id IS NULL OR EXISTS (SELECT 1 FROM users u WHERE u.id=e.user_id AND u.team_id=e.team_id AND u.active))
 AND ($2='' OR strpos(lower(e.display_name),$2)>0 OR strpos(lower(e.job_title),$2)>0
 OR EXISTS (SELECT 1 FROM unnest(e.tags) tag WHERE strpos(lower(tag),$2)>0))
 AND (e.sort_order,e.id)>($3,$4::uuid) ORDER BY e.sort_order,e.id LIMIT $5`, actor.teamID, q.Search, afterOrder, afterID, q.Limit+1)
	if err != nil {
		return page, err
	}
	items, err := pgx.CollectRows(rows, readEmployee)
	if err != nil {
		return page, err
	}
	if len(items) > q.Limit {
		last := items[q.Limit-1]
		cursor := s.encodeCursorValue(listCursor{Version: 1, Scope: scope, ID: last.ID, SortOrder: last.SortOrder})
		page.NextCursor = &cursor
		items = items[:q.Limit]
	}
	if items != nil {
		page.Items = items
	}
	return page, tx.Commit(ctx)
}

func (s *Listings) GetEmployee(ctx context.Context, actorID, id string) (employees.Employee, error) {
	var empty employees.Employee
	if !identifier.ValidUUID(actorID) || !identifier.ValidUUID(id) {
		return empty, employees.ErrInvalid
	}
	tx, err := s.pool.BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.RepeatableRead})
	if err != nil {
		return empty, err
	}
	defer rollbackOnboarding(tx)
	actor, err := loadPlanActor(ctx, tx, actorID, false)
	if err != nil {
		return empty, err
	}
	if reason := policy.Check(actor.policyActor(), policy.ReadEmployees, policy.Resource{TeamID: actor.teamID}); reason != "" {
		return empty, denyPolicy(ctx, s.pool, tx, actor, policy.ReadEmployees, reason, activity.ErrDenied)
	}
	rows, err := tx.Query(ctx, `SELECT `+employeeFields+` FROM employees e JOIN teams t ON t.id=e.team_id
 WHERE e.id=$1 AND e.team_id=$2 AND e.active AND t.active
 AND (e.user_id IS NULL OR EXISTS (SELECT 1 FROM users u WHERE u.id=e.user_id AND u.team_id=e.team_id AND u.active))`, id, actor.teamID)
	if err != nil {
		return empty, err
	}
	e, err := pgx.CollectExactlyOneRow(rows, readEmployee)
	if errors.Is(err, pgx.ErrNoRows) {
		return empty, denyPolicy(ctx, s.pool, tx, actor, policy.ReadEmployees, "resource_unavailable", activity.ErrNotFound)
	}
	if err != nil {
		return empty, err
	}
	return e, tx.Commit(ctx)
}
