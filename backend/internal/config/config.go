package config

import (
	"fmt"
	"log/slog"
	"net"
	"os"
	"strconv"
)

// Config contains process settings. Connection URLs are reserved for integrations.
type Config struct {
	Address     string
	LogLevel    slog.Level
	DatabaseURL string
	RedisURL    string
}

func Load() (Config, error) {
	host := env("HOST", "0.0.0.0")
	port := env("PORT", "8080")
	n, err := strconv.Atoi(port)
	if err != nil || n < 1 || n > 65535 {
		return Config{}, fmt.Errorf("PORT must be an integer between 1 and 65535")
	}
	var level slog.Level
	if err := level.UnmarshalText([]byte(env("LOG_LEVEL", "INFO"))); err != nil {
		return Config{}, fmt.Errorf("invalid LOG_LEVEL: %w", err)
	}
	return Config{
		Address:     net.JoinHostPort(host, port),
		LogLevel:    level,
		DatabaseURL: os.Getenv("DATABASE_URL"),
		RedisURL:    os.Getenv("REDIS_URL"),
	}, nil
}

func env(key, fallback string) string {
	if value := os.Getenv(key); value != "" {
		return value
	}
	return fallback
}
