package database

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"strings"
	"time"

	"github.com/ai-buddy-hc2026/ai-buddy/backend/internal/identifier"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
)

type checklistSeed struct {
	Format    string         `json:"format"`
	StartDate string         `json:"start_date"`
	Teams     []seedTeam     `json:"teams"`
	Plans     []seedPlan     `json:"onboarding_plans"`
	Tasks     []seedTask     `json:"tasks"`
	Links     []seedDocument `json:"task_kb_documents"`
}

type seedTeam struct {
	ID        string    `json:"id"`
	Code      string    `json:"code"`
	Name      string    `json:"name"`
	Timezone  string    `json:"timezone"`
	Active    bool      `json:"active"`
	UpdatedAt time.Time `json:"updated_at"`
}

type seedPlan struct {
	ID        string `json:"id"`
	TeamID    string `json:"team_id"`
	InternID  string `json:"intern_id"`
	Title     string `json:"title"`
	StartDate string `json:"start_date"`
	Stage     string `json:"current_stage"`
	Status    string `json:"status"`
}

type seedTask struct {
	ID          string    `json:"id"`
	TeamID      string    `json:"team_id"`
	PlanID      string    `json:"plan_id"`
	AssigneeID  string    `json:"assignee_id"`
	SeedKey     string    `json:"seed_key"`
	Stage       string    `json:"stage"`
	Title       string    `json:"title"`
	Description string    `json:"description"`
	Position    int       `json:"position"`
	DueDate     *string   `json:"due_date"`
	Status      string    `json:"status"`
	Version     int       `json:"version"`
	UpdatedAt   time.Time `json:"updated_at"`
}

type seedDocument struct {
	TaskID     string `json:"task_id"`
	DocumentID string `json:"document_id"`
	TeamID     string `json:"team_id"`
	Position   int    `json:"position"`
}

func parseChecklist(data []byte) (checklistSeed, error) {
	var seed checklistSeed
	decoder := json.NewDecoder(bytes.NewReader(data))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&seed); err != nil {
		return seed, errors.New("invalid checklist seed JSON")
	}
	if decoder.Decode(&struct{}{}) != io.EOF {
		return seed, errors.New("checklist seed must contain one JSON object")
	}
	if seed.Format != "ai-buddy-seed-v1" || !seedDate(seed.StartDate) || len(seed.Teams) == 0 || len(seed.Plans) == 0 || len(seed.Tasks) == 0 {
		return seed, errors.New("invalid checklist seed header or empty data")
	}
	ids := make(map[string]bool)
	unique := func(id string) bool {
		if !identifier.ValidUUID(id) || ids[id] {
			return false
		}
		ids[id] = true
		return true
	}
	teams := make(map[string]bool)
	codes := make(map[string]bool)
	for _, team := range seed.Teams {
		if !unique(team.ID) || strings.TrimSpace(team.Code) == "" || codes[team.Code] || strings.TrimSpace(team.Name) == "" {
			return seed, errors.New("invalid or duplicate checklist team")
		}
		if _, err := time.LoadLocation(team.Timezone); err != nil || team.UpdatedAt.IsZero() {
			return seed, errors.New("invalid checklist team timezone or timestamp")
		}
		teams[team.ID], codes[team.Code] = true, true
	}
	plans := make(map[string]seedPlan)
	interns := make(map[string]bool)
	for _, plan := range seed.Plans {
		if !unique(plan.ID) || !teams[plan.TeamID] || !identifier.ValidUUID(plan.InternID) || interns[plan.InternID] || strings.TrimSpace(plan.Title) == "" ||
			!seedDate(plan.StartDate) || plan.StartDate != seed.StartDate || !seedStage(plan.Stage) || plan.Status != "active" {
			return seed, errors.New("invalid or duplicate checklist plan")
		}
		plans[plan.ID], interns[plan.InternID] = plan, true
	}
	tasks := make(map[string]seedTask)
	keys, positions := make(map[string]bool), make(map[string]bool)
	for _, task := range seed.Tasks {
		plan, ok := plans[task.PlanID]
		key := task.PlanID + ":" + task.SeedKey
		position := fmt.Sprintf("%s:%s:%d", task.PlanID, task.Stage, task.Position)
		if !unique(task.ID) || !ok || task.TeamID != plan.TeamID || !identifier.ValidUUID(task.AssigneeID) || strings.TrimSpace(task.SeedKey) == "" ||
			keys[key] || positions[position] || !seedStage(task.Stage) || strings.TrimSpace(task.Title) == "" || task.Position < 0 ||
			task.Status != "todo" || task.Version != 1 || task.UpdatedAt.IsZero() {
			return seed, errors.New("invalid or duplicate checklist task")
		}
		if task.DueDate != nil && (!seedDate(*task.DueDate) || *task.DueDate < plan.StartDate) {
			return seed, errors.New("invalid checklist task due date")
		}
		tasks[task.ID], keys[key], positions[position] = task, true, true
	}
	links, linkPositions := make(map[string]bool), make(map[string]bool)
	for _, link := range seed.Links {
		task, ok := tasks[link.TaskID]
		key := link.TaskID + ":" + link.DocumentID
		position := fmt.Sprintf("%s:%d", link.TaskID, link.Position)
		if !ok || task.TeamID != link.TeamID || !identifier.ValidUUID(link.DocumentID) || ids[link.DocumentID] || link.Position < 0 || links[key] || linkPositions[position] {
			return seed, errors.New("invalid or duplicate checklist document link")
		}
		links[key], linkPositions[position] = true, true
	}
	return seed, nil
}

func seedDate(value string) bool {
	_, err := time.Parse(time.DateOnly, value)
	return err == nil
}

func seedStage(value string) bool {
	return value == "week_1" || value == "week_2" || value == "weeks_3_4"
}

func seedChecklist(ctx context.Context, tx pgx.Tx, seed checklistSeed) error {
	for _, team := range seed.Teams {
		var matches bool
		if err := tx.QueryRow(ctx, "SELECT EXISTS (SELECT 1 FROM teams WHERE id=$1 AND code=$2)", team.ID, team.Code).Scan(&matches); err != nil || !matches {
			return fmt.Errorf("checklist team %s does not match user seed", team.ID)
		}
	}
	for _, plan := range seed.Plans {
		var existing bool
		if err := tx.QueryRow(ctx, "SELECT EXISTS (SELECT 1 FROM onboarding_plans WHERE id=$1)", plan.ID).Scan(&existing); err != nil {
			return fmt.Errorf("check seed plan: %w", err)
		}
		if existing {
			var matches bool
			if err := tx.QueryRow(ctx, "SELECT team_id=$2 AND intern_id=$3 FROM onboarding_plans WHERE id=$1", plan.ID, plan.TeamID, plan.InternID).Scan(&matches); err != nil || !matches {
				return fmt.Errorf("seed plan %s has a different owner", plan.ID)
			}
			continue
		}
		startDate, _ := time.Parse(time.DateOnly, plan.StartDate) // Дата проверена parseChecklist.
		result, err := tx.Exec(ctx, `INSERT INTO onboarding_plans (id, team_id, intern_id, title, start_date, current_stage, status)
			SELECT $1, $2, id, $4, $5::date, $6, $7 FROM users WHERE id=$3 AND team_id=$2 AND role='intern'`,
			plan.ID, plan.TeamID, plan.InternID, plan.Title, pgtype.Date{Time: startDate, Valid: true}, plan.Stage, plan.Status)
		if err != nil {
			return fmt.Errorf("insert seed plan: %w", err)
		}
		if result.RowsAffected() != 1 {
			return fmt.Errorf("seed plan %s requires an intern from its team", plan.ID)
		}
	}
	for _, task := range seed.Tasks {
		var existing bool
		if err := tx.QueryRow(ctx, "SELECT EXISTS (SELECT 1 FROM tasks WHERE id=$1)", task.ID).Scan(&existing); err != nil {
			return fmt.Errorf("check seed task: %w", err)
		}
		if existing {
			var matches bool
			if err := tx.QueryRow(ctx, "SELECT team_id=$2 AND plan_id=$3 AND seed_key=$4 FROM tasks WHERE id=$1", task.ID, task.TeamID, task.PlanID, task.SeedKey).Scan(&matches); err != nil || !matches {
				return fmt.Errorf("seed task %s has a different plan or seed key", task.ID)
			}
			continue
		}
		var allowed bool
		if err := tx.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM users actor JOIN onboarding_plans p ON p.team_id=actor.team_id
			JOIN users intern ON intern.id=p.intern_id WHERE p.id=$1 AND actor.id=$2 AND
			((actor.id=intern.id AND actor.role='intern') OR (actor.id=intern.buddy_id AND actor.role='buddy')))`, task.PlanID, task.AssigneeID).Scan(&allowed); err != nil || !allowed {
			return fmt.Errorf("seed task %s requires its intern or assigned buddy", task.ID)
		}
		dueDate := pgtype.Date{}
		if task.DueDate != nil {
			date, _ := time.Parse(time.DateOnly, *task.DueDate) // Дата проверена parseChecklist.
			dueDate = pgtype.Date{Time: date, Valid: true}
		}
		if _, err := tx.Exec(ctx, `INSERT INTO tasks (id, team_id, plan_id, assignee_id, seed_key, stage, title, description, position, due_date, status, version, updated_at)
			VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::date,$11,$12,$13)`, task.ID, task.TeamID, task.PlanID, task.AssigneeID,
			task.SeedKey, task.Stage, task.Title, task.Description, task.Position, dueDate, task.Status, task.Version, task.UpdatedAt); err != nil {
			return fmt.Errorf("insert seed task: %w", err)
		}
		if _, err := tx.Exec(ctx, `INSERT INTO task_status_history (task_id, version, from_status, to_status, reason)
			VALUES ($1,1,NULL,$2,'seed')`, task.ID, task.Status); err != nil {
			return fmt.Errorf("insert seed task history: %w", err)
		}
	}
	return nil
}
