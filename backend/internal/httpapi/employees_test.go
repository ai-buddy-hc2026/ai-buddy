package httpapi

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/ai-buddy-hc2026/ai-buddy/backend/internal/auth"
	"github.com/ai-buddy-hc2026/ai-buddy/backend/internal/employees"
)

type employeeStoreStub struct{ actor string }

func (s *employeeStoreStub) ListEmployees(_ context.Context, actor string, q employees.Query) (employees.Page, error) {
	s.actor = actor
	return employees.Page{Items: []employees.Employee{}}, nil
}
func (s *employeeStoreStub) GetEmployee(_ context.Context, actor, id string) (employees.Employee, error) {
	s.actor = actor
	return employees.Employee{ID: id}, nil
}

func TestEmployeeHTTP(t *testing.T) {
	user := auth.User{ID: "a24a3478-cf42-51b1-b05b-9833260247a5", Login: "intern_anya", Role: "intern", Team: auth.Team{ID: "4496e76d-35da-5cf7-a3d5-c9a89d88c5a2"}}
	service, err := auth.New(&authStore{u: user}, []byte("synthetic-test-key-with-at-least-32-bytes"), time.Hour)
	if err != nil {
		t.Fatal(err)
	}
	token, err := service.Login(context.Background(), user.Login)
	if err != nil {
		t.Fatal(err)
	}
	store := &employeeStoreStub{}
	handler := WithEmployees(http.NotFoundHandler(), service, store)
	for _, tc := range []struct {
		path          string
		authenticated bool
		status        int
	}{
		{"/employees", false, 401}, {"/employees?q=DevOps&limit=1", true, 200},
		{"/employees?team_id=other", true, 400}, {"/employees?limit=0", true, 400},
		{"/employees?q=a&q=b", true, 400}, {"/employees?cursor=", true, 400},
		{"/employees/20000000-0000-4000-8000-000000000001", true, 200},
		{"/employees/20000000-0000-4000-8000-000000000001?q=x", true, 400},
	} {
		r := httptest.NewRequest("GET", tc.path, nil)
		if tc.authenticated {
			r.Header.Set("Authorization", "Bearer "+token.AccessToken)
		}
		w := httptest.NewRecorder()
		handler.ServeHTTP(w, r)
		if w.Code != tc.status {
			t.Fatalf("%s=%d body=%s", tc.path, w.Code, w.Body.String())
		}
		if tc.status == 200 && (store.actor != user.ID || w.Header().Get("Cache-Control") != "no-store") {
			t.Fatal("missing trusted identity or cache policy")
		}
	}
}
