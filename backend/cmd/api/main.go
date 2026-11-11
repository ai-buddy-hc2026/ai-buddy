package main

import (
	"context"
	"log/slog"
	"net"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/ai-buddy-hc2026/ai-buddy/backend/internal/auth"
	"github.com/ai-buddy-hc2026/ai-buddy/backend/internal/config"
	"github.com/ai-buddy-hc2026/ai-buddy/backend/internal/database"
	"github.com/ai-buddy-hc2026/ai-buddy/backend/internal/httpapi"
	"github.com/ai-buddy-hc2026/ai-buddy/backend/internal/server"
)

func main() {
	if err := run(); err != nil {
		slog.New(slog.NewJSONHandler(os.Stderr, nil)).Error("application stopped", "error", err)
		os.Exit(1)
	}
}

func run() error {
	cfg, err := config.Load()
	if err != nil {
		return err
	}
	authCfg, err := config.LoadAuth()
	if err != nil {
		return err
	}
	logger := slog.New(slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{Level: cfg.LogLevel}))
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	listener, err := net.Listen("tcp", cfg.Address)
	if err != nil {
		return err
	}
	defer func() { _ = listener.Close() }()
	connectCtx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	pool, err := database.Open(connectCtx, cfg.DatabaseURL)
	if err != nil {
		return err
	}
	defer pool.Close()
	service, err := auth.New(database.NewUsers(pool), authCfg.SigningKey, authCfg.TokenTTL)
	if err != nil {
		return err
	}
	return server.Serve(ctx, listener, httpapi.NewHandler(logger, service), logger)
}
