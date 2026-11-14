package config

import (
	"errors"
	"os"
	"strings"
	"time"
)

type Auth struct {
	SigningKey []byte
	TokenTTL   time.Duration
}

func LoadAuth() (Auth, error) {
	key := os.Getenv("JWT_SIGNING_KEY")
	if len(key) < 32 || strings.TrimSpace(key) == "" {
		return Auth{}, errors.New("JWT_SIGNING_KEY must contain at least 32 bytes")
	}
	ttl, err := time.ParseDuration(env("JWT_TTL", "1h"))
	if err != nil || ttl < time.Second || ttl > 24*time.Hour || ttl%time.Second != 0 {
		return Auth{}, errors.New("JWT_TTL must be from 1s to 24h in whole seconds")
	}
	return Auth{SigningKey: []byte(key), TokenTTL: ttl}, nil
}
