package database

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/json"
	"errors"
	"time"

	"github.com/ai-buddy-hc2026/ai-buddy/backend/internal/activity"
	"github.com/ai-buddy-hc2026/ai-buddy/backend/internal/auth"
	"github.com/ai-buddy-hc2026/ai-buddy/backend/internal/identifier"
	"github.com/ai-buddy-hc2026/ai-buddy/backend/internal/policy"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

type Listings struct {
	pool      *pgxpool.Pool
	cursorKey [32]byte
}

func NewListings(pool *pgxpool.Pool, key []byte) (*Listings, error) {
	if pool == nil || len(key) < 32 {
		return nil, activity.ErrInvalid
	}
	mac := hmac.New(sha256.New, key)
	_, _ = mac.Write([]byte("ai-buddy:list-cursor:v1"))
	s := &Listings{pool: pool}
	copy(s.cursorKey[:], mac.Sum(nil))
	return s, nil
}

func validListQuery(q activity.Query) bool {
	return q.Limit >= 1 && q.Limit <= 100 && len(q.Cursor) <= 2048 && (q.Status == "" || activity.ValidStatus(q.Status)) && (q.ConversationID == "" || identifier.ValidUUID(q.ConversationID))
}

func (s *Listings) ListInterns(ctx context.Context, actorID string, q activity.Query) (activity.InternPage, error) {
	page := activity.InternPage{Items: []auth.User{}}
	if !identifier.ValidUUID(actorID) || !validListQuery(q) || q.Status != "" || q.ConversationID != "" {
		return page, activity.ErrInvalid
	}
	tx, err := s.pool.BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.RepeatableRead})
	if err != nil {
		return page, err
	}
	defer rollbackOnboarding(tx)
	actor, err := loadPlanActor(ctx, tx, actorID, false)
	if err != nil {
		return page, err
	}
	if reason := policy.Check(actor.policyActor(), policy.ListBuddyInterns, policy.Resource{TeamID: actor.teamID, BuddyID: actor.id}); reason != "" {
		return page, denyPolicy(ctx, s.pool, tx, actor, policy.ListBuddyInterns, reason, activity.ErrDenied)
	}
	scope := listScope{Kind: "interns", Actor: actor.id, Team: actor.teamID}
	after := "00000000-0000-0000-0000-000000000000"
	if q.Cursor != "" {
		cursor, err := s.decodeCursor(q.Cursor, scope)
		if err != nil {
			return page, err
		}
		after = cursor.ID
	}
	rows, err := tx.Query(ctx, `SELECT u.id::text,u.login,u.display_name,u.role,t.id::text,t.code,t.name,t.timezone,
 COALESCE(u.timezone,t.timezone),u.buddy_id::text,u.manager_id::text
 FROM users u JOIN teams t ON t.id=u.team_id WHERE u.team_id=$1 AND u.buddy_id=$2 AND u.role='intern' AND u.active AND t.active AND u.id>$3 ORDER BY u.id LIMIT $4`, actor.teamID, actor.id, after, q.Limit+1)
	if err != nil {
		return page, err
	}
	items, err := pgx.CollectRows(rows, func(row pgx.CollectableRow) (auth.User, error) {
		var u auth.User
		err := row.Scan(&u.ID, &u.Login, &u.Name, &u.Role, &u.Team.ID, &u.Team.Code, &u.Team.Name, &u.Team.Timezone, &u.Timezone, &u.BuddyID, &u.ManagerID)
		return u, err
	})
	if err != nil {
		return page, err
	}
	if len(items) > q.Limit {
		cursor := s.encodeCursor(scope, items[q.Limit-1].ID, time.Time{})
		page.NextCursor = &cursor
		items = items[:q.Limit]
	}
	if items != nil {
		page.Items = items
	}
	return page, tx.Commit(ctx)
}

func (s *Listings) ListActions(ctx context.Context, actorID string, q activity.Query) (activity.ActionPage, error) {
	page := activity.ActionPage{Items: []activity.Action{}}
	if !identifier.ValidUUID(actorID) || !validListQuery(q) {
		return page, activity.ErrInvalid
	}
	tx, err := s.pool.BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.RepeatableRead})
	if err != nil {
		return page, err
	}
	defer rollbackOnboarding(tx)
	actor, err := loadPlanActor(ctx, tx, actorID, false)
	if err != nil {
		return page, err
	}
	if reason := policy.Check(actor.policyActor(), policy.ListActions, policy.Resource{TeamID: actor.teamID, OwnerID: actor.id}); reason != "" {
		return page, denyPolicy(ctx, s.pool, tx, actor, policy.ListActions, reason, activity.ErrDenied)
	}
	if q.ConversationID != "" {
		var id string
		err := tx.QueryRow(ctx, `SELECT id::text FROM conversations WHERE id=$1 AND owner_id=$2 AND team_id=$3`, q.ConversationID, actor.id, actor.teamID).Scan(&id)
		if errors.Is(err, pgx.ErrNoRows) {
			return page, denyPolicy(ctx, s.pool, tx, actor, policy.ListActions, "conversation_unavailable", activity.ErrNotFound)
		}
		if err != nil {
			return page, err
		}
	}
	scope := listScope{Kind: "actions", Actor: actor.id, Team: actor.teamID, Status: q.Status, Conversation: q.ConversationID}
	var beforeID *string
	var beforeTime *time.Time
	if q.Cursor != "" {
		cursor, err := s.decodeCursor(q.Cursor, scope)
		if err != nil {
			return page, err
		}
		beforeID = &cursor.ID
		beforeTime = &cursor.CreatedAt
	}
	rows, err := tx.Query(ctx, `SELECT a.id::text,a.request_id::text,a.proposal_seq,a.action_type,a.parameters,a.status,a.result,a.last_error,a.attempt_count,a.created_at,a.updated_at
 FROM actions_log a JOIN chat_requests r ON r.id=a.request_id AND r.user_id=a.actor_id AND r.team_id=a.team_id
 WHERE a.actor_id=$1 AND a.team_id=$2 AND ($3='' OR a.status=$3) AND ($4::uuid IS NULL OR r.conversation_id=$4)
 AND ($5::timestamptz IS NULL OR (a.created_at,a.id)<($5,$6::uuid)) ORDER BY a.created_at DESC,a.id DESC LIMIT $7`, actor.id, actor.teamID, q.Status, optionalID(q.ConversationID), beforeTime, beforeID, q.Limit+1)
	if err != nil {
		return page, err
	}
	items, err := pgx.CollectRows(rows, func(row pgx.CollectableRow) (activity.Action, error) { return readPublicAction(row) })
	if err != nil {
		return page, err
	}
	if len(items) > q.Limit {
		a := items[q.Limit-1]
		cursor := s.encodeCursor(scope, a.ID, a.CreatedAt)
		page.NextCursor = &cursor
		items = items[:q.Limit]
	}
	if items != nil {
		page.Items = items
	}
	return page, tx.Commit(ctx)
}

func optionalID(id string) any {
	if id == "" {
		return nil
	}
	return id
}

// actionPublicFields выдает только поля карточки, без произвольного служебного JSON.
func actionPublicFields(kind string, parameters, result json.RawMessage) (json.RawMessage, json.RawMessage, error) {
	allowed := map[string][]string{
		"absences.create_request": {"date", "type", "approver"},
		"checklist.update_status": {"task_id", "status", "version"},
		"escalation.create":       {"buddy_id", "question", "context_snapshot"},
	}
	resultAllowed := map[string][]string{
		"absences.create_request": {"action_id", "external_id", "status", "approver"},
		"checklist.update_status": {"task_id", "old_status", "status", "version", "updated_at"},
		"escalation.create":       {"id", "status", "buddy_id"},
	}
	filter := func(raw json.RawMessage, fields []string) (json.RawMessage, error) {
		var input map[string]json.RawMessage
		if err := json.Unmarshal(raw, &input); err != nil {
			return nil, err
		}
		output := make(map[string]json.RawMessage)
		for _, field := range fields {
			if value, ok := input[field]; ok {
				output[field] = value
			}
		}
		return json.Marshal(output)
	}
	details, err := filter(parameters, allowed[kind])
	if err != nil {
		return nil, nil, err
	}
	publicResult, err := filter(result, resultAllowed[kind])
	return details, publicResult, err
}

func readPublicAction(row pgx.Row) (activity.Action, error) {

	var a activity.Action
	var parameters, lastError json.RawMessage
	err := row.Scan(&a.ID, &a.RequestID, &a.ProposalSeq, &a.ActionType, &parameters, &a.Status, &a.Result, &lastError, &a.AttemptCount, &a.CreatedAt, &a.UpdatedAt)
	if err != nil {
		return a, err
	}
	a.Details, a.Result, err = actionPublicFields(a.ActionType, parameters, a.Result)
	if err != nil {
		return a, err
	}
	if len(lastError) > 0 && string(lastError) != "null" {
		a.LastError = &activity.ErrorDetail{Code: "TOOL_FAILED", Message: "Действие не выполнено. Повторите попытку после проверки параметров."}
		var detail activity.ErrorDetail
		if json.Unmarshal(lastError, &detail) == nil {
			switch detail.Code {
			case "VERSION_CONFLICT", "CONFLICT", "IDEMPOTENCY_CONFLICT", "DEPENDENCY_UNAVAILABLE", "TIMEOUT", "INTERNAL_ERROR":
				a.LastError = &activity.ErrorDetail{Code: detail.Code, Message: "Действие не выполнено: " + detail.Code}
			}
		}
	}
	a.CreatedAt = a.CreatedAt.UTC()
	a.UpdatedAt = a.UpdatedAt.UTC()
	return a, nil
}
