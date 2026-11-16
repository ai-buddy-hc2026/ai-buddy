package database

import (
	"context"
	"encoding/json"
	"errors"
	"slices"
	"strings"
	"unicode/utf8"

	"github.com/ai-buddy-hc2026/ai-buddy/backend/internal/policy"
	"github.com/ai-buddy-hc2026/ai-buddy/backend/internal/tools"
	"github.com/jackc/pgx/v5"
)

const (
	maxEscalationQuestion   = 1000
	maxEscalationContext    = 6
	maxEscalationMessageLen = 2000
)

// escalationProposal - единственное поле, которое Python может передать в escalation.create.
// Наставника и контекст Go определяет сам, чтобы модель не могла их подменить.
type escalationProposal struct {
	Question string `json:"question"`
}

func decodeEscalationProposal(raw json.RawMessage) (escalationProposal, error) {
	var proposal escalationProposal
	if tools.Decode(raw, &proposal) != nil {
		return proposal, tools.ErrInvalid
	}
	proposal.Question = strings.TrimSpace(proposal.Question)
	if proposal.Question == "" || utf8.RuneCountInString(proposal.Question) > maxEscalationQuestion {
		return proposal, tools.ErrInvalid
	}
	return proposal, nil
}

// prepareEscalation собирает параметры, которые потом проверяет createEscalation при подтверждении.
func (s *Tools) prepareEscalation(ctx context.Context, tx pgx.Tx, actor planActor, requestID string, proposal escalationProposal) (json.RawMessage, error) {
	var buddyID string
	err := tx.QueryRow(ctx, `SELECT b.id::text FROM users i JOIN users b ON b.id=i.buddy_id AND b.team_id=i.team_id
 WHERE i.id=$1 AND b.active AND b.role='buddy'`, actor.id).Scan(&buddyID)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, denyPolicy(ctx, s.pool, tx, actor, policy.CreateEscalation, "buddy_unavailable", tools.ErrDenied)
	}
	if err != nil {
		return nil, err
	}
	rows, err := tx.Query(ctx, `SELECT m.id::text,m.role,m.content FROM chat_messages m
 JOIN chat_requests r ON r.id=m.request_id JOIN chat_requests origin ON origin.id=$1
 WHERE r.conversation_id=origin.conversation_id AND r.user_id=$2 AND r.team_id=$3
 AND (r.created_at,r.id)<=(origin.created_at,origin.id) AND m.sources='[]'::jsonb
 AND btrim(m.content)<>'' AND char_length(m.content)<=$4
 ORDER BY r.created_at DESC,r.id DESC,(m.role='assistant') DESC LIMIT $5`,
		requestID, actor.id, actor.teamID, maxEscalationMessageLen, maxEscalationContext)
	if err != nil {
		return nil, err
	}
	snapshot := make([]tools.ContextMessage, 0, maxEscalationContext)
	for rows.Next() {
		message := tools.ContextMessage{Sources: []json.RawMessage{}}
		if err := rows.Scan(&message.MessageID, &message.Role, &message.Content); err != nil {
			rows.Close()
			return nil, err
		}
		snapshot = append(snapshot, message)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return nil, err
	}
	slices.Reverse(snapshot)
	return json.Marshal(tools.EscalationParameters{BuddyID: buddyID, Question: proposal.Question, ContextSnapshot: snapshot})
}

// sameProposal сравнивает повтор события с уже сохраненным предложением.
func sameProposal(actionType string, saved, incoming json.RawMessage) bool {
	if policy.Operation(actionType) == policy.CreateEscalation {
		var stored tools.EscalationParameters
		next, err := decodeEscalationProposal(incoming)
		return err == nil && json.Unmarshal(saved, &stored) == nil && stored.Question == next.Question
	}
	var savedMap, incomingMap map[string]any
	if json.Unmarshal(saved, &savedMap) != nil || json.Unmarshal(incoming, &incomingMap) != nil {
		return false
	}
	delete(savedMap, "approver")
	savedJSON, _ := json.Marshal(savedMap)
	incomingJSON, _ := json.Marshal(incomingMap)
	return string(savedJSON) == string(incomingJSON)
}
