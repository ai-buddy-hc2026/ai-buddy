// Package mcpserver реализует исходный MCP-профиль 1.1.
package mcpserver

import (
	"bytes"
	"context"
	"crypto/subtle"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/ai-buddy-hc2026/ai-buddy/backend/internal/auth"
	"github.com/ai-buddy-hc2026/ai-buddy/backend/internal/identifier"
	"github.com/ai-buddy-hc2026/ai-buddy/backend/internal/onboarding"
	"github.com/ai-buddy-hc2026/ai-buddy/backend/internal/policy"
	"github.com/ai-buddy-hc2026/ai-buddy/backend/internal/toolcontract"
	"github.com/ai-buddy-hc2026/ai-buddy/backend/internal/tools"
	"github.com/modelcontextprotocol/go-sdk/jsonrpc"
	"github.com/modelcontextprotocol/go-sdk/mcp"
)

const ProtocolVersion = "2025-06-18"

type Store interface {
	Context(context.Context, string) (tools.Context, error)
	Call(context.Context, string, policy.Operation, json.RawMessage) (any, error)
}
type roleKey struct{}

func New(store Store, token string) (http.Handler, error) {
	if store == nil || len(token) < 32 || strings.ContainsAny(token, " \t\r\n") {
		return nil, errors.New("MCP requires a store and a separate token of at least 32 bytes")
	}
	servers := make(map[string]*mcp.Server)
	for _, role := range []string{"intern", "buddy", "lead"} {
		server := mcp.NewServer(&mcp.Implementation{Name: "ai-buddy-tools", Version: "1.1.0"}, &mcp.ServerOptions{SupportedProtocolVersions: []string{ProtocolVersion}, Capabilities: &mcp.ServerCapabilities{Tools: &mcp.ToolCapabilities{ListChanged: false}}})
		for _, definition := range toolcontract.Definitions {
			if role == "intern" && definition.Name == "absences.list_for_employee" {
				continue
			}
			server.AddTool(&mcp.Tool{Name: definition.Name, Description: definition.Description, InputSchema: toolcontract.Schema(definition.Input), OutputSchema: toolcontract.Schema(definition.Output)}, func(context.Context, *mcp.CallToolRequest) (*mcp.CallToolResult, error) {
				return nil, errors.New("unreachable handler")
			})
		}
		server.AddReceivingMiddleware(func(next mcp.MethodHandler) mcp.MethodHandler {
			return func(ctx context.Context, method string, request mcp.Request) (mcp.Result, error) {
				if method == "tools/call" {
					return call(ctx, store, request.(*mcp.CallToolRequest))
				}
				return next(ctx, method, request)
			}
		})
		servers[role] = server
	}
	transport := mcp.NewStreamableHTTPHandler(func(r *http.Request) *mcp.Server {
		role, _ := r.Context().Value(roleKey{}).(string)
		return servers[role]
	}, &mcp.StreamableHTTPOptions{Stateless: true, JSONResponse: true, MaxRequestBodyBytes: 64 << 10})
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Cache-Control", "no-store")
		if len(r.Header.Values("Authorization")) != 1 || subtle.ConstantTimeCompare([]byte(r.Header.Get("Authorization")), []byte("Bearer "+token)) != 1 {
			w.Header().Set("WWW-Authenticate", "Bearer")
			writeError(w, 401, "UNAUTHORIZED")
			return
		}
		if r.Header.Get("Origin") != "" {
			writeError(w, 403, "ORIGIN_NOT_ALLOWED")
			return
		}
		id := r.Header.Get("X-Request-ID")
		if len(r.Header.Values("X-Request-ID")) != 1 || !identifier.ValidUUID(id) || r.URL.RawQuery != "" {
			writeError(w, 400, "INVALID_REQUEST_ID")
			return
		}
		ctx, cancel := context.WithTimeout(r.Context(), 10*time.Second)
		defer cancel()
		actor, err := store.Context(ctx, id)
		if err != nil {
			switch {
			case errors.Is(err, tools.ErrUnknownRequest), errors.Is(err, auth.ErrUnauthorized):
				writeError(w, 404, "REQUEST_NOT_FOUND")
			case errors.Is(err, tools.ErrClosed):
				writeError(w, 410, "REQUEST_CLOSED")
			default:
				writeError(w, 503, "CONTEXT_UNAVAILABLE")
			}
			return
		}
		if servers[actor.Role] == nil {
			writeError(w, 404, "REQUEST_NOT_FOUND")
			return
		}
		if r.Method != "POST" {
			w.WriteHeader(http.StatusMethodNotAllowed)
			return
		}
		raw, err := io.ReadAll(http.MaxBytesReader(w, r.Body, 64<<10))
		if err != nil {
			w.WriteHeader(413)
			return
		}
		var envelope struct {
			Version string          `json:"jsonrpc"`
			ID      json.RawMessage `json:"id"`
			Method  string          `json:"method"`
			Params  json.RawMessage `json:"params"`
		}
		if !json.Valid(raw) {
			writeRPC(w, 400, nil, -32700, "PARSE_ERROR")
			return
		}
		if json.Unmarshal(raw, &envelope) != nil || envelope.Version != "2.0" || envelope.Method == "" {
			writeRPC(w, 400, nil, -32600, "INVALID_REQUEST")
			return
		}
		if version := r.Header.Get("MCP-Protocol-Version"); envelope.Method != "initialize" && version != ProtocolVersion {
			writeError(w, 400, "UNSUPPORTED_PROTOCOL_VERSION")
			return
		}
		// Уведомления не получают JSON-RPC-ответ и не выполняют инструменты.
		if len(envelope.ID) == 0 {
			w.WriteHeader(http.StatusAccepted)
			return
		}
		if envelope.Method == "tools/list" || envelope.Method == "tools/call" {
			var params map[string]json.RawMessage
			if len(envelope.Params) > 0 && json.Unmarshal(envelope.Params, &params) != nil {
				writeRPC(w, 200, envelope.ID, -32602, "INVALID_ARGUMENT")
				return
			}
			if envelope.Method == "tools/list" {
				if _, ok := params["cursor"]; ok {
					writeRPC(w, 200, envelope.ID, -32602, "INVALID_ARGUMENT")
					return
				}
			} else {
				var name string
				if json.Unmarshal(params["name"], &name) != nil {
					writeRPC(w, 200, envelope.ID, -32602, "INVALID_ARGUMENT")
					return
				}
			}
		}
		switch envelope.Method {
		case "initialize", "notifications/initialized", "ping", "tools/list", "tools/call":
		default:
			if len(envelope.ID) > 0 {
				writeRPC(w, 200, envelope.ID, -32601, "METHOD_NOT_FOUND")
			} else {
				w.WriteHeader(202)
			}
			return
		}
		r.Body = io.NopCloser(bytes.NewReader(raw))
		transport.ServeHTTP(w, r.WithContext(context.WithValue(ctx, roleKey{}, actor.Role)))
	}), nil
}

func call(ctx context.Context, store Store, request *mcp.CallToolRequest) (*mcp.CallToolResult, error) {
	name := request.Params.Name
	input := toolcontract.Input(name)
	if input == "" {
		return nil, rpcError(-32602, "UNKNOWN_TOOL")
	}
	var arguments any
	if json.Unmarshal(request.Params.Arguments, &arguments) != nil || toolcontract.Validate(input, arguments) != nil {
		return nil, rpcError(-32602, "INVALID_ARGUMENT")
	}
	output, err := store.Call(ctx, request.Extra.Header.Get("X-Request-ID"), policy.Operation(name), request.Params.Arguments)
	if errors.Is(err, tools.ErrInvalid) || errors.Is(err, onboarding.ErrInvalidArgument) {
		return nil, rpcError(-32602, "INVALID_ARGUMENT")
	}
	var structured any
	isError := err != nil
	if err != nil {
		structured = failure(err)
	} else {
		structured = map[string]any{"ok": true, "data": output}
	}
	schema := "Failure"
	for _, d := range toolcontract.Definitions {
		if d.Name == name {
			schema = d.Output
		}
	}
	if toolcontract.Validate(schema, structured) != nil {
		structured = failure(errors.New("invalid tool output"))
		isError = true
	}
	raw, _ := json.Marshal(structured)
	return &mcp.CallToolResult{IsError: isError, StructuredContent: structured, Content: []mcp.Content{&mcp.TextContent{Text: string(raw)}}}, nil
}

func failure(err error) any {
	code, retryable := "INTERNAL_ERROR", false
	switch {
	case errors.Is(err, tools.ErrDenied), errors.Is(err, onboarding.ErrForbidden):
		code = "POLICY_DENIED"
	case errors.Is(err, tools.ErrNotFound), errors.Is(err, onboarding.ErrNotFound):
		code = "NOT_FOUND"
	case errors.Is(err, tools.ErrConfirmation):
		code = "CONFIRMATION_REQUIRED"
	case errors.Is(err, tools.ErrBusinessConflict), errors.Is(err, onboarding.ErrPlanInactive):
		code = "CONFLICT"
	case errors.Is(err, tools.ErrConflict):
		code = "IDEMPOTENCY_CONFLICT"
	case errors.Is(err, onboarding.ErrVersionConflict):
		code = "VERSION_CONFLICT"
	case errors.Is(err, tools.ErrUnavailable):
		code, retryable = "DEPENDENCY_UNAVAILABLE", true
	case errors.Is(err, context.DeadlineExceeded):
		code, retryable = "TIMEOUT", true
	}
	return map[string]any{"ok": false, "error": map[string]any{"code": code, "message": "Операция не выполнена: " + code, "retryable": retryable}}
}
func rpcError(code int64, name string) error {
	raw, _ := json.Marshal(map[string]string{"code": name})
	return &jsonrpc.Error{Code: code, Message: name, Data: raw}
}
func writeError(w http.ResponseWriter, status int, code string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(map[string]any{"error": map[string]string{"code": code, "message": "MCP: " + code}})
}
func writeRPC(w http.ResponseWriter, status int, id json.RawMessage, code int64, name string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(map[string]any{"jsonrpc": "2.0", "id": id, "error": rpcError(code, name)})
}
