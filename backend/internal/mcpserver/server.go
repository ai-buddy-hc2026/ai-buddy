// Package mcpserver предоставляет внутренний MCP endpoint для AI-service.
package mcpserver

import (
	"context"
	"crypto/subtle"
	"encoding/json"
	"errors"
	"net/http"
	"strings"
	"time"

	"github.com/ai-buddy-hc2026/ai-buddy/backend/internal/auth"
	"github.com/ai-buddy-hc2026/ai-buddy/backend/internal/onboarding"
	"github.com/ai-buddy-hc2026/ai-buddy/backend/internal/policy"
	"github.com/ai-buddy-hc2026/ai-buddy/backend/internal/tools"
	"github.com/modelcontextprotocol/go-sdk/mcp"
)

type Store interface {
	Bind(context.Context, string) error
	Call(context.Context, string, policy.Operation, json.RawMessage) (any, error)
}

// New создает stateless endpoint: между запросами нет общего пользовательского контекста.
func New(store Store, token string) (http.Handler, error) {
	if store == nil || len(token) < 32 || strings.ContainsAny(token, " \t\r\n") {
		return nil, errors.New("MCP requires a store and a service token of at least 32 bytes")
	}
	server := mcp.NewServer(&mcp.Implementation{Name: "ai-buddy-tools", Version: "1.0.0"}, nil)
	register[tools.PlanInput](server, store, policy.GetPlan, "Получить доступный план адаптации")
	register[tools.ActionInput](server, store, policy.UpdateStatus, "Выполнить подтвержденное изменение статуса задачи по action_id")
	register[tools.EmployeeInput](server, store, policy.GetManager, "Получить своего руководителя")
	register[tools.EmptyInput](server, store, policy.GetAbsencePolicy, "Получить синтетические правила отсутствий своей команды")
	register[tools.EmployeeInput](server, store, policy.ListAbsences, "Получить свои синтетические отсутствия")
	register[tools.ActionInput](server, store, policy.CreateAbsence, "Выполнить подтвержденное создание отсутствия по action_id")
	transport := mcp.NewStreamableHTTPHandler(func(*http.Request) *mcp.Server { return server }, &mcp.StreamableHTTPOptions{Stateless: true, JSONResponse: true, MaxRequestBodyBytes: 64 << 10, PropagateRequestCancellation: true})
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Cache-Control", "no-store")
		if r.Header.Get("Origin") != "" {
			http.Error(w, "Forbidden", http.StatusForbidden)
			return
		}
		if len(r.Header.Values("Authorization")) != 1 || subtle.ConstantTimeCompare([]byte(r.Header.Get("Authorization")), []byte("Bearer "+token)) != 1 {
			http.Error(w, "Unauthorized", http.StatusUnauthorized)
			return
		}
		if r.URL.RawQuery != "" || len(r.Header.Values("X-Request-ID")) != 1 {
			http.Error(w, "Invalid context", http.StatusBadRequest)
			return
		}
		ctx, cancel := context.WithTimeout(r.Context(), 15*time.Second)
		defer cancel()
		if err := store.Bind(ctx, r.Header.Get("X-Request-ID")); err != nil {
			status := http.StatusServiceUnavailable
			if errors.Is(err, tools.ErrContext) || errors.Is(err, auth.ErrUnauthorized) {
				status = http.StatusForbidden
			}
			http.Error(w, "Context unavailable", status)
			return
		}
		transport.ServeHTTP(w, r.WithContext(ctx))
	}), nil
}

func register[In any](server *mcp.Server, store Store, operation policy.Operation, description string) {
	mcp.AddTool(server, &mcp.Tool{Name: string(operation), Description: description}, func(ctx context.Context, request *mcp.CallToolRequest, _ In) (*mcp.CallToolResult, any, error) {
		if request.Extra == nil {
			return nil, nil, tools.ErrContext
		}
		output, err := store.Call(ctx, request.Extra.Header.Get("X-Request-ID"), operation, request.Params.Arguments)
		if err != nil {
			return nil, nil, publicError(err)
		}
		return nil, output, nil
	})
}

func publicError(err error) error {
	for _, known := range []error{tools.ErrInvalid, tools.ErrContext, tools.ErrDenied, tools.ErrConfirmation, tools.ErrConflict, tools.ErrUnavailable, tools.ErrNoManager} {
		if errors.Is(err, known) {
			return known
		}
	}
	switch {
	case errors.Is(err, onboarding.ErrInvalidArgument):
		return tools.ErrInvalid
	case errors.Is(err, onboarding.ErrForbidden), errors.Is(err, onboarding.ErrNotFound):
		return tools.ErrDenied
	case errors.Is(err, onboarding.ErrVersionConflict):
		return errors.New("VERSION_CONFLICT")
	case errors.Is(err, onboarding.ErrPlanInactive):
		return errors.New("PLAN_NOT_ACTIVE")
	case errors.Is(err, auth.ErrUnauthorized):
		return tools.ErrContext
	default:
		return tools.ErrUnavailable
	}
}
