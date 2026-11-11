package config

import (
	"testing"
	"time"
)

func TestLoadAuth(t *testing.T) {
	t.Setenv("JWT_SIGNING_KEY", "synthetic-test-key-of-at-least-32-bytes")
	t.Setenv("JWT_TTL", "")
	cfg, err := LoadAuth()
	if err != nil || cfg.TokenTTL != time.Hour || len(cfg.SigningKey) < 32 {
		t.Fatalf("invalid default auth config: %v", err)
	}
	t.Setenv("JWT_TTL", "15m")
	cfg, err = LoadAuth()
	if err != nil || cfg.TokenTTL != 15*time.Minute {
		t.Fatalf("TTL override failed: %v", err)
	}
	for _, value := range []string{"0s", "-1h", "invalid", "25h", "1.5s"} {
		t.Setenv("JWT_TTL", value)
		if _, err := LoadAuth(); err == nil {
			t.Errorf("invalid TTL accepted: %s", value)
		}
	}
	t.Setenv("JWT_TTL", "1h")
	for _, value := range []string{"", "short", "                                "} {
		t.Setenv("JWT_SIGNING_KEY", value)
		if _, err := LoadAuth(); err == nil {
			t.Error("invalid signing key accepted")
		}
	}
}
