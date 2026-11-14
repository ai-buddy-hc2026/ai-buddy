package database

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"github.com/ai-buddy-hc2026/ai-buddy/backend/internal/policy"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

func (actor planActor) policyActor() policy.Actor {
	return policy.Actor{ID: actor.id, TeamID: actor.teamID, Role: actor.role}
}

func planResource(actor planActor, owner string, buddy *string, assignee string) policy.Resource {
	resource := policy.Resource{TeamID: actor.teamID, OwnerID: owner, AssigneeID: assignee}
	if buddy != nil {
		resource.BuddyID = *buddy
	}
	return resource
}

func validPolicyEventOperation(operation policy.Operation) bool {
	switch operation {
	case policy.GetPlan, policy.UpdateStatus, policy.CreateChat, policy.ReadChat,
		policy.GetManager, policy.GetAbsencePolicy, policy.ListAbsences,
		policy.CreateAbsence, policy.CreateEscalation, policy.AnswerEscalation,
		policy.SearchKnowledge, policy.ListBuddyInterns, policy.ListActions:
		return true
	default:
		return false
	}
}

func validPolicyEventReason(reason string) bool {
	switch reason {
	case "invalid_actor", "role_denied", "team_denied",
		"owner_or_assignment_denied", "assignee_denied", "owner_denied",
		"assignment_denied", "operation_denied", "resource_unavailable",
		"action_unavailable", "confirmation_required", "buddy_unavailable",
		"source_unavailable", "context_unavailable", "assignment_changed",
		"conversation_unavailable":
		return true
	default:
		return false
	}
}

// denyPolicy откатывает операцию и сохраняет отказ отдельной транзакцией.
// Чужие и непроверенные ID объектов не попадают ни в FK, ни в payload.
func denyPolicy(ctx context.Context, pool *pgxpool.Pool, tx pgx.Tx, actor planActor, operation policy.Operation, reason string, denied error) error {
	rollbackOnboarding(tx)
	if !validPolicyEventOperation(operation) || !validPolicyEventReason(reason) {
		return fmt.Errorf("invalid policy denial event operation or reason")
	}
	auditCtx, cancel := context.WithTimeout(context.WithoutCancel(ctx), 5*time.Second)
	defer cancel()
	payload, err := json.Marshal(map[string]string{"operation": string(operation), "reason": reason})
	if err != nil {
		return fmt.Errorf("encode policy denial: %w", err)
	}
	_, err = pool.Exec(auditCtx, `INSERT INTO events (team_id,actor_id,event_type,payload) VALUES ($1,$2,'policy_denied',$3)`, actor.teamID, actor.id, payload)
	if err != nil {
		return fmt.Errorf("record policy denial: %w", err)
	}
	return denied
}
