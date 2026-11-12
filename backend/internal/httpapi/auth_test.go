package httpapi

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/ai-buddy-hc2026/ai-buddy/backend/internal/auth"
)

type authStore struct {
	u   auth.User
	err error
}

func (s *authStore) FindByLogin(_ context.Context, login string) (auth.User, error) {
	if s.err != nil {
		return auth.User{}, s.err
	}
	if login != s.u.Login {
		return auth.User{}, auth.ErrUnauthorized
	}
	return s.u, nil
}

func (s *authStore) FindByID(_ context.Context, id string) (auth.User, error) {
	if s.err != nil {
		return auth.User{}, s.err
	}
	if id != s.u.ID {
		return auth.User{}, auth.ErrUnauthorized
	}
	return s.u, nil
}

func TestMockLoginAndMiddleware(t *testing.T) {
	store := &authStore{u: auth.User{ID: "10000000-0000-0000-0000-000000000001", Login: "intern_anya", Role: "intern", Team: auth.Team{ID: "00000000-0000-0000-0000-000000000001"}}}
	service, err := auth.New(store, []byte("synthetic-test-key-with-at-least-32-bytes"), time.Hour)
	if err != nil {
		t.Fatal(err)
	}
	var logs bytes.Buffer
	handler := NewHandler(slog.New(slog.NewJSONHandler(&logs, nil)), service, nil)
	for _, tc := range []struct {
		name, body, media string
		status            int
	}{
		{"success", `{"login":"intern_anya"}`, "application/json", 200},
		{"trim", `{"login":" intern_anya "}`, "application/json; charset=utf-8", 200},
		{"unknown", `{"login":"missing"}`, "application/json", 401},
		{"missing", `{}`, "application/json", 400},
		{"null", `null`, "application/json", 400},
		{"wrong_type", `{"login":1}`, "application/json", 400},
		{"empty", `{"login":" "}`, "application/json", 400},
		{"malformed", `{`, "application/json", 400},
		{"extra", `{"login":"intern_anya","role":"lead"}`, "application/json", 400},
		{"trailing", `{"login":"intern_anya"}{}`, "application/json", 400},
		{"media", `{"login":"intern_anya"}`, "text/plain", 400},
		{"too_long", `{"login":"` + strings.Repeat("a", 101) + `"}`, "application/json", 400},
		{"too_large", `{"login":"` + strings.Repeat("a", 5000) + `"}`, "application/json", 400},
	} {
		t.Run(tc.name, func(t *testing.T) {
			r := httptest.NewRequest(http.MethodPost, "/auth/mock-login", strings.NewReader(tc.body))
			r.Header.Set("Content-Type", tc.media)
			w := httptest.NewRecorder()
			handler.ServeHTTP(w, r)
			if w.Code != tc.status {
				t.Fatalf("status=%d, want=%d", w.Code, tc.status)
			}
			if w.Header().Get("Cache-Control") != "no-store" {
				t.Fatal("auth response must not be cached")
			}
		})
	}
	result, err := service.Login(context.Background(), "intern_anya")
	if err != nil {
		t.Fatal(err)
	}
	for _, tc := range []struct {
		header string
		status int
	}{
		{"", 401}, {"Bearer", 401}, {"Basic abc", 401}, {"Bearer broken", 401},
		{"Bearer " + strings.Repeat("a", 8193), 401}, {"Bearer " + result.AccessToken, 200},
	} {
		r := httptest.NewRequest(http.MethodGet, "/me", nil)
		if tc.header != "" {
			r.Header.Set("Authorization", tc.header)
		}
		w := httptest.NewRecorder()
		handler.ServeHTTP(w, r)
		if w.Code != tc.status {
			t.Fatalf("middleware status=%d, want=%d", w.Code, tc.status)
		}
		if tc.status == 401 && w.Header().Get("WWW-Authenticate") != "Bearer" {
			t.Fatal("missing Bearer challenge")
		}
		if tc.status == 200 {
			var user auth.User
			if err := json.Unmarshal(w.Body.Bytes(), &user); err != nil || user.ID != store.u.ID {
				t.Fatal("current profile was not returned")
			}
		}
	}
	for _, failure := range []error{auth.ErrUnauthorized, errors.New("postgres://private-secret")} {
		store.err = failure
		want := 503
		if errors.Is(failure, auth.ErrUnauthorized) {
			want = 401
		}
		for _, path := range []string{"/auth/mock-login", "/me"} {
			method := http.MethodGet
			if path == "/auth/mock-login" {
				method = http.MethodPost
			}
			r := httptest.NewRequest(method, path, strings.NewReader(`{"login":"intern_anya"}`))
			r.Header.Set("Content-Type", "application/json")
			r.Header.Set("Authorization", "Bearer "+result.AccessToken)
			w := httptest.NewRecorder()
			handler.ServeHTTP(w, r)
			if w.Code != want || strings.Contains(w.Body.String(), "private-secret") {
				t.Fatalf("unsafe error response, status=%d", w.Code)
			}
		}
	}
	if strings.Contains(logs.String(), result.AccessToken) || strings.Contains(logs.String(), "private-secret") {
		t.Fatal("credentials leaked into logs")
	}
}
