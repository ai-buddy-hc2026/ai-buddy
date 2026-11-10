package config

import (
	"log/slog"
	"testing"
)

func clearEnv(t *testing.T) {
	t.Helper()
	for _, key := range []string{"HOST", "PORT", "LOG_LEVEL", "DATABASE_URL", "REDIS_URL"} {
		t.Setenv(key, "")
	}
}

func TestLoadDefaults(t *testing.T) {
	clearEnv(t)
	cfg, err := Load()
	if err != nil {
		t.Fatal(err)
	}
	if cfg.Address != "0.0.0.0:8080" || cfg.LogLevel != slog.LevelInfo || cfg.DatabaseURL != "" || cfg.RedisURL != "" {
		t.Fatalf("unexpected defaults: %+v", cfg)
	}
}

func TestLoadOverrides(t *testing.T) {
	clearEnv(t)
	t.Setenv("HOST", "::1")
	t.Setenv("PORT", "9090")
	t.Setenv("LOG_LEVEL", "debug")
	t.Setenv("DATABASE_URL", "postgres://user:secret@postgres/app")
	t.Setenv("REDIS_URL", "redis://redis:6379/0")
	cfg, err := Load()
	if err != nil {
		t.Fatal(err)
	}
	if cfg.Address != "[::1]:9090" || cfg.LogLevel != slog.LevelDebug ||
		cfg.DatabaseURL != "postgres://user:secret@postgres/app" || cfg.RedisURL != "redis://redis:6379/0" {
		t.Fatal("environment overrides were not applied")
	}
}

func TestLoadInvalid(t *testing.T) {
	for _, tc := range []struct{ key, value string }{
		{"PORT", "abc"}, {"PORT", "0"}, {"PORT", "-1"}, {"PORT", "65536"},
		{"LOG_LEVEL", "invalid"},
	} {
		t.Run(tc.key+"="+tc.value, func(t *testing.T) {
			clearEnv(t)
			t.Setenv(tc.key, tc.value)
			if _, err := Load(); err == nil {
				t.Fatal("expected invalid configuration to fail")
			}
		})
	}
}
