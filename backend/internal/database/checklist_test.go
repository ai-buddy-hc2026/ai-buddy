package database

import (
	"context"
	"encoding/json"
	"io/fs"
	"os"
	"strings"
	"testing"
	"testing/fstest"
)

func checklistData(t *testing.T) []byte {
	t.Helper()
	data, err := os.ReadFile("../../../seed/checklist.json")
	if err != nil {
		t.Fatal(err)
	}
	return data
}

func TestChecklistValidation(t *testing.T) {
	data := checklistData(t)
	seed, err := parseChecklist(data)
	if err != nil || len(seed.Plans) != 2 || len(seed.Tasks) != 30 || len(seed.Links) != 26 {
		t.Fatalf("invalid repository seed: plans=%d tasks=%d links=%d err=%v", len(seed.Plans), len(seed.Tasks), len(seed.Links), err)
	}
	for name, mutate := range map[string]func(*checklistSeed){
		"format":             func(s *checklistSeed) { s.Format = "unknown" },
		"date":               func(s *checklistSeed) { s.StartDate = "2026-02-30" },
		"team":               func(s *checklistSeed) { s.Plans[0].TeamID = s.Plans[1].TeamID },
		"zero UUID":          func(s *checklistSeed) { s.Tasks[0].ID = "00000000-0000-0000-0000-000000000000" },
		"duplicate ID":       func(s *checklistSeed) { s.Tasks[1].ID = s.Tasks[0].ID },
		"duplicate key":      func(s *checklistSeed) { s.Tasks[1].SeedKey = s.Tasks[0].SeedKey },
		"duplicate position": func(s *checklistSeed) { s.Tasks[1].Position = s.Tasks[0].Position },
		"status":             func(s *checklistSeed) { s.Tasks[0].Status = "done" },
		"version":            func(s *checklistSeed) { s.Tasks[0].Version = 2 },
		"due date":           func(s *checklistSeed) { date := "2026-02-30"; s.Tasks[0].DueDate = &date },
		"link team":          func(s *checklistSeed) { s.Links[0].TeamID = s.Plans[1].TeamID },
		"link task":          func(s *checklistSeed) { s.Links[0].TaskID = s.Plans[0].ID },
		"document namespace": func(s *checklistSeed) { s.Links[0].DocumentID = s.Tasks[0].ID },
		"duplicate link":     func(s *checklistSeed) { s.Links = append(s.Links, s.Links[0]) },
	} {
		t.Run(name, func(t *testing.T) {
			var changed checklistSeed
			if err := json.Unmarshal(data, &changed); err != nil {
				t.Fatal(err)
			}
			mutate(&changed)
			encoded, err := json.Marshal(changed)
			if err != nil {
				t.Fatal(err)
			}
			if _, err := parseChecklist(encoded); err == nil {
				t.Fatal("invalid seed accepted")
			}
		})
	}
	for _, invalid := range [][]byte{[]byte(`{`), append(append([]byte{}, data...), []byte(` {}`)...), []byte(`{"format":"ai-buddy-seed-v1","unknown":true}`)} {
		if _, err := parseChecklist(invalid); err == nil {
			t.Fatal("malformed JSON accepted")
		}
	}
}

func TestChecklistRepeatPreservesChanges(t *testing.T) {
	pool := testPool(t)
	ctx := context.Background()
	if err := Prepare(ctx, pool, "../../../seed/checklist.json"); err != nil {
		t.Fatal(err)
	}
	seed, err := parseChecklist(checklistData(t))
	if err != nil {
		t.Fatal(err)
	}
	task := seed.Tasks[0]
	if _, err := pool.Exec(ctx, `UPDATE tasks SET status='done', version=2, title='Изменено', assignee_id=$2,
		updated_at='2026-11-12T00:00:00Z' WHERE id=$1`, task.ID, seed.Plans[0].InternID); err != nil {
		t.Fatal(err)
	}
	if _, err := pool.Exec(ctx, `INSERT INTO task_status_history (task_id,version,from_status,to_status,changed_by)
		VALUES ($1,2,'todo','done',$2)`, task.ID, seed.Plans[0].InternID); err != nil {
		t.Fatal(err)
	}
	if _, err := pool.Exec(ctx, `UPDATE onboarding_plans SET status='archived', title='Архив', current_stage='week_2' WHERE id=$1`, seed.Plans[0].ID); err != nil {
		t.Fatal(err)
	}
	if err := Prepare(ctx, pool, "../../../seed/checklist.json"); err != nil {
		t.Fatal(err)
	}
	var preserved bool
	if err := pool.QueryRow(ctx, `SELECT status='done' AND version=2 AND title='Изменено' AND assignee_id=$2
		AND updated_at='2026-11-12T00:00:00Z' FROM tasks WHERE id=$1`, task.ID, seed.Plans[0].InternID).Scan(&preserved); err != nil || !preserved {
		t.Fatalf("task overwritten: %v, %v", preserved, err)
	}
	if err := pool.QueryRow(ctx, `SELECT status='archived' AND title='Архив' AND current_stage='week_2' FROM onboarding_plans WHERE id=$1`, seed.Plans[0].ID).Scan(&preserved); err != nil || !preserved {
		t.Fatalf("plan overwritten: %v, %v", preserved, err)
	}
	var count int
	if err := pool.QueryRow(ctx, "SELECT count(*) FROM task_status_history").Scan(&count); err != nil || count != 31 {
		t.Fatalf("history count=%d err=%v", count, err)
	}
	for _, query := range []string{
		"UPDATE tasks SET assignee_id=(SELECT id FROM users WHERE login='intern_petr') WHERE plan_id=(SELECT id FROM onboarding_plans WHERE intern_id=(SELECT id FROM users WHERE login='intern_anya'))",
		"UPDATE tasks SET version=0",
		"UPDATE tasks SET status='invalid'",
		"UPDATE onboarding_plans SET status='completed', completed_at=NULL",
		"UPDATE task_status_history SET from_status='todo' WHERE version=1",
		"UPDATE task_status_history SET from_status=to_status WHERE version=2",
		"INSERT INTO onboarding_plans (team_id,intern_id,title,start_date,current_stage) SELECT team_id,intern_id,'Дубль',start_date,current_stage FROM onboarding_plans WHERE status='active'",
	} {
		if _, err := pool.Exec(ctx, query); err == nil {
			t.Errorf("constraint accepted: %s", query)
		}
	}
}

func TestChecklistUpgradeAndRollback(t *testing.T) {
	pool := testPool(t)
	ctx := context.Background()
	legacy := fstest.MapFS{}
	for _, path := range []string{"migrations/0001_users.sql", "seeds/users.sql"} {
		data, err := fs.ReadFile(scripts, path)
		if err != nil {
			t.Fatal(err)
		}
		legacy[path] = &fstest.MapFile{Data: data}
	}
	// Воспроизводим уже примененную 0001 и seed старой версии.
	tx, err := pool.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if err := migrate(ctx, tx, legacy); err != nil {
		t.Fatal(err)
	}
	if _, err := tx.Exec(ctx, string(legacy["seeds/users.sql"].Data)); err != nil {
		t.Fatal(err)
	}
	if err := tx.Commit(ctx); err != nil {
		t.Fatal(err)
	}
	if _, err := pool.Exec(ctx, "UPDATE users SET display_name='Сохранено' WHERE login='intern_anya'"); err != nil {
		t.Fatal(err)
	}
	seed, err := parseChecklist(checklistData(t))
	if err != nil {
		t.Fatal(err)
	}
	seed.Tasks[0].AssigneeID = "10000000-0000-0000-0000-000000000006"
	if err := prepare(ctx, pool, scripts, seed); err == nil || !strings.Contains(err.Error(), "assigned buddy") {
		t.Fatalf("invalid assignee accepted: %v", err)
	}
	var rolledBack bool
	if err := pool.QueryRow(ctx, "SELECT to_regclass('tasks') IS NULL AND (SELECT count(*) FROM schema_migrations)=1").Scan(&rolledBack); err != nil || !rolledBack {
		t.Fatalf("upgrade not rolled back: %v, %v", rolledBack, err)
	}
	if err := Prepare(ctx, pool, "../../../seed/checklist.json"); err != nil {
		t.Fatal(err)
	}
	var preserved bool
	if err := pool.QueryRow(ctx, "SELECT display_name='Сохранено' FROM users WHERE login='intern_anya'").Scan(&preserved); err != nil || !preserved {
		t.Fatalf("user overwritten: %v, %v", preserved, err)
	}
	if err := Prepare(ctx, pool, "missing-checklist.json"); err == nil {
		t.Fatal("missing seed accepted")
	}
}

func checklistFixture(t *testing.T) checklistSeed {
	t.Helper()
	seed, err := parseChecklist(checklistData(t))
	if err != nil {
		t.Fatal(err)
	}
	return seed
}
