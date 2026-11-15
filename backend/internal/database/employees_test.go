package database

import (
	"context"
	_ "embed"
	"encoding/json"
	"errors"
	"io/fs"
	"os"
	"testing"
	"testing/fstest"

	"github.com/ai-buddy-hc2026/ai-buddy/backend/internal/activity"
	"github.com/ai-buddy-hc2026/ai-buddy/backend/internal/auth"
	"github.com/ai-buddy-hc2026/ai-buddy/backend/internal/employees"
)

// Независимая фикстура: полное наполнение Саши не меняет сценарии проверки прав.
//
//go:embed testdata/employees.json
var employeeTestSeed []byte

type employeeFixtureFS struct{ fs.FS }

func (f employeeFixtureFS) Open(name string) (fs.File, error) {
	if name == "seeds/employees.json" {
		return fstest.MapFS{name: &fstest.MapFile{Data: employeeTestSeed}}.Open(name)
	}
	return f.FS.Open(name)
}

func TestEmployeeSeedValidation(t *testing.T) {
	data := employeeTestSeed
	items, err := parseEmployeeSeed(data)
	if err != nil || len(items) != 8 {
		t.Fatalf("items=%d err=%v", len(items), err)
	}
	for _, change := range []func(map[string]any){
		func(e map[string]any) { e["kind"] = "admin" },
		func(e map[string]any) { e["user_id"] = "20000000-0000-4000-8000-000000000001" },
		func(e map[string]any) { e["active"] = nil },
		func(e map[string]any) { e["tags"] = []string{"деплой", " ДЕПЛОЙ "} },
		func(e map[string]any) { e["tags"] = []string{" "} },
		func(e map[string]any) { e["sort_order"] = -1 },
		func(e map[string]any) { e["login"] = "new_login" },
	} {
		var value map[string][]map[string]any
		if err := json.Unmarshal(data, &value); err != nil {
			t.Fatal(err)
		}
		change(value["employees"][0])
		invalid, _ := json.Marshal(value)
		if _, err := parseEmployeeSeed(invalid); err == nil {
			t.Fatal("invalid seed accepted")
		}
	}
	for _, invalid := range []string{`null`, `{}`, `{"employees":null}`, string(data) + `{}`} {
		if _, err := parseEmployeeSeed([]byte(invalid)); err == nil {
			t.Fatal("invalid JSON accepted")
		}
	}
}

func TestEmployeesScopePaginationAndSeed(t *testing.T) {
	pool := testPool(t)
	ctx := context.Background()
	checklistData, err := os.ReadFile("../../../seed/checklist.json")
	if err != nil {
		t.Fatal(err)
	}
	checklist, err := parseChecklist(checklistData)
	if err != nil {
		t.Fatal(err)
	}
	prepareFixture := func() error { return prepare(ctx, pool, employeeFixtureFS{scripts}, checklist) }
	if err := prepareFixture(); err != nil {
		t.Fatal(err)
	}
	s, err := NewListings(pool, []byte("synthetic-test-key-with-at-least-32-bytes"))
	if err != nil {
		t.Fatal(err)
	}
	anya := "a24a3478-cf42-51b1-b05b-9833260247a5"
	petr := "2db7cc77-4114-52d8-a833-f670ab60e4e0"
	oleg := "20000000-0000-4000-8000-000000000001"
	denis := "20000000-0000-4000-8000-000000000002"
	for _, actor := range []string{anya, "4a59a828-3b1a-55e4-bf9b-81db5ad6183a", "10000000-0000-0000-0000-000000000003"} {
		page, err := s.ListEmployees(ctx, actor, employees.Query{Search: "МОНИТОРИНГ", Limit: 50})
		if err != nil || len(page.Items) != 1 || page.Items[0].ID != oleg || page.Items[0].UserID != nil {
			t.Fatalf("page=%+v err=%v", page, err)
		}
	}
	seen := map[string]bool{}
	cursor := ""
	for range 4 {
		page, err := s.ListEmployees(ctx, anya, employees.Query{Limit: 1, Cursor: cursor})
		if err != nil || len(page.Items) != 1 || seen[page.Items[0].ID] {
			t.Fatalf("page=%+v err=%v", page, err)
		}
		seen[page.Items[0].ID] = true
		if page.NextCursor == nil {
			cursor = ""
		} else {
			cursor = *page.NextCursor
			for _, q := range []employees.Query{{Limit: 2, Cursor: cursor}, {Limit: 1, Search: "мониторинг", Cursor: cursor}, {Limit: 1, Cursor: cursor + "x"}} {
				if _, err := s.ListEmployees(ctx, anya, q); !errors.Is(err, employees.ErrInvalid) {
					t.Fatalf("cursor accepted: %v", err)
				}
			}
			if _, err := s.ListEmployees(ctx, petr, employees.Query{Limit: 1, Cursor: cursor}); !errors.Is(err, employees.ErrInvalid) {
				t.Fatalf("foreign cursor accepted: %v", err)
			}
		}
	}
	if len(seen) != 4 || cursor != "" {
		t.Fatalf("pagination: %v", seen)
	}
	for _, id := range []string{denis, "30000000-0000-4000-8000-000000000001"} {
		if _, err := s.GetEmployee(ctx, anya, id); !errors.Is(err, activity.ErrNotFound) {
			t.Fatalf("foreign/missing=%v", err)
		}
	}
	page, err := s.ListEmployees(ctx, anya, employees.Query{Limit: 50, Search: "%"})
	if err != nil || len(page.Items) != 0 {
		t.Fatal("wildcard escaped scope")
	}
	for _, query := range []string{
		`UPDATE employees SET team_id='e5aba0fd-91e6-59e4-a046-7960848af1a2' WHERE user_id='` + anya + `'`,
		`UPDATE employees SET user_id='` + anya + `' WHERE id='` + oleg + `'`,
		`UPDATE employees SET kind='admin' WHERE id='` + oleg + `'`,
	} {
		if _, err := pool.Exec(ctx, query); err == nil {
			t.Fatal("constraint accepted invalid employee")
		}
	}
	if _, err := pool.Exec(ctx, `UPDATE employees SET active=false,display_name='Изменено' WHERE id=$1`, oleg); err != nil {
		t.Fatal(err)
	}
	if err := prepareFixture(); err != nil {
		t.Fatal(err)
	}
	if _, err := s.GetEmployee(ctx, anya, oleg); !errors.Is(err, activity.ErrNotFound) {
		t.Fatalf("inactive card visible: %v", err)
	}
	var preserved bool
	if err := pool.QueryRow(ctx, `SELECT count(*)=8 AND bool_or(id=$1 AND NOT active AND display_name='Изменено') FROM employees`, oleg).Scan(&preserved); err != nil || !preserved {
		t.Fatalf("seed preservation: %v", err)
	}
	u := NewUsers(pool)
	if _, err := u.FindByID(ctx, oleg); !errors.Is(err, auth.ErrUnauthorized) {
		t.Fatalf("contact received login: %v", err)
	}
	if _, err := pool.Exec(ctx, `UPDATE users SET active=false WHERE id=$1`, anya); err != nil {
		t.Fatal(err)
	}
	if _, err := s.ListEmployees(ctx, anya, employees.Query{Limit: 50}); !errors.Is(err, auth.ErrUnauthorized) {
		t.Fatalf("inactive actor: %v", err)
	}
	if _, err := s.GetEmployee(ctx, "4a59a828-3b1a-55e4-bf9b-81db5ad6183a", anya); !errors.Is(err, activity.ErrNotFound) {
		t.Fatalf("inactive user card: %v", err)
	}
}
