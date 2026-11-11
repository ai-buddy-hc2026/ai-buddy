package auth

import (
	"context"
	"encoding/hex"
	"errors"
	"strings"
	"time"

	"github.com/golang-jwt/jwt/v5"
)

var ErrUnauthorized = errors.New("unauthorized")

type Team struct {
	ID       string `json:"id"`
	Code     string `json:"code"`
	Name     string `json:"name"`
	Timezone string `json:"timezone"`
}

type User struct {
	ID        string  `json:"id"`
	Login     string  `json:"login"`
	Name      string  `json:"name"`
	Role      string  `json:"role"`
	Team      Team    `json:"team"`
	Timezone  string  `json:"timezone"`
	BuddyID   *string `json:"buddy_id"`
	ManagerID *string `json:"manager_id"`
}

// UserStore возвращает только активных пользователей активных команд.
// Отсутствующая или неактивная запись возвращает ErrUnauthorized.
type UserStore interface {
	FindByLogin(context.Context, string) (User, error)
	FindByID(context.Context, string) (User, error)
}

type Claims struct {
	UserID string `json:"user_id"`
	Role   string `json:"role"`
	TeamID string `json:"team_id"`
	jwt.RegisteredClaims
}

type LoginResult struct {
	AccessToken string `json:"access_token"`
	TokenType   string `json:"token_type"`
	ExpiresIn   int64  `json:"expires_in"`
	User        User   `json:"user"`
}

type Service struct {
	store UserStore
	key   []byte
	ttl   time.Duration
	now   func() time.Time
}

func New(store UserStore, key []byte, ttl time.Duration) (*Service, error) {
	if store == nil || len(key) < 32 || strings.TrimSpace(string(key)) == "" || ttl < time.Second || ttl > 24*time.Hour || ttl%time.Second != 0 {
		return nil, errors.New("JWT requires a user store, a key of at least 32 bytes and TTL from 1s to 24h in whole seconds")
	}
	return &Service{store: store, key: append([]byte(nil), key...), ttl: ttl, now: time.Now}, nil
}

func (s *Service) Login(ctx context.Context, login string) (LoginResult, error) {
	u, err := s.store.FindByLogin(ctx, login)
	if err != nil {
		return LoginResult{}, err
	}
	now := s.now().UTC().Truncate(time.Second)
	claims := Claims{
		UserID: u.ID, Role: u.Role, TeamID: u.Team.ID,
		RegisteredClaims: jwt.RegisteredClaims{
			Subject: u.ID, Issuer: "ai-buddy", Audience: jwt.ClaimStrings{"ai-buddy-web"},
			IssuedAt: jwt.NewNumericDate(now), ExpiresAt: jwt.NewNumericDate(now.Add(s.ttl)),
		},
	}
	token, err := jwt.NewWithClaims(jwt.SigningMethodHS256, claims).SignedString(s.key)
	if err != nil {
		return LoginResult{}, err
	}
	return LoginResult{AccessToken: token, TokenType: "Bearer", ExpiresIn: int64(s.ttl / time.Second), User: u}, nil
}

func (s *Service) Authenticate(ctx context.Context, raw string) (User, error) {
	claims := &Claims{}
	token, err := jwt.ParseWithClaims(raw, claims, func(_ *jwt.Token) (any, error) {
		return s.key, nil
	}, jwt.WithValidMethods([]string{"HS256"}), jwt.WithExpirationRequired(),
		jwt.WithIssuedAt(), jwt.WithIssuer("ai-buddy"), jwt.WithAudience("ai-buddy-web"), jwt.WithTimeFunc(s.now))
	if err != nil || !token.Valid || claims.IssuedAt == nil || claims.Subject != claims.UserID ||
		!validUUID(claims.UserID) || !validUUID(claims.TeamID) ||
		(claims.Role != "intern" && claims.Role != "buddy" && claims.Role != "lead") ||
		!claims.ExpiresAt.After(claims.IssuedAt.Time) {
		return User{}, ErrUnauthorized
	}
	// Роль и команда JWT являются снимком. Актуальный профиль берётся из БД.
	return s.store.FindByID(ctx, claims.UserID)
}

func validUUID(value string) bool {
	if len(value) != 36 || value[8] != '-' || value[13] != '-' || value[18] != '-' || value[23] != '-' {
		return false
	}
	compact := strings.ReplaceAll(value, "-", "")
	_, err := hex.DecodeString(compact)
	return len(compact) == 32 && err == nil
}
