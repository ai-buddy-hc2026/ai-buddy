package database

import (
	"context"
	"errors"
	"fmt"

	"github.com/ai-buddy-hc2026/ai-buddy/backend/internal/analytics"
	"github.com/ai-buddy-hc2026/ai-buddy/backend/internal/auth"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

const analyticsDays = 7

type Analytics struct{ pool *pgxpool.Pool }

func NewAnalytics(pool *pgxpool.Pool) *Analytics { return &Analytics{pool: pool} }

// Summary агрегирует данные БД в области видимости: lead - команда, buddy - назначенные стажёры.
func (s *Analytics) Summary(ctx context.Context, actorID string) (analytics.Summary, error) {
	var result analytics.Summary
	var role, teamID string
	err := s.pool.QueryRow(ctx, "SELECT role,team_id::text FROM users WHERE id=$1 AND active", actorID).Scan(&role, &teamID)
	if errors.Is(err, pgx.ErrNoRows) {
		return result, auth.ErrUnauthorized
	}
	if err != nil {
		return result, fmt.Errorf("load analytics actor: %w", err)
	}
	var scopeSQL string
	switch role {
	case "lead":
		result.Scope = "team"
		// $2 (actor) не нужен для команды, но запросы передают одинаковый набор аргументов.
		scopeSQL = "SELECT id FROM users WHERE team_id=$1 AND role='intern' AND active AND $2::uuid IS NOT NULL"
	case "buddy":
		result.Scope = "assigned"
		scopeSQL = "SELECT id FROM users WHERE team_id=$1 AND role='intern' AND active AND buddy_id=$2"
	default:
		return result, analytics.ErrDenied
	}
	err = s.pool.QueryRow(ctx, `WITH scope AS (`+scopeSQL+`),
answers AS (SELECT m.answer_status,m.sources FROM chat_messages m JOIN chat_requests r ON r.id=m.request_id
 WHERE m.role='assistant' AND r.team_id=$1 AND r.user_id IN (SELECT id FROM scope)),
acts AS (SELECT a.status,a.finished_at,r.created_at AS asked_at FROM actions_log a JOIN chat_requests r ON r.id=a.request_id
 WHERE a.team_id=$1 AND a.actor_id IN (SELECT id FROM scope)),
tasks_scope AS (SELECT status FROM tasks WHERE team_id=$1 AND assignee_id IN (SELECT id FROM scope))
SELECT (SELECT count(*) FROM scope),
 (SELECT count(*) FROM answers),
 (SELECT count(*) FROM answers WHERE answer_status='answered'),
 (SELECT count(*) FROM answers WHERE answer_status='unknown'),
 (SELECT count(*) FROM answers WHERE jsonb_array_length(sources)>0),
 (SELECT count(*) FROM escalations WHERE team_id=$1 AND intern_id IN (SELECT id FROM scope)),
 (SELECT count(*) FROM acts),
 (SELECT count(*) FROM acts WHERE status='succeeded'),
 (SELECT COALESCE(avg(extract(epoch FROM finished_at-asked_at)),0)::float8 FROM acts WHERE status='succeeded' AND finished_at IS NOT NULL),
 (SELECT count(*) FROM events WHERE team_id=$1 AND event_type='policy_denied' AND actor_id IN (SELECT id FROM scope)),
 (SELECT count(*) FROM tasks_scope),
 (SELECT count(*) FROM tasks_scope WHERE status='done')`, teamID, actorID).Scan(
		&result.Interns, &result.Questions, &result.Answered, &result.Unknown, &result.WithSources,
		&result.Escalations, &result.ActionsProposed, &result.ActionsSucceeded, &result.AvgActionSeconds,
		&result.PolicyDenied, &result.TasksTotal, &result.TasksDone)
	if err != nil {
		return result, fmt.Errorf("load analytics summary: %w", err)
	}
	days, err := s.days(ctx, scopeSQL, teamID, actorID)
	if err != nil {
		return result, err
	}
	result.Days = days
	return result.Complete(), nil
}

// days строит ряд за последние analyticsDays календарных дней по часовому поясу команды.
func (s *Analytics) days(ctx context.Context, scopeSQL, teamID, actorID string) ([]analytics.Day, error) {
	rows, err := s.pool.Query(ctx, `WITH scope AS (`+scopeSQL+`),
zone AS (SELECT timezone FROM teams WHERE id=$1),
series AS (SELECT generate_series((now() AT TIME ZONE (SELECT timezone FROM zone))::date-($3::int-1),(now() AT TIME ZONE (SELECT timezone FROM zone))::date,interval '1 day')::date AS day)
SELECT series.day::text,count(m.id),count(m.id) FILTER (WHERE m.answer_status='unknown')
FROM series LEFT JOIN chat_requests r ON r.team_id=$1 AND r.user_id IN (SELECT id FROM scope)
 AND (r.created_at AT TIME ZONE (SELECT timezone FROM zone))::date=series.day
LEFT JOIN chat_messages m ON m.request_id=r.id AND m.role='assistant'
GROUP BY series.day ORDER BY series.day`, teamID, actorID, analyticsDays)
	if err != nil {
		return nil, fmt.Errorf("load analytics days: %w", err)
	}
	defer rows.Close()
	days := make([]analytics.Day, 0, analyticsDays)
	for rows.Next() {
		var day analytics.Day
		if err := rows.Scan(&day.Date, &day.Questions, &day.Unknown); err != nil {
			return nil, fmt.Errorf("scan analytics day: %w", err)
		}
		days = append(days, day)
	}
	return days, rows.Err()
}
