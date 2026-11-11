package database

import (
	"context"
	"crypto/sha256"
	"embed"
	"errors"
	"fmt"
	"io/fs"
	"os"
	"slices"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

//go:embed migrations/*.sql seeds/*.sql
var scripts embed.FS

// Open проверяет соединение, не выводя реквизиты подключения в ошибках.
func Open(ctx context.Context, url string) (*pgxpool.Pool, error) {
	if url == "" {
		return nil, errors.New("DATABASE_URL is required")
	}
	pool, err := pgxpool.New(ctx, url)
	if err != nil {
		return nil, errors.New("invalid DATABASE_URL")
	}
	if err := pool.Ping(ctx); err != nil {
		pool.Close()
		return nil, errors.New("database connection failed")
	}
	return pool, nil
}

// Prepare применяет миграции и seed атомарно. Транзакционная блокировка
// сериализует несколько одновременно запущенных процессов инициализации.
func Prepare(ctx context.Context, pool *pgxpool.Pool, checklistPath string) error {
	data, err := os.ReadFile(checklistPath)
	if err != nil {
		return errors.New("cannot read checklist seed; check CHECKLIST_SEED_PATH")
	}
	seed, err := parseChecklist(data)
	if err != nil {
		return err
	}
	return prepare(ctx, pool, scripts, seed)
}

func prepare(ctx context.Context, pool *pgxpool.Pool, files fs.FS, checklist checklistSeed) error {
	tx, err := pool.Begin(ctx)
	if err != nil {
		return fmt.Errorf("begin database preparation: %w", err)
	}
	defer func() {
		cleanup, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		_ = tx.Rollback(cleanup)
	}()
	if _, err := tx.Exec(ctx, "SELECT pg_advisory_xact_lock(741902601)"); err != nil {
		return fmt.Errorf("lock migrations: %w", err)
	}
	if err := migrate(ctx, tx, files); err != nil {
		return err
	}
	seed, err := fs.ReadFile(files, "seeds/users.sql")
	if err != nil {
		return fmt.Errorf("read user seed: %w", err)
	}
	if _, err := tx.Exec(ctx, string(seed)); err != nil {
		return fmt.Errorf("seed users: %w", err)
	}
	if err := seedChecklist(ctx, tx, checklist); err != nil {
		return err
	}
	if err := tx.Commit(ctx); err != nil {
		return fmt.Errorf("commit database preparation: %w", err)
	}
	return nil
}

func migrate(ctx context.Context, tx pgx.Tx, files fs.FS) error {
	if _, err := tx.Exec(ctx, `CREATE TABLE IF NOT EXISTS schema_migrations (
		name text PRIMARY KEY, checksum text NOT NULL,
		applied_at timestamptz NOT NULL DEFAULT now())`); err != nil {
		return fmt.Errorf("create migration registry: %w", err)
	}
	names, err := fs.Glob(files, "migrations/*.sql")
	if err != nil || len(names) == 0 {
		return errors.New("no migration scripts")
	}
	slices.Sort(names)
	rows, err := tx.Query(ctx, "SELECT name FROM schema_migrations")
	if err != nil {
		return fmt.Errorf("read migration registry: %w", err)
	}
	applied, err := pgx.CollectRows(rows, pgx.RowTo[string])
	if err != nil {
		return fmt.Errorf("read applied migrations: %w", err)
	}
	for _, name := range applied {
		if !slices.Contains(names, name) {
			return fmt.Errorf("unknown applied migration %s; use a newer initializer", name)
		}
	}
	for _, name := range names {
		body, err := fs.ReadFile(files, name)
		if err != nil {
			return fmt.Errorf("read migration %s: %w", name, err)
		}
		checksum := fmt.Sprintf("%x", sha256.Sum256(body))
		var previous string
		err = tx.QueryRow(ctx, "SELECT checksum FROM schema_migrations WHERE name = $1", name).Scan(&previous)
		if err == nil {
			if previous != checksum {
				return fmt.Errorf("migration %s changed after application", name)
			}
			continue
		}
		if !errors.Is(err, pgx.ErrNoRows) {
			return fmt.Errorf("check migration %s: %w", name, err)
		}
		if _, err := tx.Exec(ctx, string(body)); err != nil {
			return fmt.Errorf("apply migration %s: %w", name, err)
		}
		if _, err := tx.Exec(ctx, "INSERT INTO schema_migrations (name, checksum) VALUES ($1, $2)", name, checksum); err != nil {
			return fmt.Errorf("record migration %s: %w", name, err)
		}
	}
	return nil
}
