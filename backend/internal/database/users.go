package database

import (
	"context"
	"errors"
	"fmt"

	"github.com/ai-buddy-hc2026/ai-buddy/backend/internal/auth"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

type Users struct {
	pool *pgxpool.Pool
}

func NewUsers(pool *pgxpool.Pool) *Users {
	return &Users{pool: pool}
}

func (s *Users) FindByLogin(ctx context.Context, login string) (auth.User, error) {
	return s.find(ctx, "u.login", login)
}

func (s *Users) FindByID(ctx context.Context, id string) (auth.User, error) {
	return s.find(ctx, "u.id", id)
}

func (s *Users) find(ctx context.Context, column, value string) (auth.User, error) {
	var u auth.User
	err := s.pool.QueryRow(ctx, `SELECT u.id::text, u.login, u.display_name, u.role,
		t.id::text, t.code, t.name, t.timezone, COALESCE(u.timezone, t.timezone),
		u.buddy_id::text, u.manager_id::text
		FROM users u JOIN teams t ON t.id = u.team_id
		WHERE u.active AND t.active AND `+column+` = $1`, value).Scan(
		&u.ID, &u.Login, &u.Name, &u.Role, &u.Team.ID, &u.Team.Code, &u.Team.Name,
		&u.Team.Timezone, &u.Timezone, &u.BuddyID, &u.ManagerID)
	if errors.Is(err, pgx.ErrNoRows) {
		return auth.User{}, auth.ErrUnauthorized
	}
	if err != nil {
		return auth.User{}, fmt.Errorf("find active user: %w", err)
	}
	return u, nil
}
