package database

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"unicode/utf8"

	"github.com/ai-buddy-hc2026/ai-buddy/backend/internal/identifier"
	"github.com/ai-buddy-hc2026/ai-buddy/backend/internal/policy"
	"github.com/ai-buddy-hc2026/ai-buddy/backend/internal/tools"
	"github.com/jackc/pgx/v5"
)

func (s *Tools) createEscalation(ctx context.Context, tx pgx.Tx, actor planActor, requestID, actionID string, action toolAction) (any, error) {
	var params tools.EscalationParameters
	if tools.Decode(action.parameters, &params) != nil || !identifier.ValidUUID(params.BuddyID) || strings.TrimSpace(params.Question) == "" || utf8.RuneCountInString(params.Question) > 4000 || params.ContextSnapshot == nil || len(params.ContextSnapshot) > 10 {
		return nil, tools.ErrInvalid
	}
	var buddyID string
	err := tx.QueryRow(ctx, `SELECT b.id::text FROM users i JOIN users b ON b.id=i.buddy_id AND b.team_id=i.team_id
 WHERE i.id=$1 AND b.id=$2 AND b.active AND b.role='buddy' FOR SHARE OF b`, actor.id, params.BuddyID).Scan(&buddyID)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, denyPolicy(ctx, s.pool, tx, actor, policy.CreateEscalation, "buddy_unavailable", tools.ErrDenied)
	}
	if err != nil {
		return nil, err
	}
	seen := make(map[string]bool)
	chars := 0
	for _, message := range params.ContextSnapshot {
		chars += utf8.RuneCountInString(message.Content)
		if !identifier.ValidUUID(message.MessageID) || seen[message.MessageID] || (message.Role != "user" && message.Role != "assistant") || message.Sources == nil || chars > 20000 {
			return nil, tools.ErrInvalid
		}
		seen[message.MessageID] = true
		// В профиле чата #24 нет доступной KB: до ее интеграции источники не передаем.
		if len(message.Sources) != 0 {
			return nil, denyPolicy(ctx, s.pool, tx, actor, policy.CreateEscalation, "source_unavailable", tools.ErrDenied)
		}
		var allowed bool
		err := tx.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM chat_messages m JOIN chat_requests r ON r.id=m.request_id
 JOIN chat_requests origin ON origin.id=$1 JOIN actions_log a ON a.id=$2
 WHERE m.id=$3 AND r.conversation_id=origin.conversation_id AND r.user_id=$4 AND r.team_id=$5
 AND (r.created_at,r.id)<=(origin.created_at,origin.id) AND m.created_at<=a.confirmed_at
 AND m.role=$6 AND m.content=$7 AND m.sources='[]'::jsonb)`, requestID, actionID, message.MessageID, actor.id, actor.teamID, message.Role, message.Content).Scan(&allowed)
		if err != nil {
			return nil, err
		}
		if !allowed {
			return nil, denyPolicy(ctx, s.pool, tx, actor, policy.CreateEscalation, "context_unavailable", tools.ErrDenied)
		}
	}
	snapshot, err := json.Marshal(params.ContextSnapshot)
	if err != nil {
		return nil, err
	}
	result := tools.EscalationResult{Status: "open", BuddyID: buddyID}
	err = tx.QueryRow(ctx, `INSERT INTO escalations(team_id,action_id,intern_id,buddy_id,question,context_snapshot)
 VALUES($1,$2,$3,$4,$5,$6) RETURNING id::text`, actor.teamID, actionID, actor.id, buddyID, params.Question, snapshot).Scan(&result.ID)
	if err != nil {
		return nil, err
	}
	_, err = tx.Exec(ctx, `INSERT INTO events(team_id,actor_id,request_id,action_id,event_type,dedup_key)
 VALUES($1,$2,$3,$4,'escalation_created',$5)`, actor.teamID, actor.id, requestID, actionID, "escalation:"+result.ID+":created")
	return result, err
}
