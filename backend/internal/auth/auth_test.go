package auth

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/golang-jwt/jwt/v5"
)

type memoryUsers struct {
	user User
	err  error
}

func (s *memoryUsers) FindByLogin(_ context.Context, login string) (User, error) {
	if s.err != nil {
		return User{}, s.err
	}
	if login != s.user.Login {
		return User{}, ErrUnauthorized
	}
	return s.user, nil
}

func (s *memoryUsers) FindByID(_ context.Context, id string) (User, error) {
	if s.err != nil {
		return User{}, s.err
	}
	if id != s.user.ID {
		return User{}, ErrUnauthorized
	}
	return s.user, nil
}

func TestLoginAndCurrentProfile(t *testing.T) {
	ctx := context.Background()
	store := &memoryUsers{user: User{ID: "10000000-0000-0000-0000-000000000001", Login: "intern_anya", Role: "intern", Team: Team{ID: "00000000-0000-0000-0000-000000000001"}}}
	key := []byte("synthetic-test-key-with-at-least-32-bytes")
	s, err := New(store, key, time.Hour)
	if err != nil {
		t.Fatal(err)
	}
	now := time.Now().UTC().Truncate(time.Second)
	s.now = func() time.Time { return now }
	result, err := s.Login(ctx, store.user.Login)
	if err != nil || result.TokenType != "Bearer" || result.ExpiresIn != 3600 {
		t.Fatalf("login: %+v, %v", result, err)
	}
	parsed, err := jwt.ParseWithClaims(result.AccessToken, &Claims{}, func(_ *jwt.Token) (any, error) { return key, nil })
	if err != nil {
		t.Fatal(err)
	}
	claims := parsed.Claims.(*Claims)
	if claims.Subject != store.user.ID || claims.UserID != store.user.ID || claims.Role != "intern" || claims.TeamID != store.user.Team.ID || !claims.ExpiresAt.Equal(now.Add(time.Hour)) {
		t.Fatalf("unexpected claims: %+v", claims)
	}
	store.user.Role = "buddy"
	u, err := s.Authenticate(ctx, result.AccessToken)
	if err != nil || u.Role != "buddy" {
		t.Fatalf("expected current role from store, got %s, %v", u.Role, err)
	}
	for _, failure := range []error{ErrUnauthorized, errors.New("database down")} {
		store.err = failure
		if _, err := s.Authenticate(ctx, result.AccessToken); !errors.Is(err, failure) {
			t.Fatalf("store error lost: %v", err)
		}
		if _, err := s.Login(ctx, store.user.Login); !errors.Is(err, failure) {
			t.Fatalf("login error lost: %v", err)
		}
	}
	store.err = nil
	if _, err := s.Login(ctx, "unknown"); !errors.Is(err, ErrUnauthorized) {
		t.Fatalf("unknown login accepted: %v", err)
	}
	s.now = func() time.Time { return now.Add(time.Hour) }
	if _, err := s.Authenticate(ctx, result.AccessToken); !errors.Is(err, ErrUnauthorized) {
		t.Fatalf("expired token accepted: %v", err)
	}
}

func TestRejectInvalidClaims(t *testing.T) {
	key := []byte("synthetic-test-key-with-at-least-32-bytes")
	s, err := New(&memoryUsers{user: User{ID: "10000000-0000-0000-0000-000000000001"}}, key, time.Hour)
	if err != nil {
		t.Fatal(err)
	}
	now := time.Now().UTC().Truncate(time.Second)
	s.now = func() time.Time { return now }
	for _, name := range []string{"signature", "algorithm", "expiration", "issued_at", "future", "subject", "uuid", "zero_uuid", "uppercase_uuid", "role", "team", "zero_team", "issuer", "audience"} {
		t.Run(name, func(t *testing.T) {
			claims := Claims{UserID: "10000000-0000-0000-0000-000000000001", Role: "intern", TeamID: "00000000-0000-0000-0000-000000000001",
				RegisteredClaims: jwt.RegisteredClaims{Subject: "10000000-0000-0000-0000-000000000001", Issuer: "ai-buddy", Audience: jwt.ClaimStrings{"ai-buddy-web"}, IssuedAt: jwt.NewNumericDate(now), ExpiresAt: jwt.NewNumericDate(now.Add(time.Hour))}}
			method := jwt.SigningMethodHS256
			signingKey := key
			switch name {
			case "signature":
				signingKey = []byte("another-synthetic-key-of-32-bytes-or-more")
			case "algorithm":
				method = jwt.SigningMethodHS384
			case "expiration":
				claims.ExpiresAt = nil
			case "issued_at":
				claims.IssuedAt = nil
			case "future":
				claims.IssuedAt = jwt.NewNumericDate(now.Add(time.Minute))
			case "subject":
				claims.Subject = "someone-else"
			case "uuid":
				claims.UserID, claims.Subject = "intern_anya", "intern_anya"
			case "zero_uuid":
				claims.UserID, claims.Subject = "00000000-0000-0000-0000-000000000000", "00000000-0000-0000-0000-000000000000"
			case "uppercase_uuid":
				claims.UserID, claims.Subject = "A0000000-0000-0000-0000-000000000001", "A0000000-0000-0000-0000-000000000001"
			case "role":
				claims.Role = "admin"
			case "team":
				claims.TeamID = "team_1"
			case "zero_team":
				claims.TeamID = "00000000-0000-0000-0000-000000000000"
			case "issuer":
				claims.Issuer = "other"
			case "audience":
				claims.Audience = jwt.ClaimStrings{"other"}
			}
			raw, err := jwt.NewWithClaims(method, claims).SignedString(signingKey)
			if err != nil {
				t.Fatal(err)
			}
			if _, err := s.Authenticate(context.Background(), raw); !errors.Is(err, ErrUnauthorized) {
				t.Fatalf("invalid token accepted: %v", err)
			}
		})
	}
	if _, err := s.Authenticate(context.Background(), "not-a-jwt"); !errors.Is(err, ErrUnauthorized) {
		t.Fatalf("malformed token accepted: %v", err)
	}
}

func TestNewInvalidSettings(t *testing.T) {
	for _, tc := range []struct {
		key string
		ttl time.Duration
	}{{"short", time.Hour}, {"                                ", time.Hour}, {"synthetic-test-key-of-at-least-32-bytes", 0}, {"synthetic-test-key-of-at-least-32-bytes", 25 * time.Hour}} {
		if _, err := New(&memoryUsers{}, []byte(tc.key), tc.ttl); err == nil {
			t.Fatal("invalid settings accepted")
		}
	}
}
