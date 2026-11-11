package main

import (
	"context"
	"fmt"
	"log/slog"
	"net"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/ai-buddy-hc2026/ai-buddy/backend/internal/auth"
	"github.com/ai-buddy-hc2026/ai-buddy/backend/internal/chat"
	"github.com/ai-buddy-hc2026/ai-buddy/backend/internal/config"
	"github.com/ai-buddy-hc2026/ai-buddy/backend/internal/database"
	"github.com/ai-buddy-hc2026/ai-buddy/backend/internal/httpapi"
	"github.com/ai-buddy-hc2026/ai-buddy/backend/internal/mcpserver"
	"github.com/ai-buddy-hc2026/ai-buddy/backend/internal/server"
	"github.com/redis/go-redis/v9"
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
	mcpCfg, err := config.LoadMCP()
	if err != nil {
		return err
	}
	toolStore, err := database.NewTools(pool, mcpCfg.AbsencesFailRate)
	if err != nil {
		return err
	}
	chatCfg, err := config.LoadChat(cfg.RedisURL)
	if err != nil {
		return err
	}
	var streams *chat.Service
	if chatCfg.Enabled {
		redisOptions, err := redis.ParseURL(cfg.RedisURL)
		if err != nil {
			return fmt.Errorf("invalid REDIS_URL")
		}
		redisOptions.Protocol = 2
		redisOptions.MaxRetries = -1
		redisOptions.ContextTimeoutEnabled = true
		redisOptions.DisableIdentity = true
		client := redis.NewClient(redisOptions)
		defer func() { _ = client.Close() }()
		streams, err = chat.NewService(ctx, database.NewChat(pool), chat.RedisBroker{Client: client}, &chat.PythonClient{URL: chatCfg.ServiceURL, Token: chatCfg.ServiceToken}, chat.Options{ProcessEvent: toolStore.ProcessEvent})
		if err != nil {
			return err
		}
		defer streams.Close()
	}
	handler := httpapi.NewHandler(logger, service, database.NewOnboarding(pool), streams)
	listings, err := database.NewListings(pool, authCfg.SigningKey)
	if err != nil {
		return err
	}
	handler = httpapi.WithListings(handler, service, listings)
	handler = httpapi.WithConfirmation(handler, service, toolStore)
	if mcpCfg.Token != "" {
		toolsHandler, err := mcpserver.New(toolStore, mcpCfg.Token)
		if err != nil {
			return err
		}
		mux := http.NewServeMux()
		mux.Handle("/mcp", toolsHandler)
		mux.Handle("/", handler)
		handler = mux
	}
	return server.Serve(ctx, listener, handler, logger)
}
