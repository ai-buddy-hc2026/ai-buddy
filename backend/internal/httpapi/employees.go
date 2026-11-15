package httpapi

import (
	"context"
	"errors"
	"net/http"
	"net/url"
	"strconv"
	"time"

	"github.com/ai-buddy-hc2026/ai-buddy/backend/internal/auth"
	"github.com/ai-buddy-hc2026/ai-buddy/backend/internal/employees"
	"github.com/ai-buddy-hc2026/ai-buddy/backend/internal/identifier"
)

type EmployeeStore interface {
	ListEmployees(context.Context, string, employees.Query) (employees.Page, error)
	GetEmployee(context.Context, string, string) (employees.Employee, error)
}

func parseEmployeeQuery(raw string) (employees.Query, error) {
	q := employees.Query{Limit: 50}
	values, err := url.ParseQuery(raw)
	if err != nil {
		return q, employees.ErrInvalid
	}
	for key, items := range values {
		if len(items) != 1 {
			return q, employees.ErrInvalid
		}
		switch key {
		case "q":
			q.Search = items[0]
		case "limit":
			q.Limit, err = strconv.Atoi(items[0])
			if err != nil {
				return q, employees.ErrInvalid
			}
		case "cursor":
			if items[0] == "" {
				return q, employees.ErrInvalid
			}
			q.Cursor = items[0]
		default:
			return q, employees.ErrInvalid
		}
	}
	if !employees.ValidQuery(q) {
		return q, employees.ErrInvalid
	}
	q.Search = employees.NormalizeSearch(q.Search)
	return q, nil
}

func WithEmployees(base http.Handler, service *auth.Service, store EmployeeStore) http.Handler {
	mux := http.NewServeMux()
	handle := func(detail bool) http.Handler {
		return RequireAuth(service, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			user, _ := CurrentUser(r.Context())
			ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
			defer cancel()
			var result any
			var err error
			if detail {
				if r.URL.RawQuery != "" || !identifier.ValidUUID(r.PathValue("id")) {
					writeEmployeeError(w, employees.ErrInvalid)
					return
				}
				result, err = store.GetEmployee(ctx, user.ID, r.PathValue("id"))
			} else {
				var query employees.Query
				query, err = parseEmployeeQuery(r.URL.RawQuery)
				if err == nil {
					result, err = store.ListEmployees(ctx, user.ID, query)
				}
			}
			if err != nil {
				writeEmployeeError(w, err)
				return
			}
			w.Header().Set("Cache-Control", "no-store")
			writeOnboardingJSON(w, result)
		}))
	}
	mux.Handle("GET /employees", handle(false))
	mux.Handle("GET /employees/{id}", handle(true))
	mux.Handle("/", base)
	return mux
}

func writeEmployeeError(w http.ResponseWriter, err error) {
	if errors.Is(err, employees.ErrInvalid) {
		writeAuthError(w, 400, "INVALID_REQUEST", "Некорректные параметры справочника или курсор.")
		return
	}
	writeActivityError(w, err)
}
