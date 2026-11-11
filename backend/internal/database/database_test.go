package database

import (
	"context"
	"crypto/sha256"
	"fmt"
	"io/fs"
	"os"
	"strings"
	"sync"
	"testing"
	"testing/fstest"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

func testPool(t *testing.T) *pgxpool.Pool {
	t.Helper()
	url := os.Getenv("TEST_DATABASE_URL")
	if url == "" {
		t.Skip("TEST_DATABASE_URL is not set")
	}
	ctx := context.Background()
	admin, err := Open(ctx, url)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(admin.Close)
	schema := fmt.Sprintf("test_%d", time.Now().UnixNano())
	if _, err := admin.Exec(ctx, "CREATE SCHEMA "+schema); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if _, err := admin.Exec(ctx, "DROP SCHEMA "+schema+" CASCADE"); err != nil {
			t.Error(err)
		}
	})
	cfg, err := pgxpool.ParseConfig(url)
	if err != nil {
		t.Fatal(err)
	}
	cfg.ConnConfig.RuntimeParams["search_path"] = schema
	pool, err := pgxpool.NewWithConfig(ctx, cfg)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(pool.Close)
	return pool
}

func TestPrepareRepeatAndConstraints(t *testing.T) {
	pool := testPool(t)
	ctx := context.Background()
	var wg sync.WaitGroup
	for range 2 {
		wg.Go(func() {
			if err := Prepare(ctx, pool, "../../../seed/checklist.json"); err != nil {
				t.Error(err)
			}
		})
	}
	wg.Wait()
	for table, want := range map[string]int{"teams": 2, "users": 6, "schema_migrations": 5, "onboarding_plans": 2, "tasks": 30, "task_status_history": 30, "actions_log": 0, "absence_requests": 0} {
		var got int
		if err := pool.QueryRow(ctx, "SELECT count(*) FROM "+table).Scan(&got); err != nil || got != want {
			t.Fatalf("%s count=%d, want=%d, err=%v", table, got, want, err)
		}
	}
	if _, err := pool.Exec(ctx, "UPDATE users SET active=false, display_name='Изменено', updated_at='2026-11-11T00:00:00Z' WHERE login='intern_anya'"); err != nil {
		t.Fatal(err)
	}
	if err := Prepare(ctx, pool, "../../../seed/checklist.json"); err != nil {
		t.Fatal(err)
	}
	var preserved bool
	if err := pool.QueryRow(ctx, "SELECT NOT active AND display_name='Изменено' AND updated_at='2026-11-11T00:00:00Z' FROM users WHERE login='intern_anya'").Scan(&preserved); err != nil || !preserved {
		t.Fatalf("seed overwrote user: preserved=%v err=%v", preserved, err)
	}
	for _, query := range []string{
		"UPDATE users SET buddy_id=(SELECT id FROM users WHERE login='buddy_olga') WHERE login='intern_anya'",
		"UPDATE users SET manager_id=id WHERE login='intern_anya'",
		"UPDATE users SET role='admin' WHERE login='intern_anya'",
		"UPDATE users SET login='UPPER' WHERE login='intern_anya'",
		"UPDATE users SET login='buddy_ilya' WHERE login='intern_anya'",
		"UPDATE users SET display_name='  ' WHERE login='intern_anya'",
		"DELETE FROM teams WHERE code='team_avito_ai'",
	} {
		if _, err := pool.Exec(ctx, query); err == nil {
			t.Errorf("constraint accepted: %s", query)
		}
	}
}

func TestPrepareRollbackAndChecksum(t *testing.T) {
	pool := testPool(t)
	ctx := context.Background()
	files := fstest.MapFS{}
	if err := fs.WalkDir(scripts, ".", func(path string, d fs.DirEntry, err error) error {
		if err != nil || d.IsDir() {
			return err
		}
		data, err := fs.ReadFile(scripts, path)
		files[path] = &fstest.MapFile{Data: data}
		return err
	}); err != nil {
		t.Fatal(err)
	}
	seed := files["seeds/users.sql"]
	files["seeds/users.sql"] = &fstest.MapFile{Data: []byte("SELECT missing_column FROM users;")}
	if err := prepare(ctx, pool, files, checklistFixture(t)); err == nil {
		t.Fatal("expected seed failure")
	}
	var absent bool
	if err := pool.QueryRow(ctx, "SELECT to_regclass('users') IS NULL AND to_regclass('schema_migrations') IS NULL").Scan(&absent); err != nil || !absent {
		t.Fatalf("failed preparation was not rolled back: %v, %v", absent, err)
	}
	files["seeds/users.sql"] = seed
	if err := prepare(ctx, pool, files, checklistFixture(t)); err != nil {
		t.Fatal(err)
	}
	files["migrations/0001_users.sql"].Data = append(files["migrations/0001_users.sql"].Data, []byte("\n-- changed\n")...)
	if err := prepare(ctx, pool, files, checklistFixture(t)); err == nil || !strings.Contains(err.Error(), "changed after application") {
		t.Fatalf("expected checksum error, got %v", err)
	}
}

func TestOpenInvalidURL(t *testing.T) {
	for _, url := range []string{"", "://secret@example.com"} {
		if pool, err := Open(context.Background(), url); err == nil || pool != nil || strings.Contains(err.Error(), "secret") {
			t.Fatalf("expected safe connection error, got %v", err)
		}
	}
}

func TestMigrationChecksumAcrossLineEndings(t *testing.T) {
	pool := testPool(t)
	ctx := context.Background()
	if err := Prepare(ctx, pool, "../../../seed/checklist.json"); err != nil {
		t.Fatal(err)
	}
	body, err := fs.ReadFile(scripts, "migrations/0002_onboarding.sql")
	if err != nil {
		t.Fatal(err)
	}
	lf := strings.ReplaceAll(string(body), "\r\n", "\n")
	legacy := fmt.Sprintf("%x", sha256.Sum256([]byte(strings.ReplaceAll(lf, "\n", "\r\n"))))
	if _, err := pool.Exec(ctx, "UPDATE schema_migrations SET checksum=$1 WHERE name='migrations/0002_onboarding.sql'", legacy); err != nil {
		t.Fatal(err)
	}
	if err := Prepare(ctx, pool, "../../../seed/checklist.json"); err != nil {
		t.Fatalf("equivalent CRLF migration rejected: %v", err)
	}
	if _, err := pool.Exec(ctx, "UPDATE schema_migrations SET checksum='different-content' WHERE name='migrations/0002_onboarding.sql'"); err != nil {
		t.Fatal(err)
	}
	if err := Prepare(ctx, pool, "../../../seed/checklist.json"); err == nil {
		t.Fatal("changed migration accepted")
	}
}
