package database

import (
	"context"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"
)

// ActionType отдает тип действия только владельцу; чужое или отсутствующее - пустая строка.
// Флаги V-10 используют его до подтверждения, права проверяет основной обработчик.
func (s *Tools) ActionType(ctx context.Context, actorID, actionID string) (string, error) {
	var actionType string
	err := s.pool.QueryRow(ctx, "SELECT action_type FROM actions_log WHERE id=$1 AND actor_id=$2", actionID, actorID).Scan(&actionType)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", nil
	}
	if err != nil {
		return "", fmt.Errorf("load action type: %w", err)
	}
	return actionType, nil
}
