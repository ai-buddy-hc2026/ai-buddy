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

// denyPolicy откатывает операцию и сохраняет отказ отдельной транзакцией.
// Чужие и непроверенные ID объектов не попадают ни в FK, ни в payload.
func denyPolicy(ctx context.Context, pool *pgxpool.Pool, tx pgx.Tx, actor planActor, operation policy.Operation, reason string, denied error) error {
	rollbackOnboarding(tx)
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
