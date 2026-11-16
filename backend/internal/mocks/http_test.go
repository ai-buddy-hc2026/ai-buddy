package mocks

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/ai-buddy-hc2026/ai-buddy/backend/internal/auth"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
)

type authStore struct{ u auth.User }

func (s *authStore) FindByLogin(context.Context, string) (auth.User, error) { return s.u, nil }
func (s *authStore) FindByID(context.Context, string) (auth.User, error)    { return s.u, nil }

var errDatabase = errors.New("database down")

// failingDB считает обращения: валидация обязана отклонять запрос до БД.
type failingDB struct{ calls int }

type errRow struct{}

func (errRow) Scan(...any) error { return errDatabase }

func (d *failingDB) Query(context.Context, string, ...any) (pgx.Rows, error) {
	d.calls++
	return nil, errDatabase
}
func (d *failingDB) QueryRow(context.Context, string, ...any) pgx.Row { d.calls++; return errRow{} }
func (d *failingDB) Exec(context.Context, string, ...any) (pgconn.CommandTag, error) {
	d.calls++
	return pgconn.CommandTag{}, errDatabase
}

func TestRegisterValidation(t *testing.T) {
	user := auth.User{ID: "10000000-0000-0000-0000-000000000001", Login: "intern_anya", Role: "intern", Team: auth.Team{ID: "00000000-0000-0000-0000-000000000001"}}
	service, err := auth.New(&authStore{u: user}, []byte("synthetic-test-key-with-at-least-32-bytes"), time.Hour)
	if err != nil {
		t.Fatal(err)
	}
	login, err := service.Login(context.Background(), user.Login)
	if err != nil {
		t.Fatal(err)
	}
	base := http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(http.StatusTeapot) })
	for _, tc := range []struct {
		name, method, path, body string
		token                    bool
		status                   int
		reachesDB                bool
	}{
		{"no token", "GET", "/employees", "", false, 401, false},
		{"owner without topic", "GET", "/employees/owner", "", true, 400, false},
		{"owner topic too long", "GET", "/employees/owner?topic=" + strings.Repeat("a", 201), "", true, 400, false},
		{"bad host code", "GET", "/calendar/BAD!/office-hours", "", true, 400, false},
		{"book bad slot id", "POST", "/calendar/bookings", `{"slot_id":"x","topic":""}`, true, 400, false},
		{"book unknown field", "POST", "/calendar/bookings", `{"slot_id":"10000000-0000-0000-0000-000000000001","extra":1}`, true, 400, false},
		{"access bad system", "POST", "/access/requests", `{"system":"Bad System"}`, true, 400, false},
		{"database failure hidden", "GET", "/map", "", true, 500, true},
		{"unknown path falls through", "GET", "/health", "", false, http.StatusTeapot, false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			db := &failingDB{}
			handler := Register(base, service, db)
			r := httptest.NewRequest(tc.method, tc.path, strings.NewReader(tc.body))
			if tc.token {
				r.Header.Set("Authorization", "Bearer "+login.AccessToken)
			}
			w := httptest.NewRecorder()
			handler.ServeHTTP(w, r)
			if w.Code != tc.status {
				t.Fatalf("status=%d body=%s", w.Code, w.Body.String())
			}
			if (db.calls > 0) != tc.reachesDB {
				t.Fatalf("db calls=%d", db.calls)
			}
			if strings.Contains(w.Body.String(), errDatabase.Error()) {
				t.Fatal("database error leaked")
			}
		})
	}
}
