package httpapi

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/ai-buddy-hc2026/ai-buddy/backend/internal/auth"
)

const (
	aiProxyBodyLimit     = 128 << 10
	aiProxyResponseLimit = 1 << 20
	meetingTextLimit     = 20000
	meetingTimeout       = 30 * time.Second
	clustersTimeout      = 10 * time.Second
	clustersDefaultDays  = 30
	clustersMaxDays      = 90
)

// AIClient ходит в ai-service только с сервисным токеном AI_SERVICE_TOKEN.
// JWT пользователя наружу не передаётся.
type AIClient struct {
	URL    string
	Token  string
	Client *http.Client
}

// NewAIClient возвращает nil, если ai-service не настроен.
func NewAIClient(enabled bool, url, token string) *AIClient {
	if !enabled || url == "" || token == "" {
		return nil
	}
	return &AIClient{URL: url, Token: token}
}

var errAIUpstream = errors.New("ai-service request failed")

func (c *AIClient) post(ctx context.Context, path string, in, out any) error {
	raw, err := json.Marshal(in)
	if err != nil {
		return fmt.Errorf("encode ai request: %w", err)
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.URL+path, bytes.NewReader(raw))
	if err != nil {
		return fmt.Errorf("build ai request: %w", err)
	}
	req.Header.Set("Authorization", "Bearer "+c.Token)
	req.Header.Set("Content-Type", "application/json")
	client := c.Client
	if client == nil {
		client = &http.Client{CheckRedirect: func(_ *http.Request, _ []*http.Request) error { return http.ErrUseLastResponse }}
	}
	response, err := client.Do(req)
	if err != nil {
		return fmt.Errorf("%w: %v", errAIUpstream, err)
	}
	defer func() { _ = response.Body.Close() }()
	if response.StatusCode != http.StatusOK {
		return fmt.Errorf("%w: status %d", errAIUpstream, response.StatusCode)
	}
	body, err := io.ReadAll(io.LimitReader(response.Body, aiProxyResponseLimit+1))
	if err != nil || len(body) > aiProxyResponseLimit || json.Unmarshal(body, out) != nil {
		return fmt.Errorf("%w: invalid response", errAIUpstream)
	}
	return nil
}

// AIQuestion - вопрос без ответа без автора, как его принимает ai-service.
type AIQuestion struct {
	ID   string `json:"id"`
	Text string `json:"text"`
}

// ErrQuestionsDenied возвращает источник вопросов, если роль не buddy и не lead.
var ErrQuestionsDenied = errors.New("questions access denied")

// UnansweredQuestions - источник вопросов без ответа команды вызывающего.
type UnansweredQuestions interface {
	UnansweredQuestions(context.Context, auth.User, int) ([]AIQuestion, error)
}

type meetingActionItem struct {
	Title string  `json:"title"`
	Owner *string `json:"owner"`
	Due   *string `json:"due"`
}

type meetingSummary struct {
	Agreements  []string            `json:"agreements"`
	ActionItems []meetingActionItem `json:"action_items"`
}

type questionCluster struct {
	Label     string       `json:"label"`
	Size      int          `json:"size"`
	Questions []AIQuestion `json:"questions"`
}

type clusterResponse struct {
	Clusters []questionCluster `json:"clusters"`
}

// WithAIProxy добавляет POST /meetings/summary и POST /questions/clusters.
// client == nil означает, что ai-service не настроен: маршруты отвечают 503.
func WithAIProxy(base http.Handler, authService *auth.Service, client *AIClient, questions UnansweredQuestions) http.Handler {
	mux := http.NewServeMux()
	mux.Handle("POST /meetings/summary", RequireAuth(authService, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		handleMeetingSummary(w, r, client)
	})))
	mux.Handle("POST /questions/clusters", RequireAuth(authService, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		handleQuestionClusters(w, r, client, questions)
	})))
	mux.Handle("/", base)
	return mux
}

func decodeLimited(w http.ResponseWriter, r *http.Request, out any, allowEmpty bool) bool {
	r.Body = http.MaxBytesReader(w, r.Body, aiProxyBodyLimit)
	raw, err := io.ReadAll(r.Body)
	if err != nil {
		var tooLarge *http.MaxBytesError
		if errors.As(err, &tooLarge) {
			writeAuthError(w, http.StatusRequestEntityTooLarge, "INVALID_REQUEST", "Слишком большой запрос.")
			return false
		}
		writeAuthError(w, 400, "INVALID_REQUEST", "Некорректное тело запроса.")
		return false
	}
	if allowEmpty && len(bytes.TrimSpace(raw)) == 0 {
		return true
	}
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.DisallowUnknownFields()
	if decoder.Decode(out) != nil || decoder.More() {
		writeAuthError(w, 400, "INVALID_REQUEST", "Некорректное тело запроса.")
		return false
	}
	return true
}

func handleMeetingSummary(w http.ResponseWriter, r *http.Request, client *AIClient) {
	if _, ok := CurrentUser(r.Context()); !ok {
		writeAuthError(w, 401, "UNAUTHORIZED", "Требуется действительный токен.")
		return
	}
	var input struct {
		Text string `json:"text"`
	}
	if !decodeLimited(w, r, &input, false) {
		return
	}
	text := strings.TrimSpace(input.Text)
	if text == "" || !utf8.ValidString(text) || utf8.RuneCountInString(text) > meetingTextLimit {
		writeAuthError(w, 400, "INVALID_REQUEST", "Текст встречи должен быть от 1 до 20000 символов.")
		return
	}
	if client == nil {
		writeAuthError(w, 503, "SERVICE_UNAVAILABLE", "Разбор встречи временно недоступен.")
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), meetingTimeout)
	defer cancel()
	var summary meetingSummary
	if err := client.post(ctx, "/meetings/summary", map[string]string{"text": text}, &summary); err != nil {
		writeAuthError(w, 503, "SERVICE_UNAVAILABLE", "Разбор встречи временно недоступен.")
		return
	}
	if summary.Agreements == nil {
		summary.Agreements = []string{}
	}
	if summary.ActionItems == nil {
		summary.ActionItems = []meetingActionItem{}
	}
	writeOnboardingJSON(w, summary)
}

func handleQuestionClusters(w http.ResponseWriter, r *http.Request, client *AIClient, questions UnansweredQuestions) {
	user, ok := CurrentUser(r.Context())
	if !ok {
		writeAuthError(w, 401, "UNAUTHORIZED", "Требуется действительный токен.")
		return
	}
	if user.Role != "buddy" && user.Role != "lead" {
		writeAuthError(w, 403, "POLICY_DENIED", "Группы вопросов доступны наставнику и руководителю.")
		return
	}
	input := struct {
		Days int `json:"days"`
	}{Days: clustersDefaultDays}
	if !decodeLimited(w, r, &input, true) {
		return
	}
	if input.Days < 1 || input.Days > clustersMaxDays {
		writeAuthError(w, 400, "INVALID_REQUEST", "days должен быть от 1 до 90.")
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), clustersTimeout)
	defer cancel()
	items, err := questions.UnansweredQuestions(ctx, user, input.Days)
	if err != nil {
		if errors.Is(err, ErrQuestionsDenied) {
			writeAuthError(w, 403, "POLICY_DENIED", "Группы вопросов доступны наставнику и руководителю.")
			return
		}
		writeAuthError(w, 503, "SERVICE_UNAVAILABLE", "Группы вопросов временно недоступны.")
		return
	}
	if len(items) == 0 {
		writeOnboardingJSON(w, clusterResponse{Clusters: []questionCluster{}})
		return
	}
	if client == nil {
		writeAuthError(w, 503, "SERVICE_UNAVAILABLE", "Группы вопросов временно недоступны.")
		return
	}
	var result clusterResponse
	if err := client.post(ctx, "/questions/clusters", map[string]any{"questions": items}, &result); err != nil {
		writeAuthError(w, 503, "SERVICE_UNAVAILABLE", "Группы вопросов временно недоступны.")
		return
	}
	if result.Clusters == nil {
		result.Clusters = []questionCluster{}
	}
	writeOnboardingJSON(w, result)
}
