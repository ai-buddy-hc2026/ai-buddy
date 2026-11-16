package scheduler

import (
	"context"
	"fmt"

	"github.com/ai-buddy-hc2026/ai-buddy/backend/internal/companion"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

type recipientLister interface {
	Recipients(context.Context) ([]companion.Recipient, error)
}

// PostgresSource читает снимок из БД: получателей, открытые задачи и дни рождения.
type PostgresSource struct {
	pool       *pgxpool.Pool
	recipients recipientLister
}

func NewPostgresSource(pool *pgxpool.Pool, recipients recipientLister) *PostgresSource {
	return &PostgresSource{pool: pool, recipients: recipients}
}

func (s *PostgresSource) Snapshot(ctx context.Context) (Snapshot, error) {
	recipients, err := s.recipients.Recipients(ctx)
	if err != nil {
		return Snapshot{}, err
	}
	rows, err := s.pool.Query(ctx, `SELECT t.id, t.team_id, t.assignee_id, t.seed_key, t.title, t.status,
			COALESCE(t.due_date::text, ''), t.updated_at
		FROM tasks t JOIN onboarding_plans p ON p.id = t.plan_id
		WHERE p.status = 'active' AND t.status <> 'done'`)
	if err != nil {
		return Snapshot{}, fmt.Errorf("list open tasks: %w", err)
	}
	tasks, err := pgx.CollectRows(rows, func(row pgx.CollectableRow) (Task, error) {
		var t Task
		err := row.Scan(&t.ID, &t.TeamID, &t.AssigneeID, &t.SeedKey, &t.Title, &t.Status, &t.DueDate, &t.UpdatedAt)
		return t, err
	})
	if err != nil {
		return Snapshot{}, fmt.Errorf("scan open tasks: %w", err)
	}
	rows, err = s.pool.Query(ctx, `SELECT u.id, u.team_id, u.display_name, b.month, b.day
		FROM user_birthdays b JOIN users u ON u.id = b.user_id WHERE u.active`)
	if err != nil {
		return Snapshot{}, fmt.Errorf("list birthdays: %w", err)
	}
	birthdays, err := pgx.CollectRows(rows, func(row pgx.CollectableRow) (Birthday, error) {
		var b Birthday
		err := row.Scan(&b.UserID, &b.TeamID, &b.Name, &b.Month, &b.Day)
		return b, err
	})
	if err != nil {
		return Snapshot{}, fmt.Errorf("scan birthdays: %w", err)
	}
	return Snapshot{Recipients: recipients, Tasks: tasks, Birthdays: birthdays}, nil
}
