package database

import (
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/ai-buddy-hc2026/ai-buddy/backend/internal/auth"
	"github.com/ai-buddy-hc2026/ai-buddy/backend/internal/httpapi"
)

func TestPostgresLoginAndRevocation(t *testing.T) {
	pool := testPool(t)
	ctx := context.Background()
	if err := Prepare(ctx, pool, "../../../seed/checklist.json"); err != nil {
		t.Fatal(err)
	}
	store := NewUsers(pool)
	service, err := auth.New(store, []byte("synthetic-test-key-of-at-least-32-bytes"), time.Hour)
	if err != nil {
		t.Fatal(err)
	}
	handler := httpapi.NewHandler(slog.New(slog.NewJSONHandler(io.Discard, nil)), service)
	request := func(method, path, token string) *httptest.ResponseRecorder {
		r := httptest.NewRequest(method, path, strings.NewReader(`{"login":"intern_anya"}`))
		r.Header.Set("Content-Type", "application/json")
		if token != "" {
			r.Header.Set("Authorization", "Bearer "+token)
		}
		w := httptest.NewRecorder()
		handler.ServeHTTP(w, r)
		return w
	}
	w := request(http.MethodPost, "/auth/mock-login", "")
	if w.Code != 200 {
		t.Fatalf("login status=%d", w.Code)
	}
	var result auth.LoginResult
	if err := json.Unmarshal(w.Body.Bytes(), &result); err != nil {
		t.Fatal(err)
	}
	if result.User.Login != "intern_anya" || result.User.Role != "intern" || result.User.Team.Code != "team_avito_ai" || result.User.Timezone != "Europe/Moscow" || result.User.BuddyID == nil {
		t.Fatal("seed profile or timezone fallback is incorrect")
	}
	if got := request(http.MethodGet, "/me", "").Code; got != 401 {
		t.Fatalf("no token: got %d", got)
	}
	if got := request(http.MethodGet, "/me", result.AccessToken).Code; got != 200 {
		t.Fatalf("valid token: got %d", got)
	}
	if _, err := pool.Exec(ctx, "UPDATE users SET role='buddy', timezone='Asia/Yakutsk' WHERE login='intern_anya'"); err != nil {
		t.Fatal(err)
	}
	w = request(http.MethodGet, "/me", result.AccessToken)
	var current auth.User
	if err := json.Unmarshal(w.Body.Bytes(), &current); err != nil || w.Code != 200 || current.Role != "buddy" || current.Timezone != "Asia/Yakutsk" {
		t.Fatal("middleware did not refresh role/timezone from database")
	}
	for _, change := range []string{
		"UPDATE users SET active=false WHERE login='intern_anya'",
		"UPDATE users SET active=true WHERE login='intern_anya'; UPDATE teams SET active=false WHERE code='team_avito_ai'",
	} {
		if _, err := pool.Exec(ctx, change); err != nil {
			t.Fatal(err)
		}
		for _, tc := range []struct{ method, path string }{{http.MethodGet, "/me"}, {http.MethodPost, "/auth/mock-login"}} {
			if got := request(tc.method, tc.path, result.AccessToken).Code; got != 401 {
				t.Fatalf("deactivated account/team: got %d", got)
			}
		}
	}
	for _, login := range []string{"buddy_olga", "lead_alexey"} {
		if _, err := store.FindByLogin(ctx, login); err != nil {
			t.Fatalf("other team user unavailable: %v", err)
		}
	}
	pool.Close()
	if got := request(http.MethodGet, "/me", result.AccessToken).Code; got != 503 {
		t.Fatalf("unavailable database: got %d", got)
	}
}
