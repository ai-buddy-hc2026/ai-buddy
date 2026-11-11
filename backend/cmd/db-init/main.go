package main

import (
	"context"
	"log/slog"
	"os"
	"os/signal"
	"syscall"
	"time"
	_ "time/tzdata" // Проверка IANA timezone работает и в минимальном Docker-образе.

	"github.com/ai-buddy-hc2026/ai-buddy/backend/internal/database"
)

func main() {
	logger := slog.New(slog.NewJSONHandler(os.Stdout, nil))
	if err := run(); err != nil {
		logger.Error("database preparation failed", "error", err)
		os.Exit(1)
	}
	logger.Info("database migrations, user and checklist seed completed; KB document links remain deferred")
}

func run() error {
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	ctx, cancel := context.WithTimeout(ctx, time.Minute)
	defer cancel()
	pool, err := database.Open(ctx, os.Getenv("DATABASE_URL"))
	if err != nil {
		return err
	}
	defer pool.Close()
	seedPath := os.Getenv("CHECKLIST_SEED_PATH")
	if seedPath == "" {
		seedPath = "../seed/checklist.json"
	}
	return database.Prepare(ctx, pool, seedPath)
}
